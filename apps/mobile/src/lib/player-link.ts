// Lien d'une vidéo TikTok ou Instagram → lecteur officiel, dans Spotto (lot
// « lecteur intégré », app iPhone seulement). Logique pure, testée ; le réseau
// passe par une fonction fournie (fetch par défaut) pour les tests. Imports
// relatifs : fichier testé par vitest.
// Formes de liens : TikTok, note R1 §3 (Video.js @videojs/media 10.2.0,
// iframely 2.6.0) ; Instagram, note R2 §2 (yt-dlp 2026.10.26, extension
// WordPress de Meta). Adresses du lecteur et d'oEmbed : notes R1 §1, R2 §1.
// Instagram : seul le code d'intégration officiel (oEmbed) est utilisé ;
// l'adresse /embed/ non documentée a été retirée (contre-expertise n° 6).

export type PlayerPlatform = "tiktok" | "instagram";
export type PlayerLinkSource = "paste" | "share";

export const PLAYER_PLATFORM_LIST: readonly PlayerPlatform[] = ["tiktok", "instagram"];

export function isPlayerPlatform(value: string): value is PlayerPlatform {
  return (PLAYER_PLATFORM_LIST as readonly string[]).includes(value);
}

/** Délais réseau, à calibrer : suivre un lien court (fetch, puis vue web), vérifier par oEmbed. */
export const PLAYER_NETWORK = { resolveTimeoutMs: 6_000, oembedTimeoutMs: 6_000 } as const;

export type PlayerLink =
  | { kind: "tiktok"; id: string; media: "video" | "photo"; oembedUrl: string | null }
  | { kind: "instagram"; code: string; media: "p" | "reel"; canonical: string }
  /** Lien court ou de partage, sans identifiant : à suivre jusqu'à l'adresse finale. */
  | { kind: "short"; platform: PlayerPlatform; url: string }
  | { kind: "none" };

export type UnavailableReason = "not_public" | "not_a_video" | "no_answer" | "short_link" | "network" | "player_error" | "crashed";
export type TikTokCheckStatus = "ok" | "not_public" | "not_a_video" | "no_answer" | "network" | "skipped";
/** Vérification TikTok (oEmbed) : verdict, et code d'intégration officiel (repli, contre-expertise n° 9). */
export interface TikTokCheck {
  status: TikTokCheckStatus;
  html: string | null;
}

export type PlayerEmbed =
  /** Lecteur officiel piloté (https://www.tiktok.com/player/v1/{id}). */
  | { platform: "tiktok"; variant: "player"; id: string; media: "video" | "photo"; playerUrl: string; oembedUrl: string | null }
  /** Repli documenté : code d'intégration renvoyé par l'oEmbed TikTok (blockquote + embed.js), sans commande. */
  | { platform: "tiktok"; variant: "oembed"; id: string; html: string }
  /** Code d'intégration officiel d'Instagram (blockquote + embed.js), sans commande. */
  | { platform: "instagram"; variant: "oembed"; code: string; media: "p" | "reel"; canonical: string; html: string };

export type EmbedOpening = { kind: "embed"; embed: PlayerEmbed } | { kind: "unavailable"; reason: UnavailableReason };

const TIKTOK_ID = "(\\d{8,25})";
const TIKTOK_ACCOUNT_PATH = new RegExp(`^/@([^/]+)/(video|photo)/${TIKTOK_ID}(?:/|$)`);
const TIKTOK_OTHER_PATHS = [
  new RegExp(`^/player/v1/${TIKTOK_ID}(?:/|$)`),
  new RegExp(`^/(?:i18n/)?share/video/${TIKTOK_ID}(?:/|$)`),
  new RegExp(`^/v/${TIKTOK_ID}(?:\\.html)?(?:/|$)`),
  new RegExp(`^/embed/(?:v2/)?${TIKTOK_ID}(?:/|$)`),
];
const INSTAGRAM_MEDIA = /^\/(?:(?!share\/|stories\/|explore\/|accounts\/)[A-Za-z0-9._]{1,30}\/)?(p|tv|reels?)(?!\/audio\/)\/([A-Za-z0-9_-]+)(?:\/|$)/;

const isHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

function readTikTok(host: string, path: string): PlayerLink {
  const account = path.match(TIKTOK_ACCOUNT_PATH);
  if (account) {
    const id = account[3]!;
    // L'oEmbed attend la forme « vidéo » ; une publication photo y est réécrite (iframely, « TikTok photomode »).
    const page = `https://www.tiktok.com/@${account[1]!}/video/${id}`;
    return { kind: "tiktok", id, media: account[2] === "photo" ? "photo" : "video", oembedUrl: `https://www.tiktok.com/oembed?url=${encodeURIComponent(page)}` };
  }
  for (const pattern of TIKTOK_OTHER_PATHS) {
    const match = path.match(pattern);
    if (match) return { kind: "tiktok", id: match[1]!, media: "video", oembedUrl: null };
  }
  const segments = path.split("/").filter(Boolean);
  const shortHost = host === "vm.tiktok.com" || host === "vt.tiktok.com";
  if ((shortHost && segments.length >= 1) || (segments[0] === "t" && segments.length >= 2)) {
    return { kind: "short", platform: "tiktok", url: `https://${host}${path}` };
  }
  return { kind: "none" };
}

function readInstagram(host: string, path: string): PlayerLink {
  if (/^\/share\/[^/]/.test(path)) return { kind: "short", platform: "instagram", url: `https://${host}${path}` };
  const match = path.match(INSTAGRAM_MEDIA);
  if (!match) return { kind: "none" };
  const code = match[2]!;
  const media = match[1] === "p" || match[1] === "tv" ? "p" : "reel";
  return { kind: "instagram", code, media, canonical: `https://www.instagram.com/${media}/${code}/` };
}

/** Plateforme, identifiant et forme du lien ; paramètres de partage ignorés (?igsh=, ?_t=, utm…). */
export function readPlayerLink(raw: string): PlayerLink {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "none" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { kind: "none" };
  const host = url.hostname.toLowerCase();
  if (isHost(host, "tiktok.com")) return readTikTok(host, url.pathname);
  if (isHost(host, "instagram.com") || isHost(host, "instagr.am")) return readInstagram(host, url.pathname);
  return { kind: "none" };
}

/** Paramètres du lecteur officiel (note R1 §1, valeurs 0 ou 1) : lecture
 * automatique (sans elle, le lecteur ignore toute commande : Video.js,
 * tiktok-video.md « Deferred startup ») ; en boucle (pas d'écran de fin) ;
 * vidéos du même auteur (rel=0) ; ni bouton plein écran, ni menu contextuel,
 * ni légende, ni nom du son. */
const TIKTOK_PLAYER_PARAMS = "autoplay=1&loop=1&rel=0&fullscreen_button=0&native_context_menu=0&description=0&music_info=0";

export function tiktokPlayerUrl(id: string): string {
  return `https://www.tiktok.com/player/v1/${id}?${TIKTOK_PLAYER_PARAMS}`;
}

/** oEmbed Instagram, sans jeton depuis le 15/06/2026 (note R2 §1) : légende masquée, script chargé par la page hôte. */
export function instagramOEmbedUrl(canonical: string, maxWidth: number): string {
  return `https://graph.facebook.com/v26.0/instagram_oembed?url=${encodeURIComponent(canonical)}&maxwidth=${Math.round(maxWidth)}&hidecaption=true&omitscript=true`;
}

// Lien en attente pour l'écran Lecteur : gardé en mémoire le temps du
// parcours, comme spot-draft.ts ; jamais dans l'adresse de l'écran (traces
// Sentry), jamais enregistré.
export interface HeldPlayerLink {
  url: string;
  platform: PlayerPlatform;
  source: PlayerLinkSource;
}

let held: HeldPlayerLink | null = null;

export function holdPlayerLink(link: HeldPlayerLink): void {
  held = link;
}

export function getHeldPlayerLink(): HeldPlayerLink | null {
  return held;
}

/** Sans argument (« Fermer ») : oublie le lien. Avec `expected` (départ d'un
 * écran Lecteur) : ne l'oublie que s'il s'agit toujours du sien — un nouveau
 * partage a pu en déposer un autre entre-temps (contre-expertise n° 2c). */
export function clearPlayerLink(expected?: HeldPlayerLink): void {
  if (expected === undefined || held === expected) held = null;
}

/** Le lecteur n'est proposé que sur l'app iPhone, interrupteur allumé, module de capture présent dans l'app installée. */
export function playerAllowed(os: string, enabled: boolean, captureReady: boolean): boolean {
  return enabled && os === "ios" && captureReady;
}

/** Plateformes du lecteur, d'après l'interrupteur général et la constante de chaque plateforme (lib/spot-flags.ts). */
export function enabledPlayerPlatforms(allowed: boolean, perPlatform: Record<PlayerPlatform, boolean>): PlayerPlatform[] {
  return allowed ? PLAYER_PLATFORM_LIST.filter((platform) => perPlatform[platform]) : [];
}

/** Origine de la page hôte : le site de Spotto (jamais tiktok.com ni instagram.com, note R2 §3.2). */
export function playerBaseUrl(webUrl: string): string {
  try {
    return `${new URL(webUrl).origin}/`;
  } catch {
    return webUrl;
  }
}

/** Même document : adresses comparées sans le fragment (#…), sous leur forme normalisée. */
export function sameDocument(a: string, b: string): boolean {
  const normalize = (url: string) => {
    const base = url.split("#")[0] ?? url;
    try {
      return new URL(base).href;
    } catch {
      return base;
    }
  };
  return normalize(a) === normalize(b);
}

/** Navigation admise dans la vue web du lecteur. Le document principal ne
 * quitte jamais la page hôte ; un cadre intégré (le lecteur, ses sous-cadres)
 * peut charger toute adresse https. Tout le reste (autre page, schéma d'app
 * comme instagram://) est refusé : rien ne s'ouvre hors de Spotto sans un
 * geste explicite (note R1 §5, note R4 §1.2). */
export function isAllowedNavigation(request: { url: string; isTopFrame: boolean }, topUrls: readonly string[]): boolean {
  if (request.url === "about:blank" || request.url === "about:srcdoc") return true;
  if (request.isTopFrame) return topUrls.some((allowed) => sameDocument(request.url, allowed));
  return request.url.startsWith("https://");
}

/** Second suivi d'un lien court, dans une vue web cachée (contre-expertise
 * n° 4b) : chaque navigation principale est lue ici. « resolved » : adresse
 * d'une vidéo, la navigation est arrêtée et l'adresse gardée ; « follow » :
 * redirection https chez TikTok ou Instagram, on la laisse faire ; « stop » :
 * tout le reste (schéma d'app, autre site), refusé. */
export function shortLinkHop(url: string): "resolved" | "follow" | "stop" {
  const link = readPlayerLink(url);
  if (link.kind === "tiktok" || link.kind === "instagram") return "resolved";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "stop";
  }
  const host = parsed.hostname.toLowerCase();
  const known = isHost(host, "tiktok.com") || isHost(host, "instagram.com") || isHost(host, "instagr.am");
  return parsed.protocol === "https:" && known ? "follow" : "stop";
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  url: string;
  json(): Promise<unknown>;
}
export type FetchLike = (url: string, init: { method: "GET"; credentials: "omit"; signal: AbortSignal }) => Promise<FetchResponseLike>;

async function get(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<FetchResponseLike> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // credentials « omit » : ni cookie envoyé, ni cookie gardé (RCTNetworking.mm l.319).
    return await fetchImpl(url, { method: "GET", credentials: "omit", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** fetch échoue sans réponse (hors ligne) : TypeError, comme spot-flow.ts (prepareFailureKind). */
const isOffline = (error: unknown) => error instanceof TypeError;

/** Réponse oEmbed lue comme le serveur (apps/backend/src/services/oembed.ts l.37-38). */
export function oembedVerdict(status: number): "ok" | "not_public" | "no_answer" {
  if (status === 429 || status >= 500) return "no_answer";
  return status >= 200 && status < 300 ? "ok" : "not_public";
}

const htmlField = (body: unknown): string | null => {
  const html = typeof body === "object" && body !== null && "html" in body ? (body as { html: unknown }).html : null;
  return typeof html === "string" ? html : null;
};

/** html d'oEmbed Instagram : seulement le code officiel attendu (blockquote « instagram-media », sans script). */
export function embedHtmlOf(body: unknown): string | null {
  const html = htmlField(body);
  if (html === null) return null;
  return html.trimStart().startsWith("<blockquote") && html.includes("instagram-media") && !/<script/i.test(html) ? html : null;
}

const TIKTOK_EMBED_SCRIPT = /<script\b[^>]*\bsrc="https:\/\/www\.tiktok\.com\/embed\.js"[^>]*>\s*<\/script>/gi;

/** html d'oEmbed TikTok : le blockquote « tiktok-embed » ; le script embed.js
 * officiel est retiré (la page hôte le charge elle-même), tout autre script
 * fait refuser le code. Forme exacte À VÉRIFIER (essai T4). */
export function tiktokEmbedHtmlOf(body: unknown): string | null {
  const html = htmlField(body);
  if (html === null) return null;
  const blockquote = html.replace(TIKTOK_EMBED_SCRIPT, "").trim();
  return blockquote.startsWith("<blockquote") && blockquote.includes("tiktok-embed") && !/<script/i.test(blockquote) ? blockquote : null;
}

/** Ouvre le lien tenu : lien court suivi (depuis le téléphone : adresse IP de
 * la personne, aucune charge serveur, note R1 §3), puis, pour Instagram,
 * vérification et code officiel. */
export async function openPlayerLink(rawUrl: string, options: { width: number; fetchImpl?: FetchLike }): Promise<EmbedOpening> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let link = readPlayerLink(rawUrl);
  if (link.kind === "short") {
    try {
      const response = await get(fetchImpl, link.url, PLAYER_NETWORK.resolveTimeoutMs);
      link = readPlayerLink(response.url);
    } catch (error) {
      return { kind: "unavailable", reason: isOffline(error) ? "network" : "short_link" };
    }
    if (link.kind === "short" || link.kind === "none") return { kind: "unavailable", reason: "short_link" };
  }
  if (link.kind === "none") return { kind: "unavailable", reason: "not_a_video" };
  if (link.kind === "tiktok") {
    return { kind: "embed", embed: { platform: "tiktok", variant: "player", id: link.id, media: link.media, playerUrl: tiktokPlayerUrl(link.id), oembedUrl: link.oembedUrl } };
  }
  try {
    const response = await get(fetchImpl, instagramOEmbedUrl(link.canonical, options.width), PLAYER_NETWORK.oembedTimeoutMs);
    const verdict = oembedVerdict(response.status);
    if (verdict !== "ok") return { kind: "unavailable", reason: verdict };
    const html = embedHtmlOf(await response.json());
    return html
      ? { kind: "embed", embed: { platform: "instagram", variant: "oembed", code: link.code, media: link.media, canonical: link.canonical, html } }
      : { kind: "unavailable", reason: "not_public" };
  } catch (error) {
    return { kind: "unavailable", reason: isOffline(error) ? "network" : "no_answer" };
  }
}

/** Vérification TikTok (oEmbed), faite pendant que le lecteur charge : elle
 * explique un lecteur muet (vidéo privée, supprimée…), fait passer en
 * « indisponible » une vidéo qu'elle refuse (contre-expertise n° 14) et
 * fournit le code d'intégration du repli (n° 9). */
export async function checkTikTok(oembedUrl: string | null, fetchImpl: FetchLike = fetch): Promise<TikTokCheck> {
  if (!oembedUrl) return { status: "skipped", html: null };
  try {
    const response = await get(fetchImpl, oembedUrl, PLAYER_NETWORK.oembedTimeoutMs);
    const verdict = oembedVerdict(response.status);
    if (verdict !== "ok") return { status: verdict, html: null };
    const body = await response.json();
    const type = typeof body === "object" && body !== null && "type" in body ? (body as { type: unknown }).type : undefined;
    // Comme le serveur (oembed.ts l.40) : un profil répond « rich ».
    if (typeof type === "string" && type !== "video" && type !== "photo") return { status: "not_a_video", html: null };
    return { status: "ok", html: tiktokEmbedHtmlOf(body) };
  } catch (error) {
    return { status: isOffline(error) ? "network" : "no_answer", html: null };
  }
}
