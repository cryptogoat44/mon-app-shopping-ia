// Lien d'une vidéo TikTok ou Instagram → lecteur officiel, dans l'app
// (mission « liens vidéo »). Logique pure, testée. Imports relatifs : fichier
// testé par vitest.
//
// RÈGLE ABSOLUE (fondateur, 12 novembre 2026) : l'app ne télécharge jamais
// une vidéo, un fichier, une vignette ni une image d'aperçu de TikTok ou
// d'Instagram, et n'aspire aucune page. Ce fichier ne fait donc AUCUN appel
// réseau :
// - la vidéo est reconnue par le serveur (GET /api/video-links/lookup, qui
//   suit aussi les liens courts TikTok, en-têtes seulement) ;
// - le lecteur TikTok est construit à partir du seul identifiant de la vidéo ;
// - le code d'intégration Instagram vient du serveur
//   (GET /api/video-links/instagram-embed), jamais de l'app.
import { parseVideoLink, type VideoLink, type VideoPlatform } from "@monapp/shared-types";

export type PlayerPlatform = VideoPlatform;
export type PlayerLinkSource = "paste" | "share";

export const PLAYER_PLATFORM_LIST: readonly PlayerPlatform[] = ["tiktok", "instagram"];

export function isPlayerPlatform(value: string): value is PlayerPlatform {
  return (PLAYER_PLATFORM_LIST as readonly string[]).includes(value);
}

/** Origine du lecteur officiel TikTok : seule source admise de ses messages (lib/player-host-page.ts). */
export const TIKTOK_ORIGIN = "https://www.tiktok.com";

/** Identifiant d'une vidéo TikTok : des chiffres seulement (comme normalizeVideoLink). */
const TIKTOK_VIDEO_ID = /^\d{6,25}$/;

/** Lecteur officiel (https://www.tiktok.com/player/v1/{id}), réglages par
 * défaut de TikTok sauf la lecture automatique : sans elle, le lecteur
 * ignore toute commande (pause comprise). null : identifiant refusé. */
export function tiktokPlayerUrl(videoId: string): string | null {
  return TIKTOK_VIDEO_ID.test(videoId) ? `${TIKTOK_ORIGIN}/player/v1/${videoId}?autoplay=1` : null;
}

/** Même site, ou un de ses sous-domaines : comparaison exacte sur le nom d'hôte lu par URL, jamais « contient ». */
const isHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Hôtes des adresses publiques qu'« Ouvrir dans TikTok / Instagram » peut donner à iOS. */
const OPEN_HOSTS: Record<PlayerPlatform, readonly string[]> = {
  tiktok: ["www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
  instagram: ["www.instagram.com"],
};

/** « Ouvrir dans TikTok / Instagram », « Ouvrir la vidéo » : l'adresse
 * canonique rendue par le serveur, ou à défaut l'adresse reconstruite par
 * parseVideoLink (jamais le texte collé tel quel : un « @ » ou une barre
 * oblique inversée peuvent faire lire à iOS un autre site). Revérifiée ici :
 * https, sans identifiant ni port, sur un hôte attendu de la plateforme.
 * null : rien à ouvrir. */
export function videoOpenUrl(rawUrl: string, platform: PlayerPlatform, link: VideoLink | null): string | null {
  let candidate: string | null = link && link.platform === platform ? link.canonicalUrl : null;
  if (!candidate) {
    const parsed = parseVideoLink(rawUrl);
    if (parsed?.kind === "video" && parsed.link.platform === platform) candidate = parsed.link.canonicalUrl;
    else if (parsed?.kind === "tiktok_short" && platform === "tiktok") candidate = parsed.shortUrl;
  }
  if (!candidate) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  const clean = url.protocol === "https:" && !url.username && !url.password && !url.port;
  return clean && OPEN_HOSTS[platform].includes(url.hostname.toLowerCase()) ? url.href : null;
}

/** Origine de la page hôte : le site de l'app (jamais tiktok.com ni instagram.com). */
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

// Sites qu'un cadre intégré peut charger, avec leurs sous-domaines : le
// lecteur TikTok (tiktok.com), le code d'intégration Instagram (instagram.com)
// et Meta (facebook.com), en https. Tout autre site est refusé : un cadre
// piégé ne peut pas afficher une fausse page d'un autre site dans le lecteur.
// Les hébergeurs des fichiers vidéo des plateformes n'y figurent PAS : la
// vidéo est chargée par le lecteur officiel lui-même, dans son propre cadre
// (élément vidéo, pas une navigation), et la vue web ne soumet pas ce
// chargement à cette règle ; l'app, elle, ne les appelle jamais. Si un essai
// sur iPhone montre un cadre refusé (journal « navigation refused » en
// développement), en parler au fondateur avant tout ajout ici.
const FRAME_DOMAINS = ["tiktok.com", "instagram.com", "facebook.com"] as const;

function isEmbedFrameUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return FRAME_DOMAINS.some((domain) => isHost(host, domain));
}

/** Navigation admise dans la vue web du lecteur. Le document principal ne
 * quitte jamais la page hôte ; un cadre intégré (le lecteur, ses sous-cadres)
 * ne charge que les sites ci-dessus, en https. Tout le reste (autre site,
 * schéma d'app comme instagram://, about:srcdoc) est refusé : rien ne s'ouvre
 * hors de l'app sans un geste explicite. about:srcdoc est refusé car un tel
 * cadre prend l'origine de la page qui le crée : dans la page hôte, il aurait
 * accès au pont vers l'app ; aucun code de l'app n'en crée. */
export function isAllowedNavigation(request: { url: string; isTopFrame: boolean }, topUrls: readonly string[]): boolean {
  if (request.url === "about:blank") return true;
  if (request.isTopFrame) return topUrls.some((allowed) => sameDocument(request.url, allowed));
  return isEmbedFrameUrl(request.url);
}
