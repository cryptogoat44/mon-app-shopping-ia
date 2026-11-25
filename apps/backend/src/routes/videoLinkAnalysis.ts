// Analyse automatique d'un lien TikTok ou Instagram (lot « vidéo auto »,
// décision du fondateur des 14 et 15 novembre 2026). Le membre colle ou
// partage un lien et écrit ce qu'il cherche (« la veste en cuir de la fille
// à gauche ») ; le serveur demande au service vidéo séparé (apps/video-worker,
// lib/videoWorker.ts) quelques images de la vidéo publique, les donne à l'IA
// (étage 2 existant, services/videoMoments.ts) et renvoie les moments
// trouvés : l'image entière du moment (1 280 px au plus) et le cadre de la
// pièce. L'app enchaîne ensuite exactement comme pour une vidéo du téléphone
// (image du moment + cadre → recherche habituelle). Tout échec ramène le
// membre à la capture d'écran, qui reste la roue de secours.
//
// Le serveur principal ne télécharge rien lui-même : seul le service vidéo
// récupère la vidéo, sans la garder. Ici, rien n'est conservé non plus : les
// images restent en mémoire le temps de la réponse, puis sont effacées ; ni
// base (hors le compteur de l'IA, table ai_calls), ni stockage, ni journal
// (des compteurs et des codes seulement : jamais l'adresse, le texte ni une
// image), ni Sentry (les images en « data URI » y sont masquées de toute
// façon, lib/sentry.ts).
//
// Conditions, dans l'ordre : interrupteur VIDEO_LINK_ANALYSIS_ENABLED et
// réglages du service vidéo valides, clé d'Anthropic présente (la même que
// pour /api/video-moments/status) ; consentement « analyse_video_ia » donné
// sur un texte qui parle des liens (VIDEO_LINK_CONSENT_VERSIONS : l'ancien
// texte, vidéo du téléphone seulement, ne suffit pas) ; texte et lien valides (vidéo TikTok ou Instagram, lien court
// TikTok résolu comme partout ailleurs ; profils et autres sites refusés) ;
// limites de l'IA lues sans réserver, puis plafond des recherches, comme
// POST /api/video-moments ; capacité du service vidéo ; images demandées
// avec l'adresse canonique ; place de l'IA réservée juste avant l'appel.
//
// Lot « propositions » (Parcours 2, décision du fondateur du 21 novembre
// 2026) : avec l'interrupteur VIDEO_PIECES_ENABLED, l'app peut demander le
// mode « pièces » ({ url, mode: "pieces" }, sans aucun texte) au geste « Voir
// les propositions de l'IA ». Mêmes conditions, même ordre, mêmes plafonds :
// seul l'appel à l'IA change (askVideoPieces, dans la langue de l'app), et la
// réponse porte en plus le nom de chaque pièce (labels), jamais gardé ni
// journalisé. Toujours une seule analyse comptée par demande.
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  SEARCH_QUERY_MAX_LENGTH,
  VIDEO_AI,
  VIDEO_LINK_CONSENT_VERSIONS,
  VIDEO_LINK_INPUT_MAX_LENGTH,
  parseVideoLink,
  type VideoLinkAnalysisErrorCode,
  type VideoLinkFailureCause,
  type VideoLinkAnalysisResponse,
  type VideoLinkAnalysisStatus,
  type VideoLinkMoment,
  type VideoPlatform,
} from "@monapp/shared-types";
import { env } from "../env.js";
import { aiQuotaFor, type AiQuotaDecision } from "../lib/aiQuota.js";
import { videoPiecesEnabled } from "../lib/aiSwitches.js";
import { noteFailure } from "../lib/alerts.js";
import { ConsentLookupError, hasCurrentConsent } from "../lib/consents.js";
import { ImageQueueFullError } from "../lib/imageSafety.js";
import { requestLocale } from "../lib/locale.js";
import { GENERIC_SERVER_ERROR } from "../lib/messages.js";
import { optimizePhotoWithSize } from "../lib/photos.js";
import { searchCapacityForVideoAi, sendCapacityReached } from "../lib/searchCapacity.js";
import { speaksV2 } from "../lib/clientLevel.js";
import { nextParisMidnight } from "../lib/searchCapacityStatus.js";
import { resolveVideoLink } from "../lib/videoLinks.js";
import {
  fetchVideoFrames,
  logVideoWorkerConfigState,
  readVideoWorkerConfig,
  VideoWorkerError,
  wipeFrames,
  workerVideoUrl,
  type VideoWorkerConfig,
  type VideoWorkerConfigState,
  type VideoWorkerFailure,
  type VideoWorkerFetch,
  type WorkerFrame,
} from "../lib/videoWorker.js";
import { consumeRateLimit } from "../plugins/rateLimit.js";
import { askVideoMoments, askVideoPieces, VIDEO_AI_SETTINGS, VideoAiError, type FrameForAi } from "../services/videoMoments.js";
import { videoAiApiKey } from "./videoMoments.js";

/** Grand côté de l'image d'un moment renvoyée à l'app (contrat partagé). */
export const VIDEO_LINK_MOMENT_EDGE = 1280;
/** Qualité de l'image d'un moment, réencodée par le serveur (métadonnées
 * retirées, taille garantie), pour perdre le moins possible avant la
 * recherche par image. Retours du build 2 : 92 (85 avant), comme le service
 * vidéo, moins compressé lui aussi. Les images pour l'IA ne changent pas. */
export const MOMENT_QUALITY = 92;
/** Images pour l'IA : mêmes réglages que POST /api/video-moments. */
const AI_FRAME_QUALITY = 80;
const MIN_FRAME_EDGE = 64;
/** Analyses en cours au plus sur ce serveur (512 Mo) : chacune garde jusqu'à
 * 16 images en mémoire, le temps du service vidéo puis de l'IA. Au-delà :
 * 503 « video_busy » (le service vidéo n'en fait lui-même que 2 à la fois). */
export const MAX_PARALLEL_ANALYSES = 3;
/** Le corps attendu tient en quelques centaines d'octets (lien et texte). */
const BODY_LIMIT = 16 * 1024;

const querySchema = z.string().trim().min(VIDEO_AI.queryMinLength).max(SEARCH_QUERY_MAX_LENGTH);
const urlField = z.string().min(1).max(VIDEO_LINK_INPUT_MAX_LENGTH);

/** `cause` (plan B en un geste, champ additif) : pourquoi la vidéo n'a pas pu
 * être récupérée, quand le service vidéo le sait ; une app plus ancienne l'ignore. */
type ErrorBody = { error: VideoLinkAnalysisErrorCode; message: string; cause?: VideoLinkFailureCause };

// Messages : la capture d'écran est toujours proposée en repli (il n'y a pas
// de curseur pour une vidéo qui n'est pas sur l'appareil).
const DISABLED: ErrorBody = {
  error: "video_analysis_disabled",
  message: "L'analyse automatique des liens n'est pas disponible. Faites une capture de la vidéo.",
};
const CONSENT_REQUIRED: ErrorBody = {
  error: "video_ai_consent_required",
  message: "Acceptez d'abord l'analyse automatique, ou faites une capture de la vidéo.",
};
const INVALID_QUERY: ErrorBody = { error: "invalid_query", message: "Décrivez la pièce en quelques mots." };
const INVALID_LINK: ErrorBody = { error: "invalid_link", message: "Ce lien n'est pas celui d'une vidéo TikTok ou Instagram." };
const UNAVAILABLE: ErrorBody = {
  error: "video_unavailable",
  message: "Cette vidéo n'a pas pu être analysée. Faites une capture de la vidéo au bon moment.",
};
const PRIVATE: ErrorBody = {
  error: "video_private",
  message: "Cette vidéo est privée ou réservée à certains comptes. Faites une capture de la vidéo.",
  cause: "private_or_removed",
};
// Plan B en un geste (lot « recherche confiance ») : mêmes codes et statuts
// qu'avant (une app plus ancienne garde son message), avec la cause.
// Vidéo supprimée ou introuvable : 422, rien à signaler.
const REMOVED: ErrorBody = {
  error: "video_unavailable",
  message: "Cette vidéo est privée ou a été supprimée. Faites une capture de la vidéo si vous la voyez encore.",
  cause: "private_or_removed",
};
// TikTok ou Instagram a refusé la demande du service vidéo (connexion exigée,
// accès bloqué) : 502, compté comme une panne du service (alerte « échecs répétés »).
const REFUSED: ErrorBody = {
  error: "video_unavailable",
  message: "TikTok ou Instagram a refusé de nous transmettre cette vidéo. Faites une capture de la vidéo.",
  cause: "refused",
};
const TOO_LONG: ErrorBody = {
  error: "video_too_long",
  message: "Cette vidéo est trop longue pour l'analyse automatique (90 secondes au plus). Faites une capture de la vidéo.",
};
const NO_MOMENT: ErrorBody = {
  error: "video_no_moment",
  message: "La pièce décrite n'a pas été repérée dans cette vidéo. Précisez votre description, ou faites une capture de la vidéo.",
};
const BUSY: ErrorBody = {
  error: "video_busy",
  message: "L'analyse des vidéos est très demandée en ce moment. Réessayez dans un instant, ou faites une capture de la vidéo.",
};
const TIMEOUT: ErrorBody = {
  error: "video_timeout",
  message: "L'analyse de la vidéo a pris trop de temps. Réessayez, ou faites une capture de la vidéo.",
};
const AI_USER_LIMIT: ErrorBody = {
  error: "video_ai_user_limit",
  message: "Vous avez atteint la limite quotidienne d'analyses automatiques. Faites une capture de la vidéo, ou réessayez demain.",
};
const AI_GLOBAL_LIMIT: ErrorBody = {
  error: "video_ai_global_limit",
  message: "L'analyse automatique est très demandée aujourd'hui et momentanément indisponible. Faites une capture de la vidéo.",
};

/** Réponse du serveur pour chaque échec du service vidéo. Le code suit le
 * contrat partagé ; le statut distingue ce qui vient de la vidéo (4xx, rien
 * à signaler) d'une panne (5xx, signalée à Sentry comme toute réponse 5xx). */
export const WORKER_FAILURE_REPLIES: Readonly<Record<VideoWorkerFailure, { status: number; body: ErrorBody }>> = {
  private: { status: 422, body: PRIVATE },
  too_long: { status: 422, body: TOO_LONG },
  busy: { status: 503, body: BUSY },
  timeout: { status: 504, body: TIMEOUT },
  not_found: { status: 422, body: REMOVED },
  unsupported: { status: 422, body: UNAVAILABLE },
  blocked: { status: 502, body: REFUSED },
  unavailable: { status: 502, body: UNAVAILABLE },
  bad_request: { status: 502, body: UNAVAILABLE },
  unauthorized: { status: 502, body: UNAVAILABLE },
  invalid_response: { status: 502, body: UNAVAILABLE },
  unreachable: { status: 502, body: UNAVAILABLE },
};

/** Pannes du service vidéo lui-même (pas de la vidéo demandée) : comptées
 * pour l'alerte « échecs répétés » (lib/alerts.ts). */
const SERVICE_FAILURES: ReadonlySet<VideoWorkerFailure> = new Set(["timeout", "blocked", "unavailable", "bad_request", "unauthorized", "invalid_response", "unreachable"]);
/** Réglages à vérifier (secret ou contrat différents des deux côtés). */
const CONFIG_FAILURES: ReadonlySet<VideoWorkerFailure> = new Set(["bad_request", "unauthorized"]);

/** Échec d'une étape : la réponse à donner. */
class AnalysisStop extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ErrorBody
  ) {
    super(body.error);
  }
}

/** Plafond de l'IA atteint (comptés dans la base, lib/aiQuota.ts) : les codes
 * de POST /api/video-moments, avec un message pour un lien, et l'attente
 * jusqu'à minuit (heure de Paris), quand les compteurs repartent de zéro. */
function sendAiLimitReached(reply: FastifyReply, decision: Extract<AiQuotaDecision, { allowed: false }>): FastifyReply {
  const body = decision.refusedBy === "user" ? AI_USER_LIMIT : AI_GLOBAL_LIMIT;
  const now = new Date();
  reply.header("Retry-After", Math.max(1, Math.ceil((nextParisMidnight(now).getTime() - now.getTime()) / 1000)).toString());
  return reply.code(429).send(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Ce que le membre demande : la pièce qu'il décrit (ses mots, comme
 * toujours), ou les pièces que l'IA voit (lot « propositions »). */
type Asked = { mode: "words"; query: string } | { mode: "pieces" };

const hasKey = (body: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(body, key);

/** Le corps relu : sans `mode`, les mots restent obligatoires ; `mode:
 * "pieces"` exige l'interrupteur allumé et aucun `query`, pas même vide (rien
 * de tapé ne part dans ce mode). Tout autre cas : null (400 « invalid_query »,
 * l'app ramène au champ). */
function readAsked(body: Record<string, unknown>): Asked | null {
  if (!hasKey(body, "mode")) {
    const query = querySchema.safeParse(body.query);
    return query.success ? { mode: "words", query: query.data } : null;
  }
  return body.mode === "pieces" && videoPiecesEnabled() && !hasKey(body, "query") ? { mode: "pieces" } : null;
}

/** Une image du service vidéo, réduite pour l'IA (512 px, sans métadonnées),
 * dans la file des traitements d'images (un à la fois dans le serveur). */
async function frameForAi(frame: WorkerFrame): Promise<FrameForAi> {
  let prepared: FrameForAi;
  try {
    prepared = await optimizePhotoWithSize(frame.data, VIDEO_AI.frameEdge, AI_FRAME_QUALITY);
  } catch (error) {
    if (error instanceof ImageQueueFullError) throw new AnalysisStop(503, BUSY);
    throw new VideoWorkerError("invalid_response");
  }
  if (prepared.width < MIN_FRAME_EDGE || prepared.height < MIN_FRAME_EDGE) {
    prepared.data.fill(0);
    throw new VideoWorkerError("invalid_response");
  }
  return prepared;
}

/** L'image entière d'un moment, réencodée (1 280 px au plus, sans
 * métadonnées), en « data URI ». Les octets sont effacés aussitôt. */
async function momentImage(frame: WorkerFrame): Promise<string> {
  let encoded: Buffer;
  try {
    encoded = (await optimizePhotoWithSize(frame.data, VIDEO_LINK_MOMENT_EDGE, MOMENT_QUALITY)).data;
  } catch (error) {
    if (error instanceof ImageQueueFullError) throw new AnalysisStop(503, BUSY);
    throw new VideoWorkerError("invalid_response");
  }
  try {
    return `data:image/jpeg;base64,${encoded.toString("base64")}`;
  } finally {
    encoded.fill(0);
  }
}

export interface VideoLinkAnalysisOptions {
  /** Réglages du service vidéo déjà lus (tests) ; sinon lus de src/env.ts au démarrage. */
  workerConfig?: VideoWorkerConfigState;
  /** Appel HTTP vers le service vidéo (tests : un faux) ; sinon fetch. */
  workerFetch?: VideoWorkerFetch;
  /** Délai de la demande au service vidéo (tests) ; sinon 30 s. */
  workerTimeoutMs?: number;
  /** Étage 2 (tests : un faux, aucun appel à Anthropic) ; sinon askVideoMoments. */
  askMoments?: typeof askVideoMoments;
  /** Mode « pièces » (tests : un faux, aucun appel à Anthropic) ; sinon askVideoPieces. */
  askPieces?: typeof askVideoPieces;
}

export default async function videoLinkAnalysisRoutes(fastify: FastifyInstance, options: VideoLinkAnalysisOptions) {
  // Réglages lus et vérifiés une seule fois, au démarrage (interrupteur coupé :
  // ni l'adresse ni le secret ne sont lus). Un avertissement au plus.
  const configState = options.workerConfig ?? readVideoWorkerConfig(env);
  logVideoWorkerConfigState(configState, videoAiApiKey() !== null, fastify.log);
  const askMoments = options.askMoments ?? askVideoMoments;
  const askPieces = options.askPieces ?? askVideoPieces;
  let running = 0;

  /** Le service vidéo et la clé d'Anthropic si l'analyse est possible, sinon null. */
  function ready(): { config: VideoWorkerConfig; apiKey: string } | null {
    if (configState.state !== "ready") return null;
    const apiKey = videoAiApiKey();
    return apiKey ? { config: configState.config, apiKey } : null;
  }

  /** Échec du service vidéo : journal (codes seulement), alerte si c'est une panne. */
  function workerFailed(log: FastifyBaseLogger, platform: VideoPlatform, error: VideoWorkerError) {
    const fields = { platform, failure: error.kind, status: error.status };
    if (CONFIG_FAILURES.has(error.kind)) log.error(fields, "Analyse d'un lien vidéo : service vidéo mal réglé");
    else log.warn(fields, "Analyse d'un lien vidéo : service vidéo en échec");
    if (SERVICE_FAILURES.has(error.kind)) noteFailure(log, "service_video");
    return WORKER_FAILURE_REPLIES[error.kind];
  }

  // L'app demande d'abord si l'analyse d'un lien est possible, pour ne pas la
  // proposer (ni demander de consentement) quand elle ne l'est pas ; `pieces`
  // (lot « propositions ») seulement si l'interrupteur est allumé aussi.
  fastify.get("/api/video-links/analyze/status", { preHandler: fastify.requireAuth }, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const enabled = ready() !== null;
    const status: VideoLinkAnalysisStatus = enabled && videoPiecesEnabled() ? { enabled, pieces: true } : { enabled };
    return reply.send(status);
  });

  fastify.post(
    "/api/video-links/analyze",
    {
      preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("videoLinkAnalysis")],
      config: { rateLimitName: "videoLinkAnalysis" as const },
      bodyLimit: BODY_LIMIT,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header("Cache-Control", "no-store");
      const service = ready();
      if (!service) return reply.code(503).send(DISABLED);
      const userId = request.user!.id;
      const log = request.log;

      // Sans consentement donné sur le texte qui parle des liens, rien ne part :
      // ni vers le service vidéo, ni vers l'IA (l'app redemande l'accord).
      try {
        if (!(await hasCurrentConsent(fastify, userId, "analyse_video_ia", VIDEO_LINK_CONSENT_VERSIONS))) return reply.code(403).send(CONSENT_REQUIRED);
      } catch (error) {
        if (!(error instanceof ConsentLookupError)) throw error;
        log.error("Lecture du consentement impossible (analyse d'un lien vidéo)");
        return reply.code(500).send({ error: "internal_error", message: GENERIC_SERVER_ERROR });
      }

      const body = isRecord(request.body) ? request.body : {};
      // Les mots, ou le mode « pièces » (interrupteur allumé, aucun texte) :
      // sinon 400, avant tout appel au service vidéo, à l'IA ou au compteur.
      const asked = readAsked(body);
      if (!asked) return reply.code(400).send(INVALID_QUERY);
      const input = urlField.safeParse(body.url);
      // Reconnu dans l'adresse elle-même, sans aucun appel : vidéo TikTok ou
      // Instagram, ou lien court TikTok. Un profil, un autre site : refusé.
      if (!input.success || !parseVideoLink(input.data)) return reply.code(400).send(INVALID_LINK);

      // Limites de l'IA (10 par personne, 300 en tout, par jour), lues sans
      // rien réserver ; puis le plafond des recherches : aucune recherche ne
      // pourrait suivre. Compteur illisible : aucune analyse.
      const early = await aiQuotaFor(fastify, log, { kind: "video", userId, reserve: false }).catch(() => null);
      if (!early) return reply.code(503).send(UNAVAILABLE);
      if (!early.allowed) return sendAiLimitReached(reply, early);
      const capacity = await searchCapacityForVideoAi(fastify, log, userId).catch(() => null);
      if (!capacity) return reply.code(503).send(UNAVAILABLE);
      if (!capacity.allowed) return sendCapacityReached(reply, capacity, speaksV2(request));

      // Un lien court TikTok fait partir un appel (redirection seulement),
      // compté comme sur les autres routes des liens vidéo.
      const resolved = await resolveVideoLink(input.data, {
        beforeFetch: () => consumeRateLimit(request, "videoShortLink") && consumeRateLimit(request, "videoShortLinkGlobal"),
      });
      if (!resolved.link) {
        const transient = resolved.issue === "unreachable" || resolved.issue === "rate_limited";
        return transient ? reply.code(503).send(UNAVAILABLE) : reply.code(400).send(INVALID_LINK);
      }
      const link = resolved.link;
      const workerUrl = workerVideoUrl(link);
      if (!workerUrl) return reply.code(400).send(INVALID_LINK);

      // Capacité : analyses en cours sur ce serveur, puis plafond commun des
      // vidéos demandées au service vidéo (compté seulement ici).
      if (running >= MAX_PARALLEL_ANALYSES) return reply.code(503).send(BUSY);
      if (!consumeRateLimit(request, "videoLinkFetchGlobal")) return reply.code(503).send(BUSY);

      running += 1;
      let workerFrames: WorkerFrame[] = [];
      const aiFrames: FrameForAi[] = [];
      const startedAt = Date.now();
      try {
        const fetched = await fetchVideoFrames(service.config, { url: workerUrl, platform: link.platform }, { fetcher: options.workerFetch, timeoutMs: options.workerTimeoutMs });
        workerFrames = fetched.frames;
        const workerMs = Date.now() - startedAt;
        for (const frame of workerFrames) aiFrames.push(await frameForAi(frame));

        // Une place réservée dans la base juste avant l'appel à l'IA (atomique :
        // deux demandes simultanées ne dépassent jamais la limite).
        const reserved = await aiQuotaFor(fastify, log, { kind: "video", userId, reserve: true }).catch(() => null);
        if (!reserved) return reply.code(503).send(UNAVAILABLE);
        if (!reserved.allowed) return sendAiLimitReached(reply, reserved);
        if (asked.mode === "pieces") {
          const found = await askPieces(aiFrames, requestLocale(request), { apiKey: service.apiKey, ...VIDEO_AI_SETTINGS });
          // Compteurs seulement : jamais un nom proposé, l'adresse, les images ni la réponse du modèle.
          const counters = {
            platform: link.platform,
            mode: "pieces",
            frames: aiFrames.length,
            candidates: found.candidates.length,
            moments: found.pieces.length,
            refusedLabels: found.refusedLabels,
            inputTokens: found.usage.inputTokens,
            outputTokens: found.usage.outputTokens,
            workerMs,
          };
          if (found.pieces.length === 0) {
            log.info(counters, "Analyse d'un lien vidéo : aucun moment");
            return reply.code(422).send(NO_MOMENT);
          }
          // Une image par pièce, le nom en face ; une image partagée par deux
          // pièces n'est réencodée qu'une fois.
          const images = new Map<number, string>();
          const moments: VideoLinkMoment[] = [];
          const labels: string[] = [];
          for (const piece of found.pieces) {
            const frame = workerFrames[piece.frame];
            if (!frame) continue;
            const image = images.get(piece.frame) ?? (await momentImage(frame));
            images.set(piece.frame, image);
            moments.push({ timeSeconds: frame.timeSeconds, image, box: piece.box });
            labels.push(piece.label);
          }
          if (moments.length === 0) return reply.code(422).send(NO_MOMENT);
          log.info({ ...counters, totalMs: Date.now() - startedAt }, "Analyse d'un lien vidéo");
          const response: VideoLinkAnalysisResponse = { video: link, moments, labels };
          return reply.send(response);
        }
        const result = await askMoments(aiFrames, asked.query, { apiKey: service.apiKey, ...VIDEO_AI_SETTINGS });
        // Compteurs seulement : jamais l'adresse, le texte, les images ni la réponse du modèle.
        const counters = {
          platform: link.platform,
          frames: aiFrames.length,
          candidates: result.candidates.length,
          moments: result.moments.length,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          workerMs,
        };
        if (result.moments.length === 0) {
          log.info(counters, "Analyse d'un lien vidéo : aucun moment");
          return reply.code(422).send(NO_MOMENT);
        }

        // Chaque moment désigne une image envoyée à l'IA ; l'app reçoit la
        // même image en grand (celle du service vidéo, réencodée).
        const moments: VideoLinkMoment[] = [];
        for (const moment of result.moments) {
          const frame = workerFrames[moment.frame];
          if (!frame) continue;
          moments.push({ timeSeconds: frame.timeSeconds, image: await momentImage(frame), box: moment.box });
        }
        if (moments.length === 0) return reply.code(422).send(NO_MOMENT);
        log.info({ ...counters, totalMs: Date.now() - startedAt }, "Analyse d'un lien vidéo");
        const response: VideoLinkAnalysisResponse = { video: link, moments };
        return reply.send(response);
      } catch (error) {
        if (error instanceof AnalysisStop) return reply.code(error.status).send(error.body);
        if (error instanceof VideoWorkerError) {
          const failure = workerFailed(log, link.platform, error);
          return reply.code(failure.status).send(failure.body);
        }
        if (error instanceof VideoAiError) {
          const mode = asked.mode === "pieces" ? { mode: "pieces" } : {};
          log.warn({ platform: link.platform, ...mode, frames: aiFrames.length, kind: error.kind, status: error.status }, "Analyse d'un lien vidéo : IA sans résultat");
          noteFailure(log, "ia_video");
          return reply.code(503).send(UNAVAILABLE);
        }
        throw error;
      } finally {
        running -= 1;
        // Effacées dès la réponse (ou dès l'échec) : le serveur ne garde rien.
        wipeFrames(workerFrames);
        for (const frame of aiFrames) frame.data.fill(0);
      }
    }
  );
}
