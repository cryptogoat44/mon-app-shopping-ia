// Journaux du serveur sans donnée personnelle (lot « filets de sécurité »,
// point 33 de la feuille de route V1). Les journaux de Render ne doivent
// jamais contenir les mots tapés, un chemin de fichier, une adresse e-mail ni
// un identifiant de compte. Deux règles, appliquées à TOUTES les lignes
// (app.ts, options du journal) :
//
// 1. Chaque requête est notée avec sa route telle que déclarée
//    (« GET /api/users/:userId »), jamais avec l'adresse réelle : ni la partie
//    « ?q=… » (les mots de la recherche de personnes), ni l'identifiant du
//    compte, de la recherche ou de la publication dans le chemin. Une adresse
//    inconnue du serveur est notée « (route inconnue) ».
// 2. Une erreur passée au journal (« { error } », « { uploadError } »…) est
//    réduite à son nom, son code et son statut. Le message et les détails
//    d'une erreur de la base peuvent reprendre la ligne refusée (« Failing
//    row contains (…) » : identifiants, textes tapés), et ceux du stockage le
//    chemin du fichier. Le code suffit à reconnaître la panne (23505 : doublon,
//    23503 : clé étrangère, 42P01 : table absente, PGRST116 : aucune ligne…).
//    Le détail d'une erreur imprévue part à Sentry, nettoyé (lib/sentry.ts).
// 3. Filet final, sur chaque ligne prête à partir : un identifiant (UUID), une
//    adresse e-mail ou la partie « ?… » d'une adresse qui resterait (message
//    interne de Fastify, texte écrit plus tard sans y penser) est remplacé
//    par « :id », « :email » ou « ?… ».
// 4. Essayage virtuel (lot « essayage virtuel ») : jamais une image dans un
//    journal ni à Sentry. Les champs qui pourraient en porter (corps des
//    requêtes et des réponses, photo, image, date de naissance…) sont
//    masqués par le journal lui-même (LOG_REDACT_PATHS, app.ts) ; et, filet
//    final, toute image en « data URI » ou longue suite en base64 qui
//    resterait dans une ligne (ou dans un événement Sentry, lib/sentry.ts)
//    est remplacée par « [données masquées] » (scrubBinaryText).
// Les adresses inconnues du serveur ont leur propre réponse 404 (app.ts) :
// celle de Fastify notait « Route GET:/… not found », adresse entière comprise.
//
// L'adresse IP reste notée (remoteAddress) : la politique de confidentialité
// annonce des journaux techniques avec l'adresse IP.
import type { FastifyRequest } from "fastify";

/** Route déclarée de la requête, sans aucune valeur venue de l'adresse. */
export function loggedRoute(request: Pick<FastifyRequest, "routeOptions">): string {
  return request.routeOptions?.url ?? "(route inconnue)";
}

/** Champs « req » des lignes « incoming request » de Fastify. */
export function requestLogFields(request: FastifyRequest) {
  return {
    method: request.method,
    url: loggedRoute(request),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}

const NAME = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const CODE = /^[A-Za-z0-9_.-]{1,40}$/;
const KIND = /^[a-z][a-z0-9_]{0,39}$/;

/** Une erreur JavaScript, ou une erreur rendue par supabase-js (objet avec un message). */
function isErrorLike(value: unknown): value is object {
  if (value instanceof Error) return true;
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as { message?: unknown }).message === "string";
}

function shortText(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function httpStatus(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599) return value;
  if (typeof value === "string" && /^[1-5]\d\d$/.test(value)) return Number(value);
  return undefined;
}

/** Ce qu'on garde d'une erreur : nom, code, statut, et la nature d'une panne
 * du fournisseur ou de l'IA (« refused », « timeout »…). Jamais son message. */
export function errorSummary(error: object): Record<string, string | number> {
  const fields = error as Record<string, unknown>;
  const summary: Record<string, string | number> = {};
  const name = shortText(fields.name, NAME);
  if (name) summary.name = name;
  const code = typeof fields.code === "number" ? fields.code : shortText(fields.code, CODE);
  if (code !== undefined) summary.code = code;
  const status = httpStatus(fields.status) ?? httpStatus(fields.statusCode);
  if (status !== undefined) summary.status = status;
  const kind = shortText(fields.kind, KIND);
  if (kind) summary.kind = kind;
  return summary;
}

/** « formatters.log » du journal : chaque erreur, à la racine de la ligne, est
 * remplacée par son résumé ; le reste de la ligne ne change pas. */
export function withoutErrorDetails(fields: Record<string, unknown>): Record<string, unknown> {
  let cleaned: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(fields)) {
    if (!isErrorLike(value)) continue;
    cleaned ??= { ...fields };
    cleaned[key] = errorSummary(value);
  }
  return cleaned ?? fields;
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Un chemin (« /… ») suivi de « ?… », jusqu'à l'espace, au guillemet ou à
// l'échappement JSON suivant : la ligne reste un JSON valide.
const QUERY = /(\/[^\s"'?\\]*)\?[^\s"'\\]+/g;

/** Ce qui remplace une image ou une donnée binaire (sans guillemet ni barre
 * oblique inverse : la ligne reste un JSON valide). */
export const MASKED_DATA = "[données masquées]";
// Une image en « data URI » (« data:image/jpeg;base64,… »), et toute suite de
// 100 caractères base64 ou plus : jamais du texte, toujours des octets.
const DATA_URI = /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]*={0,2}/gi;
const BASE64_RUN = /[A-Za-z0-9+/]{100,}={0,2}/g;

/** Le texte sans aucune image en « data URI » ni longue suite en base64. */
export function scrubBinaryText(text: string): string {
  return text.replace(DATA_URI, `data:${MASKED_DATA}`).replace(BASE64_RUN, MASKED_DATA);
}

/** Champs masqués par le journal lui-même (option « redact » de pino) : le
 * corps d'une requête ou d'une réponse, et tout champ qui porterait une
 * image, une photo ou une date de naissance, à la racine d'une ligne ou
 * juste en dessous. Aucune route ne les journalise ; c'est un filet. */
export const LOG_REDACT_PATHS = [
  "body",
  "*.body",
  "payload",
  "*.payload",
  "image",
  "*.image",
  "photo",
  "*.photo",
  "personImage",
  "*.personImage",
  "garmentImage",
  "*.garmentImage",
  "model_image",
  "*.model_image",
  "garment_image",
  "*.garment_image",
  "output",
  "*.output",
  "birthDate",
  "*.birthDate",
];

/** « hooks.streamWrite » du journal : la ligne JSON, sans image, identifiant,
 * e-mail ni partie « ?… » d'adresse. */
export function scrubLogLine(line: string): string {
  return scrubBinaryText(line).replace(QUERY, "$1?…").replace(UUID, ":id").replace(EMAIL, ":email");
}
