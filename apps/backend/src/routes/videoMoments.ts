import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { SEARCH_QUERY_MAX_LENGTH, VIDEO_AI, type VideoAiStatus, type VideoMomentsResponse } from "@monapp/shared-types";
import { env } from "../env.js";
import { ConsentLookupError, hasCurrentConsent } from "../lib/consents.js";
import { isFileTooLargeError, isTooManyPartsError } from "../lib/multipartErrors.js";
import { GENERIC_SERVER_ERROR } from "../lib/messages.js";
import { optimizePhotoWithSize } from "../lib/photos.js";
import { searchCapacityForVideoAi, sendCapacityReached } from "../lib/searchCapacity.js";
import { askVideoMoments, VIDEO_AI_SETTINGS, VideoAiError, type FrameForAi } from "../services/videoMoments.js";

// Analyse automatique d'une vidéo (lot 4, temps 1 bis), étage 2. L'app envoie
// au plus 12 images réduites (512 px), choisies sur l'appareil, et quelques
// mots ; le serveur les vérifie, les transmet à l'IA d'Anthropic et renvoie
// au plus 3 moments (numéro d'image et cadre de la pièce, en proportions).
// Conditions : clé d'API présente, plafond global des recherches non atteint
// (lib/searchCapacity.ts), consentement « analyse_video_ia » en vigueur,
// limites quotidiennes (lib/rateLimits.ts). Rien n'est conservé :
// les images restent en mémoire le temps de la réponse, puis sont effacées ;
// ni base, ni stockage, ni journal (compteurs seulement), ni Sentry.

/** Une image de 512 px pèse ≈ 30 à 80 Ko : marge large, sans plus. */
const MAX_FRAME_BYTES = 512 * 1024;
const MIN_FRAME_EDGE = 64;
const FRAME_QUALITY = 80;

const querySchema = z.string().trim().min(VIDEO_AI.queryMinLength).max(SEARCH_QUERY_MAX_LENGTH);

const DISABLED = { error: "video_ai_disabled", message: "L'analyse automatique n'est pas disponible. Choisissez l'image avec le curseur." };
const CONSENT_REQUIRED = {
  error: "video_ai_consent_required",
  message: "Acceptez d'abord l'analyse automatique, ou choisissez l'image avec le curseur.",
};
const INVALID_FRAMES = { error: "invalid_frames", message: "Les images de la vidéo sont invalides." };
const INVALID_QUERY = { error: "invalid_query", message: "Décrivez la pièce en quelques mots." };
const FRAME_TOO_LARGE = { error: "file_too_large", message: "Une image de la vidéo est trop lourde." };
const UNAVAILABLE = { error: "video_ai_unavailable", message: "L'analyse automatique n'a pas abouti. Choisissez l'image avec le curseur." };

/** Clé d'API d'Anthropic (secret saisi dans Render), lue à chaque appel. */
export function videoAiApiKey(): string | null {
  return env.ANTHROPIC_API_KEY ?? null;
}

type Upload = { rawFrames: Buffer[]; query: string } | "too_large" | "too_many";

/** Lit l'envoi : images (champ « frame ») et texte (champ « query »), dans
 * les limites de la route. Toute autre partie rend l'envoi invalide. */
async function readUpload(request: FastifyRequest): Promise<Upload> {
  const rawFrames: Buffer[] = [];
  let query = "";
  let unexpected = false;
  try {
    // Un seul champ attendu (« query ») ; un peu de marge sur les champs pour
    // que la route repère elle-même un champ inattendu.
    const limits = { files: VIDEO_AI.maxFrames, fileSize: MAX_FRAME_BYTES, fields: 4, parts: VIDEO_AI.maxFrames + 4 };
    for await (const part of request.parts({ limits })) {
      if (part.type === "file" && part.fieldname === "frame") rawFrames.push(await part.toBuffer());
      else if (part.type === "field" && part.fieldname === "query") query = String(part.value);
      else {
        unexpected = true;
        if (part.type === "file") await part.toBuffer();
      }
    }
  } catch (error) {
    for (const raw of rawFrames) raw.fill(0);
    if (isFileTooLargeError(error)) return "too_large";
    if (isTooManyPartsError(error)) return "too_many";
    throw error;
  }
  if (unexpected) {
    for (const raw of rawFrames) raw.fill(0);
    return "too_many";
  }
  return { rawFrames, query };
}

/** Image réellement lisible, réduite à 512 px, sans métadonnées. */
async function normalizeFrame(raw: Buffer): Promise<FrameForAi | null> {
  try {
    const frame = await optimizePhotoWithSize(raw, VIDEO_AI.frameEdge, FRAME_QUALITY);
    if (frame.width >= MIN_FRAME_EDGE && frame.height >= MIN_FRAME_EDGE) return frame;
    frame.data.fill(0);
    return null;
  } catch {
    return null;
  }
}

export default async function videoMomentsRoutes(fastify: FastifyInstance) {
  // L'app demande d'abord si la fonction est active, pour ne pas proposer
  // l'analyse automatique (ni demander de consentement) quand elle ne l'est pas.
  fastify.get("/api/video-moments/status", { preHandler: fastify.requireAuth }, async (_request, reply) => {
    const status: VideoAiStatus = { enabled: videoAiApiKey() !== null };
    return reply.send(status);
  });

  fastify.post(
    "/api/video-moments",
    {
      preHandler: [fastify.requireAuth, fastify.rateLimitCheck("videoAiUser"), fastify.rateLimitCheck("videoAiGlobal")],
      config: { rateLimitName: "videoAiUser" },
    },
    async (request, reply) => {
      const apiKey = videoAiApiKey();
      if (!apiKey) return reply.code(503).send(DISABLED);
      // Plafond global des recherches atteint (lot 4 quater) : aucune
      // recherche ne pourrait suivre, donc aucune image ne part à l'IA, aucune
      // dépense. Plafond illisible : pas d'analyse non plus.
      const capacity = await searchCapacityForVideoAi(fastify, request.log).catch(() => null);
      if (!capacity) return reply.code(503).send(UNAVAILABLE);
      if (!capacity.allowed) return sendCapacityReached(reply, capacity);
      if (!request.isMultipart()) return reply.code(400).send(INVALID_FRAMES);

      const upload = await readUpload(request);
      if (upload === "too_large") return reply.code(413).send(FRAME_TOO_LARGE);
      if (upload === "too_many") return reply.code(400).send(INVALID_FRAMES);

      const frames: FrameForAi[] = [];
      try {
        const query = querySchema.safeParse(upload.query);
        if (!query.success) return reply.code(400).send(INVALID_QUERY);
        if (upload.rawFrames.length === 0) return reply.code(400).send(INVALID_FRAMES);
        // Sans consentement en vigueur, aucune image ne part.
        if (!(await hasCurrentConsent(fastify, request.user!.id, "analyse_video_ia"))) return reply.code(403).send(CONSENT_REQUIRED);
        for (const raw of upload.rawFrames) {
          const frame = await normalizeFrame(raw);
          if (!frame) return reply.code(400).send(INVALID_FRAMES);
          frames.push(frame);
        }

        fastify.countRateLimitHit(request, "videoAiUser");
        fastify.countRateLimitHit(request, "videoAiGlobal");
        const result = await askVideoMoments(frames, query.data, { apiKey, ...VIDEO_AI_SETTINGS });
        // Compteurs seulement : jamais le texte, les images ni la réponse du modèle.
        const counters = {
          frames: frames.length,
          candidates: result.candidates.length,
          moments: result.moments.length,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        };
        request.log.info(counters, "Analyse vidéo IA");
        const body: VideoMomentsResponse = { moments: result.moments };
        return reply.send(body);
      } catch (error) {
        if (error instanceof VideoAiError) {
          request.log.warn({ frames: frames.length, kind: error.kind, status: error.status }, "Analyse vidéo IA sans résultat");
          return reply.code(503).send(UNAVAILABLE);
        }
        if (error instanceof ConsentLookupError) {
          request.log.error("Lecture du consentement impossible (analyse vidéo IA)");
          return reply.code(500).send({ error: "internal_error", message: GENERIC_SERVER_ERROR });
        }
        throw error;
      } finally {
        // Effacées dès la réponse de l'IA (ou dès le refus de l'envoi).
        for (const raw of upload.rawFrames) raw.fill(0);
        for (const frame of frames) frame.data.fill(0);
      }
    }
  );
}
