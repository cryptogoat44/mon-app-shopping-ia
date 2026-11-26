// La couleur des bords de la vignette des propositions (retours du build 3,
// lot « couleur des bords » ; le fondateur, 26 novembre 2026 : « oui très
// bonne idée aussi »). La tuile de pièce de l'app (« Écrin », 4:5) pose une
// photo qui ne remplit pas son cadre sur une copie floue d'elle-même ; quand
// les bords de la photo sont d'une couleur unie (fond blanc, gris clair,
// ivoire), ce fond uni, exactement celui de la photo, est plus net : plus
// jamais de bande visible. Dans la maquette : la règle « fond-prolonge ».
//
// INTERRUPTEUR EDGE_COLOR_ENABLED, ÉTEINT par défaut (seule la valeur exacte
// "true" l'allume, src/env.ts) : notre serveur télécharge une image qu'il ne
// téléchargeait pas ; à allumer seulement une fois la politique de
// confidentialité mise à jour. Éteint : rien n'est téléchargé, rien n'est
// servi (les réponses sont celles d'avant, au champ près).
//
// Ce qui est mesuré : la VIGNETTE de la proposition (image_url, petite,
// souvent chez Google), jamais l'image haute définition ni une photo du
// membre. Où : les 12 premières propositions d'une réponse de recherche
// (routes/searches.ts), les pièces des listes et des fiches des Envies et du
// Vault dont l'image est encore celle du résultat (routes/wishlist.ts,
// routes/vault.ts). Toutes selon la même règle, dans l'ordre déjà rangé :
// aucune boutique favorisée.
//
// Vie privée : la boutique ou Google ne reçoivent RIEN du membre (c'est notre
// serveur qui appelle, avec l'identité honnête de notre robot, sans cookie).
// L'image est lue en mémoire puis oubliée ; seules sont gardées, EN MÉMOIRE
// du serveur (aucune colonne, aucune migration), une EMPREINTE de l'adresse
// de la vignette (SHA-256 : l'adresse elle-même n'est pas gardée) et sa
// couleur (« #rrggbb ») ou la mention « non mesurable », 7 jours au plus
// (1 jour pour « non mesurable »), sans lien avec un compte ni une
// recherche ; un balayage régulier efface ce qui a passé sa durée, même sans
// nouvelle visite. Journal : des compteurs seulement, jamais d'adresse.
//
// Garde-fous : ceux de lib/publicImage.ts (https, adresses publiques
// revérifiées à chaque redirection, DNS épinglé, 3 redirections au plus) ;
// ici, 4 s et 1 Mo au plus par image, vraie image vérifiée aux premiers
// octets (jamais de SVG), mémoire du décodage estimée avant de décoder, un
// décodage à la fois (lib/imageSafety.ts) ; 2 téléchargements à la fois,
// 30 par minute pour tout le serveur (au-delà : rien, l'adresse reviendra à
// la prochaine ouverture) ; une tentative par adresse et par jour, même en
// échec. Tout se passe APRÈS la réponse : jamais une attente pour le membre.
import { createHash } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import sharp from "sharp";
import { env } from "../env.js";
import { IMAGE_REQUEST_HEADERS, checkImageUrl, openPublicUrl, type Resolver } from "./publicImage.js";
import { MAX_INPUT_PIXELS, imageFormatOf, isTooHeavyToDecode, oneImageAtATime } from "./imageSafety.js";

/** Plus lourd : ce n'est pas une vignette, rien n'est mesuré. */
export const EDGE_COLOR_MAX_BYTES = 1024 * 1024;
/** Délai total d'un téléchargement. */
export const EDGE_COLOR_TIMEOUT_MS = 4_000;
/** La tuile de l'app est toujours en 4:5. */
const TILE_RATIO = 4 / 5;
/** En deçà de cet écart de forme, la photo remplit la tuile (même règle que
 * l'app, lib/piece-image.ts) : aucune bande, aucune couleur nécessaire. */
const FILL_TOLERANCE = 1.12;
/** Taille de lecture : assez pour des bords fiables, presque rien à décoder. */
const SAMPLE_WIDTH = 48;
const SAMPLE_HEIGHT = 60;
/** Épaisseur des bords mesurés, en pixels de l'image réduite. */
const EDGE_THICKNESS = 2;
/** Un pixel « de la couleur du bord » : plus grand écart d'un canal (sur 255). */
const PIXEL_TOLERANCE = 10;
/** Part des pixels d'un bord qui doivent être de sa couleur. */
const UNIFORM_SHARE = 0.95;
/** Écart au plus entre les deux bords (plus grand écart d'un canal). */
const EDGES_TOLERANCE = 8;

/** Propositions mesurées par réponse de recherche, dans son ordre. */
export const EDGE_COLORS_PER_SEARCH = 12;
/** Téléchargements en même temps au plus, pour tout le serveur. */
export const EDGE_COLOR_CONCURRENCY = 2;
/** Mesures par minute au plus, pour tout le serveur. */
export const EDGE_COLORS_PER_MINUTE = 30;
/** Entrées gardées au plus (les plus anciennes sortent). */
export const EDGE_COLOR_CACHE_MAX = 5_000;
/** Durée de vie d'une couleur mesurée. */
export const EDGE_COLOR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Une tentative par adresse et par jour : bords non uniformes ou échec. */
export const EDGE_COLOR_RETRY_MS = 24 * 60 * 60 * 1000;
const MAX_URL_LENGTH = 2048;

/** L'interrupteur : seule la valeur exacte "true" l'allume (src/env.ts). */
export function edgeColorEnabled(): boolean {
  return env.EDGE_COLOR_ENABLED;
}

// ---------------------------------------------------------------------------
// La mesure (pure sur les octets)

type Rgb = [number, number, number];

function hex(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, "0");
}

/** Couleur moyenne d'un bord, ou null si ce bord n'est pas uniforme. */
function uniformEdge(pixels: readonly Rgb[]): Rgb | null {
  if (pixels.length === 0) return null;
  let [r, g, b] = [0, 0, 0];
  for (const pixel of pixels) {
    r += pixel[0];
    g += pixel[1];
    b += pixel[2];
  }
  const mean: Rgb = [r / pixels.length, g / pixels.length, b / pixels.length];
  let close = 0;
  for (const pixel of pixels) {
    if (Math.max(...pixel.map((value, c) => Math.abs(value - mean[c]!))) < PIXEL_TOLERANCE) close += 1;
  }
  return close / pixels.length >= UNIFORM_SHARE ? mean : null;
}

/** Les bords où la tuile 4:5 montrera des bandes, d'après la forme de la
 * photo : « haut et bas » pour une photo plus large que la tuile, « gauche
 * et droite » pour une photo plus étroite, null si elle la remplit. */
export function edgesToMeasure(width: number, height: number): "top-bottom" | "left-right" | null {
  if (!(width > 0) || !(height > 0)) return null;
  const ratio = width / height;
  if (ratio > TILE_RATIO * FILL_TOLERANCE) return "top-bottom";
  if (ratio < TILE_RATIO / FILL_TOLERANCE) return "left-right";
  return null;
}

/** La couleur unie des bords d'une image (« #rrggbb » en minuscules), ou null :
 * pas une vraie image, plus de 1 Mo, trop lourde à décoder, photo qui remplit
 * déjà la tuile, bords pas uniformes, ou toute erreur. La transparence prend
 * le blanc. */
export async function measureEdgeColor(data: Buffer): Promise<string | null> {
  try {
    if (data.length === 0 || data.length > EDGE_COLOR_MAX_BYTES || !imageFormatOf(data)) return null;
    const header = await sharp(data, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (isTooHeavyToDecode(header)) return null;
    const { data: raw, info } = await oneImageAtATime(() =>
      sharp(data, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .flatten({ background: "#ffffff" })
        .resize(SAMPLE_WIDTH, SAMPLE_HEIGHT, { fit: "inside" })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
    );
    const { width, height, channels } = info;
    const sides = edgesToMeasure(width, height);
    if (!sides || channels < 3 || width < EDGE_THICKNESS * 2 || height < EDGE_THICKNESS * 2) return null;
    const at = (x: number, y: number): Rgb => {
      const i = (y * width + x) * channels;
      return [raw[i]!, raw[i + 1]!, raw[i + 2]!];
    };
    const first: Rgb[] = [];
    const second: Rgb[] = [];
    for (let t = 0; t < EDGE_THICKNESS; t++) {
      if (sides === "top-bottom") {
        for (let x = 0; x < width; x++) {
          first.push(at(x, t));
          second.push(at(x, height - 1 - t));
        }
      } else {
        for (let y = 0; y < height; y++) {
          first.push(at(t, y));
          second.push(at(width - 1 - t, y));
        }
      }
    }
    const a = uniformEdge(first);
    const b = uniformEdge(second);
    if (!a || !b) return null;
    if (Math.max(...a.map((value, c) => Math.abs(value - b[c]!))) >= EDGES_TOLERANCE) return null;
    return `#${hex((a[0] + b[0]) / 2)}${hex((a[1] + b[1]) / 2)}${hex((a[2] + b[2]) / 2)}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Le cache en mémoire (aucune colonne) : empreinte de l'adresse de la
// vignette → couleur. L'adresse elle-même n'est jamais une clé du cache.

/** Intervalle du balayage des entrées passées. */
export const EDGE_COLOR_SWEEP_MS = 60 * 1000;

const cache = new Map<string, { color: string | null; at: number }>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** L'empreinte (SHA-256) d'une adresse : seule forme gardée par le cache. */
function keyOf(imageUrl: string): string {
  return createHash("sha256").update(imageUrl).digest("base64url");
}

function lifetimeOf(entry: { color: string | null }): number {
  return entry.color ? EDGE_COLOR_TTL_MS : EDGE_COLOR_RETRY_MS;
}

function freshEntry(imageUrl: string, now: number): { color: string | null; at: number } | undefined {
  const key = keyOf(imageUrl);
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (now - entry.at < lifetimeOf(entry)) return entry;
  cache.delete(key);
  return undefined;
}

/** Efface toute entrée qui aura passé sa durée (7 jours, 1 jour pour « non
 * mesurable ») avant le prochain balayage : la durée promise tient même
 * sans nouvelle visite de la même adresse. */
export function sweepExpiredEdgeColors(now: number = Date.now()): void {
  for (const [key, entry] of cache) {
    if (now - entry.at >= lifetimeOf(entry) - EDGE_COLOR_SWEEP_MS) cache.delete(key);
  }
  if (cache.size === 0 && sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

function remember(imageUrl: string, color: string | null, now: number): void {
  const key = keyOf(imageUrl);
  cache.delete(key);
  cache.set(key, { color, at: now });
  while (cache.size > EDGE_COLOR_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  sweepExpiredEdgeColors(now);
  if (!sweepTimer && cache.size > 0) {
    sweepTimer = setInterval(() => sweepExpiredEdgeColors(), EDGE_COLOR_SWEEP_MS);
    sweepTimer.unref?.();
  }
}

/** La couleur des bords déjà mesurée pour cette vignette, ou undefined (pas
 * encore mesurée, bords non uniformes, ou interrupteur éteint). Synchrone :
 * lue au moment de construire une réponse, jamais d'attente. */
export function edgeColorFor(imageUrl: string | null | undefined): string | undefined {
  if (!edgeColorEnabled() || typeof imageUrl !== "string") return undefined;
  return freshEntry(imageUrl, Date.now())?.color ?? undefined;
}

/** Le champ facultatif « edgeColor » d'une réponse : présent seulement quand
 * la couleur des bords de cette vignette est en cache (jamais vide). */
export function edgeColorField(imageUrl: string | null | undefined): { edgeColor?: string } {
  const edgeColor = edgeColorFor(imageUrl);
  return edgeColor ? { edgeColor } : {};
}

// ---------------------------------------------------------------------------
// La file de mesure (après la réponse)

const waiting: { imageUrl: string; log: FastifyBaseLogger; resolver?: Resolver }[] = [];
/** Empreintes des adresses en file (l'adresse ne vit que dans `waiting`,
 * le temps de la mesure). */
const pending = new Set<string>();
let active = 0;
let windowStart = 0;
let windowCount = 0;

/** Pour les tests seulement : vide le cache, la file et le compteur de la minute. */
export function resetEdgeColorMemory(): void {
  cache.clear();
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  waiting.length = 0;
  pending.clear();
  active = 0;
  windowStart = 0;
  windowCount = 0;
}

function takeSlot(now: number): boolean {
  if (now - windowStart >= 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  if (windowCount >= EDGE_COLORS_PER_MINUTE) return false;
  windowCount += 1;
  return true;
}

/** Hébergeurs d'images des réseaux sociaux (un nom de site qui contient
 * TikTok, Instagram ou Facebook, ceux de ByteDance, ceux de Meta qui
 * commencent par « fb », Threads) : jamais appelés par le serveur principal
 * (règle du fondateur du 12 novembre 2026,
 * tests/aucunMediaTiktokInstagram.test.ts). Une proposition gardée n'en
 * vient pas (services/matchFilters.ts) ; ceci en est la seconde barrière. */
const SOCIAL_IMAGE_HOSTS = [
  /(^|\.)[^.]*(tiktok|instagram|facebook)[^.]*\.[a-z.]+$/i,
  /(^|\.)[^.]*byteimg\.com$/i,
  /(^|\.)fb[a-z]*\.(com|net)$/i,
  /(^|\.)threads\.(net|com)$/i,
];

/** Adresse qu'on peut mesurer : forme vérifiée (https, port standard, sans
 * identifiants, jamais localhost : checkImageUrl), pas trop longue, et
 * jamais chez un réseau social. */
export function isMeasurableImageUrl(imageUrl: unknown): imageUrl is string {
  if (typeof imageUrl !== "string" || imageUrl.length > MAX_URL_LENGTH) return false;
  try {
    return notSocialHost(checkImageUrl(imageUrl).hostname);
  } catch {
    return false;
  }
}

/** Hôte permis à chaque étape, redirections comprises : jamais un réseau social. */
function notSocialHost(hostname: string): boolean {
  return !SOCIAL_IMAGE_HOSTS.some((pattern) => pattern.test(hostname));
}

/** Télécharge la vignette (4 s, 1 Mo au plus, garde-fous de publicImage ;
 * une redirection vers un réseau social est refusée avant toute connexion). */
export async function fetchEdgeSample(imageUrl: string, resolver?: Resolver): Promise<Buffer | null> {
  const signal = AbortSignal.timeout(EDGE_COLOR_TIMEOUT_MS);
  const { response } = await openPublicUrl(imageUrl, IMAGE_REQUEST_HEADERS, signal, resolver, notSocialHost);
  try {
    if (!String(response.headers["content-type"] ?? "").toLowerCase().startsWith("image/")) return null;
    const declared = Number(response.headers["content-length"]);
    if (Number.isFinite(declared) && declared > EDGE_COLOR_MAX_BYTES) return null;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response) {
      const buffer = chunk as Buffer;
      size += buffer.length;
      if (size > EDGE_COLOR_MAX_BYTES) return null;
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  } finally {
    response.destroy();
  }
}

async function measureOne(imageUrl: string, log: FastifyBaseLogger, resolver?: Resolver): Promise<void> {
  let color: string | null = null;
  let failed = false;
  try {
    const data = await fetchEdgeSample(imageUrl, resolver);
    if (data) color = await measureEdgeColor(data);
    else failed = true;
  } catch {
    failed = true;
  }
  remember(imageUrl, color, Date.now());
  // Compteurs seulement : jamais l'adresse.
  log.info(color ? "Couleur des bords : mesurée" : failed ? "Couleur des bords : échec" : "Couleur des bords : non uniforme");
}

function drain(): void {
  while (active < EDGE_COLOR_CONCURRENCY && waiting.length > 0) {
    const next = waiting.shift()!;
    if (!edgeColorEnabled()) {
      // Coupé entre-temps : la file est vidée sans rien télécharger.
      waiting.length = 0;
      pending.clear();
      return;
    }
    active += 1;
    void measureOne(next.imageUrl, next.log, next.resolver)
      .catch(() => undefined)
      .finally(() => {
        active -= 1;
        pending.delete(keyOf(next.imageUrl));
        drain();
      });
  }
}

/** Met en file les vignettes pas encore mesurées : adresse mesurable
 * (isMeasurableImageUrl), ni déjà en cache, ni déjà en file. Au-delà de
 * EDGE_COLORS_PER_MINUTE pour la minute, le reste est laissé (il reviendra
 * à la prochaine ouverture). Rien si l'interrupteur est éteint. Ne rejette
 * jamais ; ne fait jamais attendre la réponse (téléchargements lancés au
 * tour suivant). Rend true quand au moins une adresse a vraiment été mise
 * en file (la réponse le dit à l'app : edgeColorsPending). */
export function queueEdgeColors(log: FastifyBaseLogger, imageUrls: readonly (string | null | undefined)[], resolver?: Resolver): boolean {
  try {
    if (!edgeColorEnabled()) return false;
    const now = Date.now();
    sweepExpiredEdgeColors(now);
    let added = false;
    for (const imageUrl of imageUrls) {
      if (!isMeasurableImageUrl(imageUrl) || pending.has(keyOf(imageUrl)) || freshEntry(imageUrl, now)) continue;
      if (!takeSlot(now)) break;
      pending.add(keyOf(imageUrl));
      waiting.push({ imageUrl, log, ...(resolver ? { resolver } : {}) });
      added = true;
    }
    if (added) setImmediate(drain);
    return added;
  } catch {
    // Jamais un échec de la réponse.
    return false;
  }
}

/** Réponse d'une recherche : les EDGE_COLORS_PER_SEARCH premières
 * propositions, dans l'ordre de la réponse (aucune boutique favorisée).
 * Rend true quand au moins une vignette a été mise en file. */
export function queueSearchEdgeColors(log: FastifyBaseLogger, search: { matches: readonly { imageUrl: string }[] } | null | undefined, resolver?: Resolver): boolean {
  if (!search || !edgeColorEnabled()) return false;
  return queueEdgeColors(
    log,
    search.matches.slice(0, EDGE_COLORS_PER_SEARCH).map((match) => match.imageUrl),
    resolver
  );
}

/** Envies et Vault (listes et fiches) : seulement les pièces rattachées à un
 * résultat dont l'image est ENCORE celle de ce résultat (jamais une photo
 * personnelle : « Changer la photo », ajout à la main). Une seule lecture de
 * la base pour toute la page, après la réponse ; rien si l'interrupteur est
 * éteint ; ne rejette jamais. */
export function queueKeptEdgeColors(
  fastify: FastifyInstance,
  log: FastifyBaseLogger,
  rows: readonly { product_match_id: string | null; image_url: string }[],
  resolver?: Resolver
): void {
  try {
    if (!edgeColorEnabled()) return;
    const now = Date.now();
    const candidates = new Map<string, string>();
    for (const row of rows) {
      if (!row.product_match_id || typeof row.image_url !== "string" || pending.has(keyOf(row.image_url)) || freshEntry(row.image_url, now)) continue;
      candidates.set(row.product_match_id, row.image_url);
    }
    if (candidates.size === 0) return;
    setImmediate(() => {
      void (async () => {
        const { data, error } = await fastify.supabaseAdmin
          .from("product_matches")
          .select("id, image_url")
          .in("id", [...candidates.keys()]);
        if (error || !Array.isArray(data)) return;
        const sameImage = new Set((data as { id: string; image_url: string }[]).filter((match) => candidates.get(match.id) === match.image_url).map((match) => match.id));
        // Dans l'ordre de la page.
        queueEdgeColors(
          log,
          [...candidates].filter(([id]) => sameImage.has(id)).map(([, imageUrl]) => imageUrl),
          resolver
        );
      })().catch(() => undefined);
    });
  } catch {
    // Jamais un échec de la liste.
  }
}
