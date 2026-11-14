// Essayage virtuel photo (lot « essayage virtuel », migration 0042), ÉTEINT
// par défaut : le membre envoie une photo de lui, choisit une pièce trouvée
// par l'app, et reçoit une image où il la porte (fournisseur FASHN, modèle
// tryon-v1.6, ou le faux fournisseur en développement).
// Interrupteur double (lib/tryon/switch.ts) : TRYON_ENABLED et le drapeau
// feature_flags.tryon. Éteint, GET /api/tryon/status répond { enabled: false }
// et toutes les autres routes 503 « feature_disabled », sauf le retrait du
// consentement, toujours possible (décision 2 du plan).
// Déroulé d'un essai, dans l'ordre de la mission (§ 5.5) : accès (âge,
// consentement, « cette photo est la mienne »), pièce retrouvée dans la base
// (jamais une adresse venue de l'app), réservation atomique dans la base
// (quota, un essai à la fois, budget), solde de crédits, photo ré-encodée en
// mémoire, appel au fournisseur, bandeau « Image générée par IA », décompte.
// Un échec n'est jamais décompté. La photo et l'image produite ne quittent
// jamais la mémoire : ni base, ni stockage, ni disque, ni journal, ni Sentry ;
// leurs octets sont effacés dès la réponse.
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { TryonAgeGateResponse, TryonConsentResponse, TryonErrorCode, TryonReportReason, TryonRunResponse, TryonStatus } from "@monapp/shared-types";
import { z } from "zod";
import { env } from "../env.js";
import { ImageSourceError } from "../lib/imageProcessing.js";
import { ImageQueueFullError } from "../lib/imageSafety.js";
import { requestLocale, type Locale } from "../lib/locale.js";
import { GENERIC_CLIENT_ERROR } from "../lib/messages.js";
import { isFileTooLargeError, isTooManyPartsError } from "../lib/multipartErrors.js";
import { findOwnMatchWithLinks } from "../lib/ownMatches.js";
import { downloadPublicImage } from "../lib/publicImage.js";
import { ageStatusFor } from "../lib/tryon/ageGate.js";
import { notifyTryonAlert, type TryonAlertKind } from "../lib/tryon/alerts.js";
import { addAiBand } from "../lib/tryon/band.js";
import { dayIn, dayKeyAt, monthKeyAt, nextMonthStart } from "../lib/tryon/calendar.js";
import { isProductionServer, logTryonConfigState, readTryonConfig, TRYON_CONSENT_VERSION, type TryonConfig, type TryonConfigState } from "../lib/tryon/config.js";
import { accessRefusal, ageGateOf, consentStateOf, type TryonAccessRefusal } from "../lib/tryon/consent.js";
import { tryonGarmentUrls } from "../lib/tryon/eligibility.js";
import type { TryonFailureCode } from "../lib/tryon/failures.js";
import { featureFlagReader } from "../lib/tryon/featureFlag.js";
import { jpegDataUri, prepareGarmentImage, prepareTryonPhoto, TRYON_PHOTO_MAX_BYTES } from "../lib/tryon/images.js";
import { TryonProviderError, type TryOnProvider, type TryonProviderErrorKind, type TryonRunOutput } from "../lib/tryon/provider.js";
import { createTryonProvider } from "../lib/tryon/providers/index.js";
import {
  acceptConsent,
  completeTry,
  failTry,
  hasTriedItem,
  insertReport,
  readRemaining,
  readTryonProfile,
  recordAgeStatus,
  recordAlertOnce,
  reserveTry,
  withdrawConsent,
  type Completion,
} from "../lib/tryon/store.js";
import { activeTryonConfig } from "../lib/tryon/switch.js";

type TryonErrorBody = { error: TryonErrorCode | "invalid_request" | "file_too_large" | "server_busy" | "internal_error"; message: string };

const FEATURE_DISABLED: TryonErrorBody = { error: "feature_disabled", message: "L'essayage virtuel n'est pas disponible." };
const BIRTH_DATE_INVALID: TryonErrorBody = { error: "tryon_birth_date_invalid", message: "Cette date de naissance n'est pas valide." };
const AGE_ALREADY_SET: TryonErrorBody = { error: "tryon_age_already_set", message: "Votre âge a déjà été vérifié." };
const ACCESS_REFUSALS: Record<TryonAccessRefusal, TryonErrorBody> = {
  tryon_age_required: { error: "tryon_age_required", message: "Indiquez d'abord votre date de naissance." },
  tryon_minor: { error: "tryon_minor", message: "L'essayage virtuel est réservé aux personnes majeures." },
  tryon_consent_required: { error: "tryon_consent_required", message: "Acceptez d'abord les conditions de l'essayage virtuel." },
  tryon_consent_outdated: {
    error: "tryon_consent_outdated",
    message: "Les conditions de l'essayage virtuel ont changé. Relisez-les, puis acceptez-les à nouveau.",
  },
};
const ATTEST_REQUIRED: TryonErrorBody = { error: "tryon_attest_required", message: "Confirmez que cette photo est la vôtre." };
const ITEM_NOT_FOUND: TryonErrorBody = { error: "tryon_item_not_found", message: "Pièce introuvable." };
const ITEM_NOT_ELIGIBLE: TryonErrorBody = { error: "tryon_item_not_eligible", message: "Cette pièce ne peut pas être essayée." };
const PHOTO_INVALID: TryonErrorBody = { error: "tryon_photo_invalid", message: "Cette photo n'a pas pu être lue. Choisissez une photo JPEG, PNG ou WebP." };
const FILE_TOO_LARGE: TryonErrorBody = { error: "file_too_large", message: "Le fichier est trop volumineux (10 Mo maximum)." };
const IN_PROGRESS: TryonErrorBody = { error: "tryon_in_progress", message: "Un essai est déjà en cours. Patientez quelques secondes." };
const QUOTA_EXHAUSTED: TryonErrorBody = { error: "tryon_quota_exhausted", message: "Vous avez utilisé tous vos essais de ce mois-ci." };
const BUDGET_REACHED: TryonErrorBody = { error: "tryon_budget_reached", message: "Les essais sont momentanément indisponibles." };
const BUSY: TryonErrorBody = { error: "tryon_busy", message: "Les essais sont très demandés en ce moment. Réessayez dans un instant." };
const PROVIDER_UNAVAILABLE: TryonErrorBody = { error: "tryon_provider_unavailable", message: "Le service d'essayage est momentanément indisponible. Réessayez plus tard." };
const TIMEOUT: TryonErrorBody = { error: "tryon_timeout", message: "L'essai a pris trop de temps. Réessayez dans un instant." };
const POSE_NOT_DETECTED: TryonErrorBody = {
  error: "tryon_pose_not_detected",
  message: "Votre silhouette n'a pas été reconnue sur cette photo. Choisissez une photo en pied ou à mi-corps, avec une seule personne et une bonne lumière.",
};
const MODERATION_BLOCKED: TryonErrorBody = {
  error: "tryon_moderation_blocked",
  message: "Cet essai a été refusé par la modération. Choisissez une autre pièce ou une autre photo.",
};
const IMAGE_UNREADABLE: TryonErrorBody = {
  error: "tryon_image_unreadable",
  message: "Votre photo ou l'image de la pièce n'a pas pu être utilisée. Essayez une autre photo ou une autre pièce.",
};
const INVALID_REQUEST: TryonErrorBody = { error: "invalid_request", message: GENERIC_CLIENT_ERROR };
const INVALID_REPORT: TryonErrorBody = { error: "invalid_request", message: "Signalement invalide." };
const SERVER_BUSY: TryonErrorBody = { error: "server_busy", message: "Le service est très demandé en ce moment. Réessayez dans un instant." };
const INTERNAL_ERROR: TryonErrorBody = { error: "internal_error", message: "Une erreur est survenue, réessayez." };

/** Ce que voit le membre pour chaque échec du fournisseur. */
const PROVIDER_FAILURES: Record<TryonProviderErrorKind, { status: number; body: TryonErrorBody }> = {
  pose_not_detected: { status: 422, body: POSE_NOT_DETECTED },
  moderation_blocked: { status: 422, body: MODERATION_BLOCKED },
  image_load: { status: 422, body: IMAGE_UNREADABLE },
  invalid_input: { status: 422, body: IMAGE_UNREADABLE },
  bad_request: { status: 503, body: PROVIDER_UNAVAILABLE },
  unauthorized: { status: 503, body: PROVIDER_UNAVAILABLE },
  not_found: { status: 503, body: PROVIDER_UNAVAILABLE },
  rate_limited: { status: 503, body: BUSY },
  out_of_credits: { status: 503, body: PROVIDER_UNAVAILABLE },
  unavailable: { status: 503, body: PROVIDER_UNAVAILABLE },
  timeout: { status: 504, body: TIMEOUT },
  invalid_response: { status: 503, body: PROVIDER_UNAVAILABLE },
};

/** Motifs d'un signalement (contrat partagé, types seulement côté app). */
export const TRYON_REPORT_REASONS = ["inappropriate", "wrong_piece", "poor_quality", "other"] as const satisfies readonly TryonReportReason[];
// Vérifié à la compilation : chaque motif du contrat est dans la liste.
type MustBeTrue<T extends true> = T;
export type TryonReportReasonsComplete = MustBeTrue<Exclude<TryonReportReason, (typeof TRYON_REPORT_REASONS)[number]> extends never ? true : false>;
/** Précision d'un signalement : 500 caractères au plus. */
export const TRYON_REPORT_COMMENT_MAX_LENGTH = 500;

const AGE_GATE_BODY = z.object({ birthDate: z.string().max(10) }).strict();
const CONSENT_BODY = z.object({ version: z.string().min(1).max(40) }).strict();
const REPORT_BODY = z
  .object({
    itemId: z.guid(),
    reason: z.enum(TRYON_REPORT_REASONS),
    comment: z.string().max(TRYON_REPORT_COMMENT_MAX_LENGTH).optional(),
  })
  .strict();
const ITEM_ID = z.guid();
/** Formulaire d'un essai : la photo (un fichier) et deux champs courts. */
const UPLOAD_LIMITS = { files: 1, fileSize: TRYON_PHOTO_MAX_BYTES, fields: 2, fieldSize: 256, parts: 3 } as const;

/** Un essai réservé qui n'aboutit pas : son code (gardé dans la base) et la réponse au membre. */
class TryonStepFailure extends Error {
  constructor(
    readonly code: TryonFailureCode,
    readonly status: number,
    readonly body: TryonErrorBody
  ) {
    super(`tryon_${code}`);
    this.name = "TryonStepFailure";
  }
}

/** Ni l'adresse de la pièce, ni ses octets n'ont pu servir. */
class GarmentUnavailableError extends Error {
  constructor() {
    super("tryon_garment_unavailable");
    this.name = "GarmentUnavailableError";
  }
}

interface TryonUpload {
  photo: Buffer;
  itemId: string | null;
  attestSelf: string | null;
}

/** Lit le formulaire d'un essai, en mémoire : la photo (champ « photo »),
 * « itemId » et « attestSelf ». Tout autre champ rend l'envoi invalide. */
async function readTryonUpload(request: FastifyRequest): Promise<TryonUpload | "too_large" | "invalid"> {
  let photo: Buffer | null = null;
  let itemId: string | null = null;
  let attestSelf: string | null = null;
  let unexpected = false;
  try {
    for await (const part of request.parts({ limits: UPLOAD_LIMITS })) {
      if (part.type === "file" && part.fieldname === "photo" && photo === null) photo = await part.toBuffer();
      else if (part.type === "field" && part.fieldname === "itemId") itemId = String(part.value);
      else if (part.type === "field" && part.fieldname === "attestSelf") attestSelf = String(part.value);
      else {
        unexpected = true;
        if (part.type === "file") (await part.toBuffer()).fill(0);
      }
    }
  } catch (error) {
    photo?.fill(0);
    if (isFileTooLargeError(error)) return "too_large";
    if (isTooManyPartsError(error)) return "invalid";
    throw error;
  }
  if (unexpected || photo === null || photo.length === 0) {
    photo?.fill(0);
    return "invalid";
  }
  return { photo, itemId, attestSelf };
}

export interface TryonRoutesOptions {
  /** Réglages déjà vérifiés (tests) ; sinon lus de src/env.ts au démarrage. */
  configState?: TryonConfigState;
  /** Fournisseur (tests : le faux, réglé) ; sinon celui de TRYON_PROVIDER. */
  provider?: TryOnProvider;
  /** Horloge (tests). */
  now?: () => Date;
}

export default async function tryonRoutes(fastify: FastifyInstance, options: TryonRoutesOptions) {
  // Réglages lus et vérifiés une seule fois, au démarrage (jamais la clé quand l'essayage est coupé).
  const configState = options.configState ?? readTryonConfig(env, isProductionServer(process.env.NODE_ENV, env.SENTRY_ENVIRONMENT));
  logTryonConfigState(configState, fastify.log);
  const provider = configState.state === "ready" ? (options.provider ?? createTryonProvider(configState.config)) : null;
  const flag = featureFlagReader(fastify, "tryon");
  const now = options.now ?? (() => new Date());
  const db = fastify.supabaseAdmin;

  /** Les réglages si les deux interrupteurs sont allumés, sinon null. */
  const active = () => activeTryonConfig(configState, flag);

  /** Une alerte nouvelle (une seule par période) part au point d'accroche. */
  async function raiseAlert(log: FastifyBaseLogger, kind: TryonAlertKind, period: string, details: Record<string, string | number>): Promise<void> {
    try {
      if (await recordAlertOnce(db, kind, period, details)) notifyTryonAlert(log, kind, { periode: period, ...details });
    } catch (error) {
      log.error({ error }, "Essayage : alerte non enregistrée");
    }
  }

  /** Le solde de crédits du fournisseur doit couvrir le minimum réglé. */
  async function ensureProviderCredits(log: FastifyBaseLogger, config: TryonConfig, tryOn: TryOnProvider): Promise<void> {
    let balance: number;
    try {
      balance = await tryOn.getCreditBalance();
    } catch (error) {
      log.warn({ error }, "Essayage : solde de crédits illisible");
      throw new TryonStepFailure("balance_unreadable", 503, PROVIDER_UNAVAILABLE);
    }
    if (balance >= config.minProviderCredits) return;
    await raiseAlert(log, "low_credits", dayKeyAt(now(), config.timeZone), { solde: balance, minimum: config.minProviderCredits });
    throw new TryonStepFailure("low_credits", 503, PROVIDER_UNAVAILABLE);
  }

  /** La photo du membre, vérifiée et ré-encodée en mémoire. */
  async function preparePhoto(raw: Buffer): Promise<Buffer> {
    try {
      return await prepareTryonPhoto(raw);
    } catch (error) {
      if (error instanceof ImageQueueFullError) throw new TryonStepFailure("server_busy", 503, SERVER_BUSY);
      if (error instanceof ImageSourceError) throw new TryonStepFailure("photo_invalid", 415, PHOTO_INVALID);
      throw error;
    }
  }

  /** L'image de la pièce téléchargée par le serveur (https, adresses publiques
   * seulement, 10 s, 8 Mo : lib/publicImage.ts), puis ré-encodée en mémoire :
   * la première adresse qui marche. */
  async function downloadGarment(urls: readonly string[]): Promise<Buffer> {
    for (const url of urls) {
      let raw: Buffer | null = null;
      try {
        raw = await downloadPublicImage(url);
        return await prepareGarmentImage(raw);
      } catch (error) {
        if (error instanceof ImageQueueFullError) throw error;
      } finally {
        raw?.fill(0);
      }
    }
    throw new GarmentUnavailableError();
  }

  /** L'essai chez le fournisseur : l'image de la pièce par son adresse ; s'il
   * n'a pas pu la charger (ImageLoadError, essai non facturé), ses octets. */
  async function runWithGarmentFallback(tryOn: TryOnProvider, personImage: Buffer, garmentUrls: readonly string[], locale: Locale): Promise<{ output: TryonRunOutput; garment: "url" | "data" }> {
    try {
      return { output: await tryOn.run({ personImage, garmentImage: { kind: "url", url: garmentUrls[0]! }, locale }), garment: "url" };
    } catch (error) {
      if (!(error instanceof TryonProviderError) || error.kind !== "image_load") throw error;
    }
    const garment = await downloadGarment(garmentUrls);
    try {
      return { output: await tryOn.run({ personImage, garmentImage: { kind: "data", jpeg: garment }, locale }), garment: "data" };
    } finally {
      garment.fill(0);
    }
  }

  /** L'image produite, avec son bandeau « Image générée par IA » et sa métadonnée IPTC. */
  async function bandResult(image: Buffer, locale: Locale): Promise<Buffer> {
    try {
      return await addAiBand(image, locale);
    } catch (error) {
      if (error instanceof ImageQueueFullError) throw new TryonStepFailure("server_busy", 503, SERVER_BUSY);
      if (error instanceof ImageSourceError) throw new TryonStepFailure("result_unreadable", 503, PROVIDER_UNAVAILABLE);
      throw error;
    }
  }

  /** Le décompte d'un essai réussi (une seconde fois si la base n'a pas répondu). */
  async function recordSuccess(log: FastifyBaseLogger, eventId: string, userId: string, creditsUsed: number, durationMs: number, config: TryonConfig): Promise<Completion | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await completeTry(db, eventId, userId, creditsUsed, durationMs, config);
      } catch (error) {
        log.error({ error, attempt }, "Essayage : décompte impossible");
      }
    }
    return null;
  }

  /** Le code et la réponse d'un échec, quel qu'il soit. */
  function failureOf(error: unknown): TryonStepFailure {
    if (error instanceof TryonStepFailure) return error;
    if (error instanceof TryonProviderError) {
      const { status, body } = PROVIDER_FAILURES[error.kind];
      return new TryonStepFailure(error.kind, status, body);
    }
    if (error instanceof GarmentUnavailableError) return new TryonStepFailure("garment_unavailable", 422, IMAGE_UNREADABLE);
    if (error instanceof ImageQueueFullError) return new TryonStepFailure("server_busy", 503, SERVER_BUSY);
    return new TryonStepFailure("internal", 500, INTERNAL_ERROR);
  }

  /** Remaining estimé si le décompte n'a pas pu être lu : l'essai pris sur le
   * gratuit s'il en restait, sinon sur l'offert. */
  function estimatedRemaining(before: { free: number; bonus: number }): { free: number; bonus: number } {
    return before.free > 0 ? { free: before.free - 1, bonus: before.bonus } : { free: 0, bonus: Math.max(before.bonus - 1, 0) };
  }

  /** Réponse d'un refus de réservation par la base. */
  async function refusedReservation(request: FastifyRequest, reply: FastifyReply, status: "not_allowed" | "in_progress" | "quota_exhausted" | "busy" | "budget_reached", config: TryonConfig) {
    switch (status) {
      case "not_allowed":
        // Consentement retiré entre-temps (ou âge remis à zéro) : à redemander.
        return reply.code(403).send(ACCESS_REFUSALS.tryon_consent_required);
      case "in_progress":
        return reply.code(409).send(IN_PROGRESS);
      case "quota_exhausted":
        return reply.code(429).send(QUOTA_EXHAUSTED);
      case "busy":
        return reply.code(503).send(BUSY);
      case "budget_reached":
        await raiseAlert(request.log, "budget_100", monthKeyAt(now(), config.timeZone), { budget_usd: config.monthlyBudgetUsd });
        return reply.code(503).send(BUDGET_REACHED);
    }
  }

  // ---- Statut : l'app ne montre rien tant qu'il ne dit pas enabled: true ----
  fastify.get(
    "/api/tryon/status",
    { preHandler: [fastify.requireAuth, fastify.rateLimit("tryonStatus")], config: { rateLimitName: "tryonStatus" } },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const off: TryonStatus = { enabled: false };
      const config = await active();
      if (!config) return reply.send(off);
      const userId = request.user!.id;
      try {
        const [profile, remaining] = await Promise.all([readTryonProfile(db, userId), readRemaining(db, userId, config)]);
        const status: TryonStatus = {
          enabled: true,
          ageGate: ageGateOf(profile),
          consent: consentStateOf(profile, TRYON_CONSENT_VERSION),
          remaining: { ...remaining, nextReset: nextMonthStart(now(), config.timeZone).toISOString() },
        };
        return reply.send(status);
      } catch (error) {
        // Dans le doute, éteint : l'app ne propose rien.
        request.log.error({ error }, "Essayage : statut illisible");
        return reply.send(off);
      }
    }
  );

  // ---- Porte d'âge : la date de naissance n'est ni gardée, ni journalisée ----
  fastify.post(
    "/api/tryon/age-gate",
    { preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("tryonAgeGate")], config: { rateLimitName: "tryonAgeGate" } },
    async (request, reply) => {
      const config = await active();
      if (!config) return reply.code(503).send(FEATURE_DISABLED);
      const body = AGE_GATE_BODY.safeParse(request.body);
      const status = body.success ? ageStatusFor(body.data.birthDate, dayIn(now(), config.timeZone)) : null;
      if (!status) return reply.code(400).send(BIRTH_DATE_INVALID);
      try {
        if (!(await recordAgeStatus(db, request.user!.id, status))) return reply.code(409).send(AGE_ALREADY_SET);
      } catch (error) {
        request.log.error({ error }, "Essayage : statut d'âge non enregistré");
        return reply.code(500).send(INTERNAL_ERROR);
      }
      const response: TryonAgeGateResponse = { ageGate: status };
      return reply.send(response);
    }
  );

  // ---- Consentement versionné : accepter ----
  fastify.post(
    "/api/tryon/consent",
    { preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("tryonConsent")], config: { rateLimitName: "tryonConsent" } },
    async (request, reply) => {
      const config = await active();
      if (!config) return reply.code(503).send(FEATURE_DISABLED);
      const body = CONSENT_BODY.safeParse(request.body);
      if (!body.success) return reply.code(400).send(INVALID_REQUEST);
      const userId = request.user!.id;
      try {
        const age = ageGateOf(await readTryonProfile(db, userId));
        if (age === "unknown") return reply.code(403).send(ACCESS_REFUSALS.tryon_age_required);
        if (age === "minor") return reply.code(403).send(ACCESS_REFUSALS.tryon_minor);
        if (body.data.version !== TRYON_CONSENT_VERSION) return reply.code(409).send(ACCESS_REFUSALS.tryon_consent_outdated);
        await acceptConsent(db, userId, body.data.version, now());
      } catch (error) {
        request.log.error({ error }, "Essayage : consentement non enregistré");
        return reply.code(500).send(INTERNAL_ERROR);
      }
      const response: TryonConsentResponse = { consent: { required: false, version: TRYON_CONSENT_VERSION } };
      return reply.send(response);
    }
  );

  // ---- Consentement : retirer, toujours possible (même éteint, même suspendu) ----
  fastify.delete(
    "/api/tryon/consent",
    { preHandler: [fastify.requireAuth, fastify.rateLimit("tryonConsent")], config: { rateLimitName: "tryonConsent" } },
    async (request, reply) => {
      try {
        await withdrawConsent(db, request.user!.id, now());
      } catch (error) {
        request.log.error({ error }, "Essayage : retrait du consentement impossible");
        return reply.code(500).send(INTERNAL_ERROR);
      }
      const response: TryonConsentResponse = { consent: { required: true, version: TRYON_CONSENT_VERSION } };
      return reply.send(response);
    }
  );

  // ---- Un essai ----
  fastify.post(
    "/api/tryon",
    {
      preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("tryonRunUser"), fastify.rateLimit("tryonRunUserDaily"), fastify.rateLimit("tryonRunGlobal")],
      config: { rateLimitName: "tryonRunUser" },
    },
    async (request, reply) => {
      const startedAt = Date.now();
      const config = await active();
      if (!config || !provider) return reply.code(503).send(FEATURE_DISABLED);
      const userId = request.user!.id;
      const locale = requestLocale(request);

      // 1. Accès, avant même de lire la photo : majeur, consentement en vigueur.
      let refusal: TryonAccessRefusal | null;
      try {
        refusal = accessRefusal(await readTryonProfile(db, userId), TRYON_CONSENT_VERSION);
      } catch (error) {
        request.log.error({ error }, "Essayage : profil illisible");
        return reply.code(500).send(INTERNAL_ERROR);
      }
      if (refusal) return reply.code(403).send(ACCESS_REFUSALS[refusal]);
      if (!request.isMultipart()) return reply.code(400).send(INVALID_REQUEST);
      const upload = await readTryonUpload(request);
      if (upload === "too_large") return reply.code(413).send(FILE_TOO_LARGE);
      if (upload === "invalid") return reply.code(400).send(INVALID_REQUEST);

      const buffers: Buffer[] = [upload.photo];
      try {
        // « Cette photo est la mienne » : exigé à chaque essai.
        if (upload.attestSelf !== "true") return reply.code(400).send(ATTEST_REQUIRED);
        const itemId = ITEM_ID.safeParse(upload.itemId);
        if (!itemId.success) return reply.code(400).send(INVALID_REQUEST);

        // 2. La pièce : un résultat d'une recherche du membre, retrouvé dans la base.
        const match = await findOwnMatchWithLinks(fastify, userId, itemId.data);
        if (!match) return reply.code(404).send(ITEM_NOT_FOUND);
        const garmentUrls = tryonGarmentUrls(match, config.requireBuyLink);
        if (!garmentUrls) return reply.code(422).send(ITEM_NOT_ELIGIBLE);

        // 3. Réservation atomique dans la base : quota, un essai à la fois, budget.
        const reservation = await reserveTry(db, userId, itemId.data, config);
        if (reservation.status !== "reserved") return await refusedReservation(request, reply, reservation.status, config);

        try {
          // 4. Solde de crédits ; 5. photo ; 6-7. pièce et fournisseur ; 8. bandeau.
          await ensureProviderCredits(request.log, config, provider);
          const personImage = await preparePhoto(upload.photo);
          buffers.push(personImage);
          const { output, garment } = await runWithGarmentFallback(provider, personImage, garmentUrls, locale);
          buffers.push(output.image);
          const banded = await bandResult(output.image, locale);
          buffers.push(banded);

          const durationMs = Date.now() - startedAt;
          const completion = await recordSuccess(request.log, reservation.eventId, userId, output.creditsUsed, durationMs, config);
          if (completion?.status === "completed") {
            for (const kind of completion.newAlerts) {
              notifyTryonAlert(request.log, kind, { periode: monthKeyAt(now(), config.timeZone), budget_usd: config.monthlyBudgetUsd });
            }
          } else {
            // L'image est remise quand même : le membre n'a pas à payer une panne de la base.
            request.log.error({ completed: false }, "Essayage réussi, décompte non confirmé par la base");
          }
          const remaining = completion?.status === "completed" ? { free: completion.free, bonus: completion.bonus } : estimatedRemaining(reservation);
          request.log.info(
            { durationMs, creditsUsed: output.creditsUsed, quotaSource: completion?.status === "completed" ? completion.quotaSource : null, garment },
            "Essayage réussi"
          );
          const response: TryonRunResponse = {
            image: jpegDataUri(banded),
            remaining: { ...remaining, nextReset: nextMonthStart(now(), config.timeZone).toISOString() },
          };
          return reply.header("Cache-Control", "no-store").send(response);
        } catch (error) {
          // 9. Échec : un code court dans la base, rien de décompté, un message clair.
          const failure = failureOf(error);
          if (failure.code === "internal") request.log.error({ error }, "Essayage : erreur imprévue");
          if (failure.code === "out_of_credits") await raiseAlert(request.log, "low_credits", dayKeyAt(now(), config.timeZone), { solde: 0, minimum: config.minProviderCredits });
          if (failure.code === "unauthorized") request.log.error({ code: failure.code }, "Essayage : clé du fournisseur refusée");
          await failTry(db, reservation.eventId, userId, failure.code, Date.now() - startedAt).catch((failError: unknown) =>
            request.log.error({ error: failError }, "Essayage : échec non enregistré")
          );
          request.log.warn({ code: failure.code, status: error instanceof TryonProviderError ? error.status : undefined }, "Essayage échoué");
          return reply.code(failure.status).send(failure.body);
        }
      } catch (error) {
        request.log.error({ error }, "Essayage : préparation impossible");
        return reply.code(500).send(INTERNAL_ERROR);
      } finally {
        // Photo, image envoyée et image produite : effacées dès la réponse.
        for (const buffer of buffers) buffer.fill(0);
      }
    }
  );

  // ---- Signaler un résultat (sans image) ----
  fastify.post(
    "/api/tryon/report",
    { preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("tryonReport")], config: { rateLimitName: "tryonReport" } },
    async (request, reply) => {
      const config = await active();
      if (!config) return reply.code(503).send(FEATURE_DISABLED);
      const body = REPORT_BODY.safeParse(request.body);
      if (!body.success) return reply.code(400).send(INVALID_REPORT);
      const userId = request.user!.id;
      const comment = body.data.comment?.trim() || null;
      try {
        if (!(await hasTriedItem(db, userId, body.data.itemId))) return reply.code(404).send(ITEM_NOT_FOUND);
        await insertReport(db, userId, body.data.itemId, body.data.reason, comment);
      } catch (error) {
        request.log.error({ error }, "Essayage : signalement non enregistré");
        return reply.code(500).send(INTERNAL_ERROR);
      }
      request.log.info({ reason: body.data.reason }, "Essayage signalé");
      return reply.code(204).send();
    }
  );
}
