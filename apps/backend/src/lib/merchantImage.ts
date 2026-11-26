// Une grande image pour les pièces qui n'en ont qu'une petite (retours du
// build 2, 24 novembre 2026 : « la qualité des images quand elles sont
// grossies est nulle » ; retours du build 3, 25 novembre : « ce n'est
// toujours pas net »). Les résultats de Google Shopping n'ont qu'une petite
// vignette de Google (image_hd_url vide). Notre serveur lit la page publique
// de la boutique, comme le robot d'aperçu d'un lien, pour y trouver
// l'adresse de la grande image (og:image, puis twitter:image, puis l'image
// du produit décrite en JSON-LD). Gratuit : aucun service payant, seulement
// la bande passante du serveur.
//
// DEUX INTERRUPTEURS indépendants, ÉTEINTS par défaut (seule la valeur exacte
// "true" les allume, src/env.ts). Éteints : rien n'est lu, rien n'est écrit,
// aucune requête ne part.
// - MERCHANT_IMAGE_UPGRADE_ENABLED : pièces GARDÉES (Envies) ou ACHETÉES
//   (Vault) sans image HD. Une FILE en mémoire, remplie à la création, à
//   l'ouverture d'une fiche et à l'ouverture des listes des Envies et du
//   Vault : une lecture à la fois, 12 par minute au plus (minute pleine : la
//   file attend la suivante), 100 demandes en attente au plus (au-delà,
//   ignorées : elles reviendront à la prochaine ouverture), jamais deux fois
//   le même résultat.
// - MERCHANT_IMAGE_RESULTS_ENABLED : RÉSULTATS d'une recherche (décision du
//   fondateur, 26 novembre 2026), à n'allumer qu'avec la politique de
//   confidentialité mise à jour. Juste après le rangement d'une section
//   « boutiques » ou « vos mots » (routes/searches.ts), ses 8 premières
//   cartes telles qu'elles sont affichées (l'ordre de la relecture,
//   displayedSection dans lib/searchRows.ts : aucune règle d'ordre nouvelle),
//   jamais les propositions Lens (elles ont déjà leur image) ni une page de
//   Google.
//   Un POOL à part de la file : 3 lectures à la fois, une seule à la fois par
//   boutique (nom d'hôte), 16 s au total par section (ce qui n'a pas commencé
//   est abandonné), 30 lectures par minute pour tout le serveur (au-delà, le
//   reste est abandonné).
//
// Vie privée : la boutique ne reçoit RIEN du membre — ni identité, ni adresse
// IP (c'est notre serveur qui appelle), ni cookie, ni « referer » : seulement
// l'adresse de sa propre page, déjà rangée avec la pièce, et l'identité
// honnête de notre robot (la même que pour la copie des images).
// Garde-fous : tous ceux de lib/publicImage.ts (https, adresses publiques
// revérifiées à chaque redirection, DNS épinglé, 3 redirections au plus), et
// ici : 6 s au total par page, page text/html seulement, 512 Ko lus au plus.
// L'image trouvée passe les contrôles existants (adresse https vérifiée,
// téléchargée avec les mêmes garde-fous, vraie image JPEG/PNG/WebP/GIF/HEIF
// lisible), et doit être assez grande (400 px au moins de chaque côté) et de
// forme raisonnable (pas une bannière) : sinon rien n'est écrit.
// Écrit seulement dans la colonne existante product_matches.image_hd_url, et
// seulement si elle est encore vide (aucune migration, aucun index).
// fetchHdImageUrls (lib/pieceImages.ts) et GET /api/searches/:id la servent
// ensuite ; l'app ne la montre que si elle est vraiment plus grande que la
// vignette.
// Jamais d'échec ni d'attente visible : tout se passe après la réponse, toute
// erreur est avalée (journal : compteurs seulement, jamais d'adresse ni
// d'identifiant). Une tentative par résultat et par jour au plus (mémoire du
// processus, commune aux deux, effacée au redémarrage).
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import sharp from "sharp";
import { env } from "../env.js";
import { isGoogleLink } from "../services/matchFilters.js";
import { IMAGE_REQUEST_HEADERS, MAX_PUBLIC_IMAGE_BYTES, PublicImageError, checkImageUrl, downloadPublicImage, openPublicUrl, type Resolver } from "./publicImage.js";
import { MAX_INPUT_PIXELS, imageFormatOf } from "./imageSafety.js";

export const MERCHANT_PAGE_MAX_BYTES = 512 * 1024;
export const MERCHANT_PAGE_TIMEOUT_MS = 6_000;
/** Plus petit côté accepté pour la grande image (les vignettes de Google
 * font environ 180 à 280 px). */
export const MERCHANT_IMAGE_MIN_SIDE = 400;
/** Rapport largeur/hauteur au plus (dans un sens ou l'autre) : au-delà,
 * c'est une bannière ou un logo, pas la photo d'une pièce. */
export const MERCHANT_IMAGE_MAX_RATIO = 2.5;
const MAX_URL_LENGTH = 2048;
const ATTEMPT_MEMORY_MS = 24 * 60 * 60 * 1000;
const ATTEMPT_MEMORY_MAX = 5_000;
/** File des pièces gardées ou achetées : lectures par minute au plus (une
 * toutes les 5 s environ), une à la fois. */
const ATTEMPTS_PER_MINUTE = 12;
/** Demandes en attente dans la file au plus : au-delà, la demande est
 * ignorée (elle reviendra à la prochaine ouverture). */
export const MERCHANT_QUEUE_MAX = 100;

/** Même robot que pour les images (lib/publicImage.ts), qui demande une page. */
export const PAGE_REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml;q=0.9",
  "user-agent": IMAGE_REQUEST_HEADERS["user-agent"],
} as const;

/** L'interrupteur : seule la valeur exacte "true" l'allume (src/env.ts). */
export function merchantImageUpgradeEnabled(): boolean {
  return env.MERCHANT_IMAGE_UPGRADE_ENABLED;
}

// ---------------------------------------------------------------------------
// Lecture de la page (texte seulement, sans dépendance)

const NAMED_ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", sol: "/" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Une vraie balise <meta> og:image ou twitter:image est bien plus courte :
 * au-delà, elle est ignorée sans être lue. */
const MAX_META_TAG_LENGTH = 4096;

function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  // Le nom ne commence qu'après un blanc ou un guillemet ((?<=…)) : il ne peut
  // pas redémarrer à chaque lettre d'une longue suite sans « = » (lecture linéaire).
  for (const match of tag.matchAll(/(?<=[\s"'/])([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    const name = match[1]!.toLowerCase();
    if (!attributes.has(name)) attributes.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? "").trim());
  }
  return attributes;
}

/** Contenu des balises <meta> dont property ou name vaut l'un des noms, dans
 * l'ordre des noms (le premier nom trouvé gagne). */
function metaContent(html: string, names: readonly string[]): string | null {
  const found = new Map<string, string>();
  // [^<>] et non [^>] : une balise jamais fermée s'arrête au « < » suivant,
  // la lecture reste linéaire même sur une page hostile.
  for (const tag of html.match(/<meta\b[^<>]*>/gi) ?? []) {
    if (tag.length > MAX_META_TAG_LENGTH) continue;
    const attributes = attributesOf(tag);
    const key = (attributes.get("property") ?? attributes.get("name") ?? "").toLowerCase();
    const content = attributes.get("content");
    if (names.includes(key) && content && !found.has(key)) found.set(key, content);
  }
  for (const name of names) {
    const value = found.get(name);
    if (value) return value;
  }
  return null;
}

function isProduct(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  return type === "Product" || (Array.isArray(type) && type.includes("Product"));
}

function firstImage(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const image = firstImage(entry);
      if (image) return image;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const url = (value as Record<string, unknown>).url ?? (value as Record<string, unknown>).contentUrl;
    return typeof url === "string" ? url.trim() || null : null;
  }
  return null;
}

/** Image du premier « Product » décrit en JSON-LD (blocs, tableaux, @graph). */
function jsonLdProductImage(html: string): string | null {
  // Seule la balise ouvrante passe par l'expression ([^<>] : linéaire) ; la
  // fin du bloc est cherchée dans html lui-même (sans toLowerCase, qui peut
  // changer la longueur du texte : « İ »), les balises ouvrantes tombées dans
  // un bloc déjà lu sont sautées, et la boucle s'arrête dès qu'un bloc n'est
  // jamais fermé (une page hostile ne bloque pas le serveur).
  const close = /<\/script\s*>/gi;
  let resumeAt = 0;
  for (const match of html.matchAll(/<script\b[^<>]*type\s*=\s*["']?application\/ld\+json["']?[^<>]*>/gi)) {
    if (match.index < resumeAt) continue;
    const start = match.index + match[0].length;
    close.lastIndex = start;
    const closing = close.exec(html);
    if (!closing) break;
    const end = closing.index;
    resumeAt = close.lastIndex;
    let data: unknown;
    try {
      data = JSON.parse(html.slice(start, end));
    } catch {
      continue;
    }
    const queue: unknown[] = [data];
    for (let seen = 0; queue.length > 0 && seen < 200; seen++) {
      const node = queue.shift();
      if (Array.isArray(node)) queue.push(...node);
      else if (node && typeof node === "object") {
        const record = node as Record<string, unknown>;
        if (isProduct(record)) {
          const image = firstImage(record.image);
          if (image) return image;
        }
        if (record["@graph"]) queue.push(record["@graph"]);
      }
    }
  }
  return null;
}

/** L'adresse de la grande image annoncée par une page HTML, rendue absolue
 * par rapport à l'adresse de la page, ou null. Seulement une adresse https
 * qui passe checkImageUrl (jamais http, data:, ni localhost…). */
export function extractMerchantImageUrl(html: string, pageUrl: string): string | null {
  const candidates = [
    metaContent(html, ["og:image:secure_url", "og:image", "og:image:url"]),
    metaContent(html, ["twitter:image", "twitter:image:src"]),
    jsonLdProductImage(html),
  ];
  for (const candidate of candidates) {
    if (!candidate || candidate.length > MAX_URL_LENGTH) continue;
    try {
      const url = checkImageUrl(new URL(candidate, pageUrl).toString()).toString();
      if (url.length <= MAX_URL_LENGTH) return url;
    } catch {
      // Candidat suivant.
    }
  }
  return null;
}

/** Les premiers octets (512 Ko au plus) de la page publique d'une boutique,
 * avec les garde-fous de lib/publicImage.ts ; refus si ce n'est pas du HTML. */
export async function fetchMerchantPage(pageUrl: string, resolver?: Resolver): Promise<{ html: string; url: string }> {
  const signal = AbortSignal.timeout(MERCHANT_PAGE_TIMEOUT_MS);
  const { response, url } = await openPublicUrl(pageUrl, PAGE_REQUEST_HEADERS, signal, resolver);
  const type = String(response.headers["content-type"] ?? "").toLowerCase();
  if (!type.startsWith("text/html") && !type.startsWith("application/xhtml+xml")) {
    response.resume();
    throw new PublicImageError("Ce n'est pas une page");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of response) {
      const buffer = chunk as Buffer;
      chunks.push(buffer);
      size += buffer.length;
      // Assez lu : l'image est annoncée dans l'en-tête de la page.
      if (size >= MERCHANT_PAGE_MAX_BYTES) break;
    }
  } catch {
    throw new PublicImageError("Page injoignable");
  } finally {
    response.destroy();
  }
  return { html: Buffer.concat(chunks).subarray(0, MERCHANT_PAGE_MAX_BYTES).toString("utf8"), url: url.toString() };
}

/** Une vraie image (premiers octets vérifiés avant sharp : jamais de SVG),
 * lisible, assez grande et pas une bannière. */
export async function isUsableLargeImage(data: Buffer): Promise<boolean> {
  if (data.length === 0 || data.length > MAX_PUBLIC_IMAGE_BYTES || !imageFormatOf(data)) return false;
  try {
    const { width, height } = await sharp(data, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (!width || !height) return false;
    const ratio = Math.max(width, height) / Math.min(width, height);
    return Math.min(width, height) >= MERCHANT_IMAGE_MIN_SIDE && ratio <= MERCHANT_IMAGE_MAX_RATIO;
  } catch {
    return false;
  }
}

/** Page de la boutique lisible par notre robot : https, et jamais une page de
 * Google (un résultat sans lien direct garde la fiche de Google Shopping). */
export function isMerchantPage(url: string | null): url is string {
  if (!url) return false;
  try {
    checkImageUrl(url);
  } catch {
    return false;
  }
  return !isGoogleLink(url);
}

/** Lit la page, trouve la grande image et la vérifie : son adresse, ou null. */
export async function findMerchantImage(pageUrl: string, resolver?: Resolver): Promise<string | null> {
  const page = await fetchMerchantPage(pageUrl, resolver);
  const imageUrl = extractMerchantImageUrl(page.html, page.url);
  if (!imageUrl) return null;
  const data = await downloadPublicImage(imageUrl, resolver);
  return (await isUsableLargeImage(data)) ? imageUrl : null;
}

// ---------------------------------------------------------------------------
// Mémoire (dans le processus : aucune colonne nouvelle), commune à la file et
// au pool des résultats : une tentative par résultat et par jour au plus.

const attempted = new Map<string, number>();

function recentlyAttempted(matchId: string, now: number): boolean {
  const at = attempted.get(matchId);
  if (at === undefined) return false;
  if (now - at < ATTEMPT_MEMORY_MS) return true;
  attempted.delete(matchId);
  return false;
}

function remember(matchId: string, now: number): void {
  attempted.set(matchId, now);
  while (attempted.size > ATTEMPT_MEMORY_MAX) {
    const oldest = attempted.keys().next().value;
    if (oldest === undefined) break;
    attempted.delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// La file des pièces gardées ou achetées (MERCHANT_IMAGE_UPGRADE_ENABLED) :
// une lecture à la fois, ATTEMPTS_PER_MINUTE au plus ; une demande qui arrive
// pendant une lecture, ou quand la minute est pleine, attend son tour au lieu
// d'être abandonnée (retours du build 3).

interface QueuedPiece {
  fastify: FastifyInstance;
  log: FastifyBaseLogger;
  piece: { product_match_id: string; image_url: string };
  resolver?: Resolver;
}

const queue: QueuedPiece[] = [];
/** Résultats en file ou en cours de lecture : jamais deux fois. */
const pendingIds = new Set<string>();
let running = false;
let windowStart = 0;
let windowCount = 0;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;

/** Pour les tests seulement : vide la mémoire, la file, le pool et les minuteurs. */
export function resetMerchantImageMemory(): void {
  attempted.clear();
  queue.length = 0;
  pendingIds.clear();
  running = false;
  windowStart = 0;
  windowCount = 0;
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = null;
  resultJobs.length = 0;
  resultHosts.clear();
  resultActive = 0;
  resultWindowStart = 0;
  resultWindowCount = 0;
}

function minuteFull(now: number): boolean {
  if (now - windowStart >= 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  return windowCount >= ATTEMPTS_PER_MINUTE;
}

interface MatchRow {
  id: string;
  image_url: string;
  image_hd_url: string | null;
  merchant_url: string | null;
}

async function readAndStore({ fastify, log, piece, resolver }: QueuedPiece): Promise<"skipped" | "none" | "written"> {
  const matchId = piece.product_match_id;
  try {
    remember(matchId, Date.now());
    const { data, error } = await fastify.supabaseAdmin
      .from("product_matches")
      .select("id, image_url, image_hd_url, merchant_url")
      .eq("id", matchId)
      .maybeSingle();
    const match = data as MatchRow | null;
    // Une photo personnelle (« Changer la photo ») n'est jamais remplacée : la
    // pièce doit montrer encore l'image de ce résultat (lib/pieceImages.ts).
    if (error || !match || match.image_hd_url || match.image_url !== piece.image_url || !isMerchantPage(match.merchant_url)) return "skipped";
    const found = await findMerchantImage(match.merchant_url, resolver);
    if (!found || found === match.image_url) return "none";
    const { error: writeError } = await fastify.supabaseAdmin
      .from("product_matches")
      .update({ image_hd_url: found })
      .eq("id", matchId)
      .is("image_hd_url", null);
    if (writeError) {
      log.warn({ code: writeError.code }, "Grande image de la boutique : écriture impossible");
      return "none";
    }
    // Pour l'essai du fondateur (SETUP.md) : combien d'images trouvées, sans adresse ni identifiant.
    log.info("Grande image de la boutique : trouvée et rangée");
    return "written";
  } catch (error) {
    // Jamais l'adresse dans le journal : seulement le code de la réponse.
    log.info({ status: error instanceof PublicImageError ? (error.status ?? null) : null }, "Grande image de la boutique : non trouvée");
    return "none";
  }
}

/** Lit une pièce maintenant (créneau pris), puis passe à la suivante de la file. */
async function runNow(item: QueuedPiece): Promise<"skipped" | "none" | "written"> {
  windowCount += 1;
  running = true;
  try {
    return await readAndStore(item);
  } finally {
    running = false;
    pendingIds.delete(item.piece.product_match_id);
    drainQueue();
  }
}

/** La suivante de la file, si rien ne tourne ; minute pleine : un minuteur
 * (unref : il ne retient jamais l'arrêt du serveur) la réveille à la minute
 * suivante. Interrupteur coupé entre-temps : la file est vidée sans rien lire. */
function drainQueue(): void {
  while (!running && queue.length > 0) {
    if (!merchantImageUpgradeEnabled()) {
      queue.length = 0;
      pendingIds.clear();
      return;
    }
    const now = Date.now();
    if (minuteFull(now)) {
      if (!wakeTimer) {
        wakeTimer = setTimeout(
          () => {
            wakeTimer = null;
            drainQueue();
          },
          Math.max(0, windowStart + 60_000 - now)
        );
        wakeTimer.unref?.();
      }
      return;
    }
    const next = queue.shift()!;
    if (recentlyAttempted(next.piece.product_match_id, now)) {
      pendingIds.delete(next.piece.product_match_id);
      continue;
    }
    void runNow(next).catch(() => undefined);
  }
}

/** Cherche et range la grande image du résultat d'une pièce gardée ou
 * achetée, si elle manque. `servedHdUrl` : l'image HD déjà servie pour cette
 * pièce (fetchHdImageUrls) ; rien à faire si elle existe. Lue tout de suite si
 * rien ne tourne (résultat de la lecture), sinon mise en file ("queued" ; au
 * plus MERCHANT_QUEUE_MAX demandes, au-delà ignorée : "skipped"). Ne rejette
 * jamais. */
export async function upgradeMerchantImage(
  fastify: FastifyInstance,
  log: FastifyBaseLogger,
  piece: { product_match_id: string | null; image_url: string },
  servedHdUrl: string | null,
  resolver?: Resolver
): Promise<"off" | "skipped" | "queued" | "none" | "written"> {
  if (!merchantImageUpgradeEnabled()) return "off";
  const matchId = piece.product_match_id;
  if (!matchId || servedHdUrl) return "skipped";
  const now = Date.now();
  if (recentlyAttempted(matchId, now) || pendingIds.has(matchId)) return "skipped";
  const item: QueuedPiece = { fastify, log, piece: { product_match_id: matchId, image_url: piece.image_url }, resolver };
  if (running || queue.length > 0 || minuteFull(now)) {
    if (queue.length >= MERCHANT_QUEUE_MAX) return "skipped";
    queue.push(item);
    pendingIds.add(matchId);
    drainQueue();
    return "queued";
  }
  pendingIds.add(matchId);
  return runNow(item);
}

/** Lance la recherche sans l'attendre (après la réponse) : jamais un échec ni
 * une attente pour le membre. */
export function upgradeMerchantImageLater(
  fastify: FastifyInstance,
  log: FastifyBaseLogger,
  piece: { product_match_id: string | null; image_url: string },
  servedHdUrl: string | null
): void {
  if (!merchantImageUpgradeEnabled() || !piece.product_match_id || servedHdUrl) return;
  setImmediate(() => {
    upgradeMerchantImage(fastify, log, piece, servedHdUrl).catch(() => undefined);
  });
}

/** Listes des Envies et du Vault : met en file les pièces de la page sans
 * grande image, rattachées à un résultat. Après la réponse ; ne rejette
 * jamais ; rien si l'interrupteur est éteint. Une seule lecture de la base
 * pour toute la page, qui écarte les photos personnelles (la pièce ne montre
 * plus l'image du résultat), les résultats déjà en HD et les pages qui ne
 * sont pas celles d'une boutique : seules les autres entrent dans la file. */
export function queueMerchantImages(
  fastify: FastifyInstance,
  log: FastifyBaseLogger,
  pieces: readonly { product_match_id: string | null; image_url: string }[],
  hdUrls: readonly (string | null | undefined)[],
  resolver?: Resolver
): void {
  try {
    if (!merchantImageUpgradeEnabled()) return;
    const now = Date.now();
    const candidates = new Map<string, string>();
    pieces.forEach((piece, index) => {
      const matchId = piece.product_match_id;
      if (!matchId || hdUrls[index] || candidates.has(matchId) || pendingIds.has(matchId) || recentlyAttempted(matchId, now)) return;
      candidates.set(matchId, piece.image_url);
    });
    if (candidates.size === 0) return;
    setImmediate(() => {
      enqueueKeptPieces(fastify, log, candidates, resolver).catch(() => undefined);
    });
  } catch {
    // Jamais un échec de la liste.
  }
}

async function enqueueKeptPieces(fastify: FastifyInstance, log: FastifyBaseLogger, candidates: ReadonlyMap<string, string>, resolver?: Resolver): Promise<void> {
  const { data, error } = await fastify.supabaseAdmin
    .from("product_matches")
    .select("id, image_url, image_hd_url, merchant_url")
    .in("id", [...candidates.keys()]);
  if (error || !Array.isArray(data)) return;
  for (const match of data as MatchRow[]) {
    const imageUrl = candidates.get(match.id);
    if (imageUrl === undefined || match.image_hd_url || match.image_url !== imageUrl || !isMerchantPage(match.merchant_url)) continue;
    void upgradeMerchantImage(fastify, log, { product_match_id: match.id, image_url: imageUrl }, null, resolver).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Le pool des résultats d'une recherche (MERCHANT_IMAGE_RESULTS_ENABLED,
// retours du build 3, décision du fondateur) : à part de la file ci-dessus,
// un seul pour tout le serveur.

/** Les premières cartes d'une section, dans l'ordre affiché (reçu tel quel de routes/searches.ts). */
export const RESULT_IMAGES_PER_SECTION = 8;
/** Lectures en même temps au plus (toutes recherches confondues). */
export const RESULT_IMAGE_CONCURRENCY = 3;
/** Ce qui n'a pas commencé 16 s après le rangement est abandonné. */
export const RESULT_IMAGES_BUDGET_MS = 16_000;
/** Plafond de tout le serveur : au-delà, le reste est abandonné. */
export const RESULT_IMAGES_PER_MINUTE = 30;

/** L'interrupteur des résultats : seule la valeur exacte "true" l'allume (src/env.ts). */
export function merchantImageResultsEnabled(): boolean {
  return env.MERCHANT_IMAGE_RESULTS_ENABLED;
}

type ResultOutcome = "written" | "none" | "abandoned";

interface ResultJob {
  id: string;
  pageUrl: string;
  host: string;
  deadline: number;
  fastify: FastifyInstance;
  log: FastifyBaseLogger;
  resolver?: Resolver;
  done: (outcome: ResultOutcome) => void;
}

const resultJobs: ResultJob[] = [];
/** Boutiques (noms d'hôte) en cours de lecture : une seule lecture à la fois par boutique. */
const resultHosts = new Set<string>();
let resultActive = 0;
let resultWindowStart = 0;
let resultWindowCount = 0;

function takeResultSlot(now: number): boolean {
  if (now - resultWindowStart >= 60_000) {
    resultWindowStart = now;
    resultWindowCount = 0;
  }
  if (resultWindowCount >= RESULT_IMAGES_PER_MINUTE) return false;
  resultWindowCount += 1;
  return true;
}

async function readResult({ id, pageUrl, fastify, log, resolver }: ResultJob): Promise<ResultOutcome> {
  try {
    const found = await findMerchantImage(pageUrl, resolver);
    if (!found) {
      log.info({ status: null }, "Grande image des résultats : non trouvée");
      return "none";
    }
    // Seulement si la colonne est encore vide, et jamais la vignette elle-même.
    const { data, error } = await fastify.supabaseAdmin
      .from("product_matches")
      .update({ image_hd_url: found })
      .eq("id", id)
      .is("image_hd_url", null)
      .neq("image_url", found)
      .select("id");
    if (error) {
      log.warn({ code: error.code ?? null }, "Grande image des résultats : écriture impossible");
      return "none";
    }
    if (!Array.isArray(data) || data.length === 0) return "none";
    // Compteur seulement : ni adresse, ni identifiant.
    log.info("Grande image des résultats : trouvée et rangée");
    return "written";
  } catch (error) {
    log.info({ status: error instanceof PublicImageError ? (error.status ?? null) : null }, "Grande image des résultats : non trouvée");
    return "none";
  }
}

/** Démarre ce qui peut l'être : RESULT_IMAGE_CONCURRENCY lectures au plus,
 * une par boutique, avant la date limite de sa recherche, dans le plafond de
 * la minute (plein : tout ce qui attend est abandonné). */
function launchResultJobs(): void {
  while (resultActive < RESULT_IMAGE_CONCURRENCY && resultJobs.length > 0) {
    const now = Date.now();
    for (let index = resultJobs.length - 1; index >= 0; index--) {
      if (resultJobs[index]!.deadline <= now) resultJobs.splice(index, 1)[0]!.done("abandoned");
    }
    const index = resultJobs.findIndex((job) => !resultHosts.has(job.host));
    if (index < 0) return;
    if (!takeResultSlot(now)) {
      for (const job of resultJobs.splice(0)) job.done("abandoned");
      return;
    }
    const job = resultJobs.splice(index, 1)[0]!;
    resultActive += 1;
    resultHosts.add(job.host);
    remember(job.id, now);
    void readResult(job).then((outcome) => {
      resultActive = Math.max(0, resultActive - 1);
      resultHosts.delete(job.host);
      job.done(outcome);
      launchResultJobs();
    });
  }
}

/** Lit les pages des premières propositions et range leurs grandes images ;
 * rend les compteurs une fois tout fini ou abandonné. Ne rejette jamais. */
export function upgradeResultMerchantImages(
  fastify: FastifyInstance,
  log: FastifyBaseLogger,
  rows: readonly { id: string; merchant_url: string | null }[],
  resolver?: Resolver
): Promise<Record<ResultOutcome, number>> {
  const counts: Record<ResultOutcome, number> = { written: 0, none: 0, abandoned: 0 };
  if (!merchantImageResultsEnabled()) return Promise.resolve(counts);
  const now = Date.now();
  const deadline = now + RESULT_IMAGES_BUDGET_MS;
  const picked: { id: string; pageUrl: string; host: string }[] = [];
  for (const row of rows.slice(0, RESULT_IMAGES_PER_SECTION)) {
    if (!isMerchantPage(row.merchant_url) || recentlyAttempted(row.id, now)) continue;
    picked.push({ id: row.id, pageUrl: row.merchant_url, host: new URL(row.merchant_url).hostname.toLowerCase() });
  }
  if (picked.length === 0) return Promise.resolve(counts);
  return new Promise((resolve) => {
    let left = picked.length;
    const done = (outcome: ResultOutcome) => {
      counts[outcome] += 1;
      left -= 1;
      if (left === 0) resolve(counts);
    };
    for (const row of picked) resultJobs.push({ ...row, deadline, fastify, log, resolver, done });
    launchResultJobs();
  });
}

/** Résultats d'une recherche (MERCHANT_IMAGE_RESULTS_ENABLED) : les 8
 * premières cartes affichées d'une section "shopping" ou "words" qui vient
 * d'être rangée (`rows` dans l'ordre affiché ; une fonction : calculé
 * seulement interrupteur allumé, et jamais un échec du rangement). Après la
 * réponse ; ne rejette jamais. */
export function queueResultMerchantImages(
  fastify: FastifyInstance,
  log: FastifyBaseLogger,
  rows: readonly { id: string; merchant_url: string | null }[] | (() => readonly { id: string; merchant_url: string | null }[]),
  resolver?: Resolver
): void {
  try {
    if (!merchantImageResultsEnabled()) return;
    const first = (typeof rows === "function" ? rows() : rows)
      .slice(0, RESULT_IMAGES_PER_SECTION).map((row) => ({ id: row.id, merchant_url: row.merchant_url }));
    if (first.length === 0) return;
    setImmediate(() => {
      upgradeResultMerchantImages(fastify, log, first, resolver)
        .then((counts) => {
          if (counts.abandoned > 0) log.info({ abandoned: counts.abandoned }, "Grande image des résultats : abandonnées (temps ou plafond)");
        })
        .catch(() => undefined);
    });
  } catch {
    // Jamais un échec du rangement.
  }
}
