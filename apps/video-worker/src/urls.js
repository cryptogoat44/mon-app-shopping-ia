// Adresses acceptées (protection SSRF). Le service n'ouvre jamais une adresse
// choisie par un tiers :
// - l'adresse reçue doit être une page https de TikTok ou d'Instagram (liste
//   fermée d'hôtes, forme de chemin d'une vidéo), sans identifiants, port,
//   paramètres ni fragment ;
// - l'adresse du fichier vidéo, trouvée par yt-dlp, doit être en https, sur un
//   nom de domaine public (jamais une adresse IP, ni un nom interne comme
//   ceux du réseau privé de Render). Seule cette PREMIÈRE adresse est
//   vérifiée : ffmpeg suit les redirections HTTP sans les contrôler, y
//   compris vers http ou vers un autre hôte (sa liste -protocol_whitelist
//   bloque les fichiers locaux et les listes de lecture, pas une
//   redirection). Aucun tiers ne choisit cette adresse aujourd'hui : elle
//   vient de l'extraction de TikTok ou de Meta, à partir d'une page de la
//   liste fermée ci-dessous.

/** Hôtes autorisés, par plateforme (demande du serveur principal). */
export const VIDEO_HOSTS = Object.freeze({
  tiktok: Object.freeze(["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"]),
  instagram: Object.freeze(["instagram.com", "www.instagram.com"]),
});

export const PLATFORMS = Object.freeze(Object.keys(VIDEO_HOSTS));

/** Formes de chemin acceptées : une vidéo (ou un diaporama) TikTok, un lien
 * court TikTok, une publication Instagram. Rien d'autre (ni profil, ni page
 * de recherche). Ce sont les formes que le serveur principal reconstruit. */
const VIDEO_PATHS = Object.freeze({
  tiktok: /^\/@[A-Za-z0-9._]{0,30}\/(?:video|photo)\/\d{6,25}\/?$/,
  tiktokShort: /^\/[A-Za-z0-9]{5,20}\/?$/,
  instagram: /^\/(?:reels?|p|tv)\/[A-Za-z0-9_-]{5,64}\/?$/,
});
const SHORT_LINK_HOSTS = ["vm.tiktok.com", "vt.tiktok.com"];
const CONTROL_OR_SPACE = /[\s\u0000-\u001f\u007f-\u009f]/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** Suffixes de noms réservés aux réseaux privés. */
const PRIVATE_SUFFIXES = ["localhost", "local", "internal", "intranet", "lan", "home", "corp", "localdomain", "home.arpa"];

/**
 * L'adresse de la vidéo, normalisée, si elle est acceptable ; sinon null.
 * @param {unknown} raw
 * @param {unknown} platform
 * @param {number} maxLength
 * @returns {string | null}
 */
export function acceptedVideoUrl(raw, platform, maxLength = 2048) {
  if (typeof raw !== "string" || typeof platform !== "string") return null;
  if (!Object.hasOwn(VIDEO_HOSTS, platform)) return null;
  if (raw.length === 0 || raw.length > maxLength || CONTROL_OR_SPACE.test(raw)) return null;
  if (raw.includes("?") || raw.includes("#") || raw.includes("\\") || raw.includes("%") || /\/\.{1,2}(?:\/|$)/.test(raw)) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
  if (!VIDEO_HOSTS[/** @type {keyof typeof VIDEO_HOSTS} */ (platform)].includes(url.hostname)) return null;
  const shape = platform === "instagram" ? VIDEO_PATHS.instagram : SHORT_LINK_HOSTS.includes(url.hostname) ? VIDEO_PATHS.tiktokShort : VIDEO_PATHS.tiktok;
  if (!shape.test(url.pathname)) return null;
  return url.href;
}

/**
 * Nom de domaine public : au moins deux étiquettes, la dernière alphabétique,
 * jamais une adresse IP ni un suffixe de réseau privé.
 * @param {string} hostname
 */
export function isPublicDomainName(hostname) {
  const host = hostname.toLowerCase();
  if (host.length === 0 || host.length > 253 || host.startsWith("[") || IPV4.test(host)) return false;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return false;
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1])) return false;
  return !PRIVATE_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * L'adresse du fichier vidéo (donnée par yt-dlp) peut-elle être lue par ffmpeg ?
 * @param {unknown} raw
 */
export function isAcceptableMediaUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 8192 || CONTROL_OR_SPACE.test(raw)) return false;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  return isPublicDomainName(url.hostname);
}
