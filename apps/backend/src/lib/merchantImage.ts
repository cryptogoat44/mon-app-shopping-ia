// Une grande image pour les pièces qui n'en ont qu'une petite (retours du
// build 2, 24 novembre 2026 : « la qualité des images quand elles sont
// grossies est nulle »). Les résultats de Google Shopping n'ont qu'une petite
// vignette de Google (image_hd_url vide). Pour une pièce GARDÉE (envie) ou
// ACHETÉE (Vault) sans image HD, notre serveur lit UNE fois la page publique
// de la boutique, comme le robot d'aperçu d'un lien, pour y trouver l'adresse
// de la grande image (og:image, puis twitter:image, puis l'image du produit
// décrite en JSON-LD). Gratuit : aucun service payant, seulement la bande
// passante du serveur.
//
// INTERRUPTEUR : MERCHANT_IMAGE_UPGRADE_ENABLED, ÉTEINT par défaut (seule la
// valeur exacte "true" l'allume, src/env.ts). Éteint : rien n'est lu, rien
// n'est écrit, aucune requête ne part.
//
// Vie privée : la boutique ne reçoit RIEN du membre — ni identité, ni adresse
// IP (c'est notre serveur qui appelle), ni cookie, ni « referer » : seulement
// l'adresse de sa propre page, déjà rangée avec la pièce, et l'identité
// honnête de notre robot (la même que pour la copie des images).
// Garde-fous : tous ceux de lib/publicImage.ts (https, adresses publiques
// revérifiées à chaque redirection, DNS épinglé, 3 redirections au plus), et
// ici : 6 s au total, page text/html seulement, 512 Ko lus au plus. L'image
// trouvée passe les contrôles existants (adresse https vérifiée, téléchargée
// avec les mêmes garde-fous, vraie image JPEG/PNG/WebP/GIF/HEIF lisible), et
// doit être assez grande (400 px au moins de chaque côté) et de forme
// raisonnable (pas une bannière) : sinon rien n'est écrit.
// Écrit seulement dans la colonne existante product_matches.image_hd_url, et
// seulement si elle est encore vide (aucune migration). fetchHdImageUrls
// (lib/pieceImages.ts) la sert ensuite partout ; l'app ne la montre que si
// elle est vraiment plus grande que la vignette.
// Jamais d'échec visible : tout se passe après la réponse, toute erreur est
// avalée (journal sans adresse). Une tentative par résultat et par jour au
// plus (mémoire du processus), une lecture à la fois, 6 par minute au plus.
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
const ATTEMPTS_PER_MINUTE = 6;

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

function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    const name = match[1]!.toLowerCase();
    if (!attributes.has(name)) attributes.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? "").trim());
  }
  return attributes;
}

/** Contenu des balises <meta> dont property ou name vaut l'un des noms, dans
 * l'ordre des noms (le premier nom trouvé gagne). */
function metaContent(html: string, names: readonly string[]): string | null {
  const found = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
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
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(match[1]!);
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
// Mémoire et rythme (dans le processus : aucune colonne nouvelle)

const attempted = new Map<string, number>();
let running = false;
let windowStart = 0;
let windowCount = 0;

/** Pour les tests seulement. */
export function resetMerchantImageMemory(): void {
  attempted.clear();
  running = false;
  windowStart = 0;
  windowCount = 0;
}

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

function takeSlot(now: number): boolean {
  if (running) return false;
  if (now - windowStart >= 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  if (windowCount >= ATTEMPTS_PER_MINUTE) return false;
  windowCount += 1;
  running = true;
  return true;
}

interface MatchRow {
  id: string;
  image_url: string;
  image_hd_url: string | null;
  merchant_url: string | null;
}

/** Cherche et range la grande image du résultat d'une pièce gardée ou
 * achetée, si elle manque. `servedHdUrl` : l'image HD déjà servie pour cette
 * pièce (fetchHdImageUrls) ; rien à faire si elle existe. Ne rejette jamais. */
export async function upgradeMerchantImage(
  fastify: FastifyInstance,
  log: FastifyBaseLogger,
  piece: { product_match_id: string | null; image_url: string },
  servedHdUrl: string | null,
  resolver?: Resolver
): Promise<"off" | "skipped" | "busy" | "none" | "written"> {
  if (!merchantImageUpgradeEnabled()) return "off";
  const matchId = piece.product_match_id;
  if (!matchId || servedHdUrl) return "skipped";
  const now = Date.now();
  if (recentlyAttempted(matchId, now)) return "skipped";
  if (!takeSlot(now)) return "busy";
  try {
    remember(matchId, now);
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
  } finally {
    running = false;
  }
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
