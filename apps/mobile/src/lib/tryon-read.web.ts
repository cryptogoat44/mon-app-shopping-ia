// Essayage virtuel photo (site) : lecture stricte de ce qui arrive du serveur
// et de ce que la personne saisit. Rien n'est cru sur parole : un statut qui
// n'a pas exactement la forme attendue vaut « fonction indisponible » (rien
// ne s'affiche), une autre réponse illisible vaut null. Le serveur revérifie
// tout de son côté (zod) : ces contrôles évitent seulement d'afficher ou
// d'envoyer n'importe quoi. L'app n'embarque pas zod : Metro n'élague pas le
// code, la bibliothèque entière (96 à 454 Ko) partirait dans le site de tout
// le monde, fonction éteinte comprise. Mêmes règles ici, écrites à la main
// et testées, comme les autres lecteurs de l'app (lib/collections.ts…).
// Fichier .web : jamais dans l'app iPhone (règle 2.5.19 d'Apple). Logique
// pure, testée (tests/tryon-flow.test.ts). Imports de types seulement.
import type { TryonAgeGate, TryonConsentState, TryonRemaining, TryonReportReason, TryonReportRequest, TryonRunResponse, TryonStatus } from "@monapp/shared-types";

/** Fonction coupée : la seule forme permise d'un statut éteint. */
export const TRYON_OFF: TryonStatus = { enabled: false };

const AGE_GATES: readonly TryonAgeGate[] = ["unknown", "adult", "minor"];
/** Même motif que z.guid() du serveur : 8-4-4-4-12 chiffres hexadécimaux. */
const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** Version du consentement (« 2026-11-v1 ») : renvoyée telle quelle au serveur. */
const CONSENT_VERSION = /^[A-Za-z0-9._-]{1,64}$/;
/** Date ISO 8601 : un jour (« 2026-12-01 ») ou un instant complet (« 2026-12-01T00:00:00+01:00 », « …Z »). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))?$/;
/** Au-delà, un compteur n'a plus de sens : réponse refusée. */
const MAX_COUNT = 100_000;

/** Image renvoyée par le serveur : un JPEG en base64, rien d'autre. */
const JPEG_DATA_URI_PREFIX = "data:image/jpeg;base64,";
/** L'image fait quelques centaines de Ko (photo de 1 296 px au plus) : 20 millions de caractères suffisent largement. */
const MAX_IMAGE_TEXT_LENGTH = 20_000_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Motifs d'un signalement, dans l'ordre de l'écran. */
export const REPORT_REASONS: readonly TryonReportReason[] = ["inappropriate", "wrong_piece", "poor_quality", "other"];
/** Commentaire facultatif d'un signalement : 500 caractères au plus (comme le serveur). */
export const REPORT_COMMENT_MAX_LENGTH = 500;
/** Date de naissance la plus ancienne acceptée (comme le serveur). */
export const OLDEST_BIRTH_DATE = "1900-01-01";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT;
}

export function isGuid(value: unknown): value is string {
  return typeof value === "string" && GUID.test(value);
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
}

export function readRemaining(value: unknown): TryonRemaining | null {
  if (!isRecord(value) || !isCount(value.free) || !isCount(value.bonus) || !isIsoDate(value.nextReset)) return null;
  return { free: value.free, bonus: value.bonus, nextReset: value.nextReset };
}

export function readConsentState(value: unknown): TryonConsentState | null {
  if (!isRecord(value) || typeof value.required !== "boolean" || typeof value.version !== "string" || !CONSENT_VERSION.test(value.version)) return null;
  return { required: value.required, version: value.version };
}

/** GET /api/tryon/status : seul `enabled: true` (booléen), avec tous ses
 * champs lisibles, ouvre l'essayage ; tout le reste vaut « éteint ». */
export function readTryonStatus(body: unknown): TryonStatus {
  if (!isRecord(body) || body.enabled !== true) return TRYON_OFF;
  const ageGate = AGE_GATES.find((gate) => gate === body.ageGate);
  const consent = readConsentState(body.consent);
  const remaining = readRemaining(body.remaining);
  if (!ageGate || !consent || !remaining) return TRYON_OFF;
  return { enabled: true, ageGate, consent, remaining };
}

/** POST /api/tryon/age-gate : « adult » ou « minor », rien d'autre. */
export function readAgeGateResponse(body: unknown): "adult" | "minor" | null {
  if (!isRecord(body)) return null;
  return body.ageGate === "adult" || body.ageGate === "minor" ? body.ageGate : null;
}

/** POST et DELETE /api/tryon/consent. */
export function readConsentResponse(body: unknown): TryonConsentState | null {
  return isRecord(body) ? readConsentState(body.consent) : null;
}

/** L'image produite : « data:image/jpeg;base64,… », base64 valide, taille bornée. */
export function isJpegDataUri(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(JPEG_DATA_URI_PREFIX) || value.length > MAX_IMAGE_TEXT_LENGTH) return false;
  const data = value.slice(JPEG_DATA_URI_PREFIX.length);
  return data.length > 0 && data.length % 4 === 0 && BASE64.test(data);
}

/** POST /api/tryon : l'image et les essais restants. */
export function readRunResponse(body: unknown): TryonRunResponse | null {
  if (!isRecord(body) || !isJpegDataUri(body.image)) return null;
  const remaining = readRemaining(body.remaining);
  return remaining ? { image: body.image, remaining } : null;
}

/** Partie base64 d'une image produite déjà vérifiée par isJpegDataUri. */
export function base64Of(dataUri: string): string {
  return dataUri.slice(JPEG_DATA_URI_PREFIX.length);
}

// ---- Pièce essayable ----

/** Ce qu'une fiche de pièce donne au bouton « Essayer ». */
export interface PieceForTryon {
  matchId: string | null;
  imageUrls: readonly (string | null | undefined)[];
  buyUrl: string | null;
}

function urlWithProtocol(value: unknown, protocols: readonly string[]): boolean {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Identifiant à envoyer pour cette pièce, ou null si elle ne s'y prête pas :
 * une proposition du Spotter (identifiant du serveur), une image en https et
 * un lien d'achat. Une envie reçue d'un ami ou une photo personnelle du Vault
 * n'ont pas de proposition d'origine : pas de bouton. Le serveur décide en
 * dernier (la proposition doit venir d'une recherche de la personne). */
export function tryonItemId(piece: PieceForTryon): string | null {
  if (!isGuid(piece.matchId)) return null;
  if (!piece.imageUrls.some((url) => urlWithProtocol(url, ["https:"]))) return null;
  if (!urlWithProtocol(piece.buyUrl, ["https:", "http:"])) return null;
  return piece.matchId;
}

// ---- Date de naissance (porte d'âge) ----

export type BirthDateIssue = "incomplete" | "invalid" | "future" | "too_old";

/** Contrôle avant l'envoi, pour un message immédiat : le serveur calcule
 * seul l'âge (fuseau Europe/Paris) et refuse aussi ces cas. `today` : le jour
 * à Paris, « AAAA-MM-JJ » (parisDay). */
export function checkBirthDate(value: string, today: string): BirthDateIssue | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "incomplete";
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "invalid";
  if (value < OLDEST_BIRTH_DATE) return "too_old";
  if (value > today) return "future";
  return null;
}

// ---- Signalement ----

/** Le signalement à envoyer, ou null s'il est incomplet (motif manquant,
 * pièce illisible, commentaire trop long). Commentaire vide : non envoyé. */
export function buildReport(itemId: string, reason: TryonReportReason | null, rawComment: string): TryonReportRequest | null {
  if (!isGuid(itemId) || reason === null || !REPORT_REASONS.includes(reason)) return null;
  const comment = rawComment.trim();
  if (comment.length > REPORT_COMMENT_MAX_LENGTH) return null;
  return comment ? { itemId, reason, comment } : { itemId, reason };
}
