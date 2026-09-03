import type { PlatformSource } from "@monapp/shared-types";
import { env } from "../env.js";

export function detectPlatform(sourceUrl: string): PlatformSource {
  let host: string;
  try {
    host = new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    return "other";
  }

  if (host.includes("tiktok.com")) return "tiktok";
  if (host.includes("instagram.com")) return "instagram";
  return "other";
}

interface OEmbedResult {
  thumbnailUrl: string;
}

// Un service oEmbed externe lent ou muet ne doit jamais bloquer une
// recherche indéfiniment — au-delà de ce délai on abandonne et on retombe
// sur le repli "capture manuelle" comme pour toute autre erreur.
const OEMBED_TIMEOUT_MS = 8_000;

async function fetchTikTokOEmbed(sourceUrl: string): Promise<OEmbedResult | null> {
  const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`;
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS) });
  if (!response.ok) return null;

  const data = (await response.json()) as { thumbnail_url?: string };
  return data.thumbnail_url ? { thumbnailUrl: data.thumbnail_url } : null;
}

async function fetchInstagramOEmbed(sourceUrl: string): Promise<OEmbedResult | null> {
  // Nécessite un jeton d'app Meta enregistrée — non configuré par défaut.
  // Sans lui, on saute directement au repli "capture manuelle".
  if (!env.META_OEMBED_ACCESS_TOKEN) return null;

  const endpoint = `https://graph.facebook.com/v21.0/instagram_oembed?url=${encodeURIComponent(sourceUrl)}&access_token=${env.META_OEMBED_ACCESS_TOKEN}`;
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS) });
  if (!response.ok) return null;

  const data = (await response.json()) as { thumbnail_url?: string };
  return data.thumbnail_url ? { thumbnailUrl: data.thumbnail_url } : null;
}

/** Voie officielle uniquement — renvoie null si indisponible ou si la
 * plateforme n'a pas d'oEmbed exploitable (l'appelant proposera alors
 * l'import manuel d'une capture d'écran). */
export async function fetchOfficialThumbnail(
  sourceUrl: string,
  platform: PlatformSource
): Promise<OEmbedResult | null> {
  try {
    if (platform === "tiktok") return await fetchTikTokOEmbed(sourceUrl);
    if (platform === "instagram") return await fetchInstagramOEmbed(sourceUrl);
    return null;
  } catch {
    return null;
  }
}
