import type { PlatformSource, PreviewIssue } from "@monapp/shared-types";
import { env } from "../env.js";
import { safeFetch } from "../lib/safeFetch.js";

// Vraie correspondance de domaine (exact ou sous-domaine), pas une simple
// recherche de texte — "notre-tiktok.com.exemple.com" contient "tiktok.com"
// mais n'est pas TikTok.
function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function detectPlatform(sourceUrl: string): PlatformSource {
  let host: string;
  try {
    host = new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    return "other";
  }

  if (hostMatches(host, "tiktok.com")) return "tiktok";
  if (hostMatches(host, "instagram.com")) return "instagram";
  return "other";
}

interface OEmbedResult {
  thumbnailUrl: string;
}

export type OfficialPreview = { ok: true; thumbnailUrl: string } | { ok: false; issue: PreviewIssue };

// Un service oEmbed externe lent ou muet ne doit jamais bloquer une
// recherche indéfiniment — au-delà de ce délai on abandonne, et l'app
// explique que le service ne répond pas.
const OEMBED_TIMEOUT_MS = 8_000;

// Réponse d'un service oEmbed → image, ou raison précise de l'échec.
// Constaté le 2026-09-24 sur TikTok : vidéo valide → 200 "type":"video" ;
// vidéo privée, supprimée ou identifiant faux → 400 (indistinguables) ;
// lien de profil → 200 "type":"rich", sans image de vidéo.
async function readOEmbed(response: Response): Promise<OfficialPreview> {
  if (response.status >= 500 || response.status === 429) return { ok: false, issue: "service_down" };
  if (!response.ok) return { ok: false, issue: "unavailable" };
  const data = (await response.json()) as { type?: string; thumbnail_url?: string };
  if (data.type && data.type !== "video" && data.type !== "photo") return { ok: false, issue: "not_a_video" };
  return data.thumbnail_url ? { ok: true, thumbnailUrl: data.thumbnail_url } : { ok: false, issue: "not_a_video" };
}

async function fetchTikTokOEmbed(sourceUrl: string): Promise<OfficialPreview> {
  const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`;
  const response = await safeFetch(endpoint, {
    allowedHosts: ["tiktok.com"],
    signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
  });
  return readOEmbed(response);
}

async function fetchInstagramOEmbed(sourceUrl: string): Promise<OfficialPreview> {
  // Nécessite un jeton d'app Meta enregistrée — non configuré par défaut.
  // Sans lui, seule la capture d'écran est possible.
  if (!env.META_OEMBED_ACCESS_TOKEN) return { ok: false, issue: "no_official_access" };

  const endpoint = `https://graph.facebook.com/v21.0/instagram_oembed?url=${encodeURIComponent(sourceUrl)}&access_token=${env.META_OEMBED_ACCESS_TOKEN}`;
  const response = await safeFetch(endpoint, {
    allowedHosts: ["facebook.com"],
    signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
  });
  return readOEmbed(response);
}

const PINTEREST_DOMAINS = ["pin.it", "pinterest.com", "pinterest.fr", "pinterest.co.uk", "pinterest.de", "pinterest.es", "pinterest.it", "pinterest.ca"];

function isPinterest(sourceUrl: string): boolean {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return PINTEREST_DOMAINS.some((domain) => hostMatches(host, domain));
  } catch {
    return false;
  }
}

/** Voie officielle uniquement : l'image du lien, ou la raison précise pour
 * laquelle elle est indisponible (voir PreviewIssue). */
export async function fetchOfficialPreview(sourceUrl: string, platform: PlatformSource): Promise<OfficialPreview> {
  try {
    if (platform === "tiktok") return await fetchTikTokOEmbed(sourceUrl);
    if (platform === "instagram") return await fetchInstagramOEmbed(sourceUrl);
    // Pinterest : aucune méthode officielle pour lire une épingle quelconque
    // (vérifié le 2026-09-24, voir docs/points-de-vigilance.md).
    return { ok: false, issue: isPinterest(sourceUrl) ? "no_official_access" : "unsupported_site" };
  } catch {
    // Délai dépassé, réseau coupé, réponse illisible.
    return { ok: false, issue: "service_down" };
  }
}

/** Ancienne forme (routes historiques) : l'image, ou null. */
export async function fetchOfficialThumbnail(sourceUrl: string, platform: PlatformSource): Promise<OEmbedResult | null> {
  const preview = await fetchOfficialPreview(sourceUrl, platform);
  return preview.ok ? { thumbnailUrl: preview.thumbnailUrl } : null;
}
