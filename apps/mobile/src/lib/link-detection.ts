// Reconnaissance du lien collé ou tapé dans Spotter. Logique pure (aucune
// dépendance à React Native) pour être testée directement.

export type LinkPlatform = "tiktok" | "instagram" | "pinterest";

export type LinkDetection =
  | { kind: "empty" }
  | { kind: "not_a_link" }
  | { kind: "unsupported"; url: string }
  /** Bon site, mais le lien mène à un profil ou une page, pas à une vidéo /
   * une publication / une épingle. */
  | { kind: "not_a_video"; url: string; platform: LinkPlatform }
  | { kind: "supported"; url: string; platform: LinkPlatform };

const PLATFORM_DOMAINS: { platform: LinkPlatform; domains: string[] }[] = [
  { platform: "tiktok", domains: ["tiktok.com"] },
  { platform: "instagram", domains: ["instagram.com", "instagr.am"] },
  // Liens courts pin.it et variantes régionales (pinterest.fr, .co.uk...).
  { platform: "pinterest", domains: ["pin.it", "pinterest.com", "pinterest.fr", "pinterest.co.uk", "pinterest.de", "pinterest.es", "pinterest.it", "pinterest.ca"] },
];

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Extrait le premier lien http(s) d'un texte : TikTok et Instagram
 * partagent souvent un texte (« Regarde cette vidéo… https://vm.tiktok.com/… »)
 * plutôt qu'un lien seul. Ajoute https:// à un lien tapé sans. */
export function extractUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const withScheme = trimmed.match(/https?:\/\/[^\s<>"']+/i);
  if (withScheme) return withScheme[0].replace(/[),.;!?]+$/, "");
  const bare = trimmed.match(/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?$/i);
  return bare ? `https://${bare[0]}` : null;
}

// Volontairement tolérant : on ne refuse que les liens qui ne peuvent
// clairement PAS désigner un contenu (accueil, profil, recherche…). Les
// formats courts (vm.tiktok.com, pin.it…) passent toujours.
function pointsToContent(platform: LinkPlatform, host: string, path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  if (platform === "tiktok") {
    if (host.startsWith("vm.") || host.startsWith("vt.")) return segments.length > 0;
    if (segments.length === 0) return false;
    if (segments.length === 1 && segments[0]!.startsWith("@")) return false; // profil
    return !["discover", "tag", "music", "search", "explore", "following", "foryou", "live"].includes(segments[0]!);
  }
  if (platform === "instagram") {
    if (host === "instagr.am") return segments.length > 0;
    return ["p", "reel", "reels", "tv"].includes(segments[0] ?? "") && segments.length >= 2;
  }
  if (host === "pin.it") return segments.length > 0;
  return segments[0] === "pin" && segments.length >= 2;
}

export function detectLink(text: string): LinkDetection {
  if (!text.trim()) return { kind: "empty" };
  const url = extractUrl(text);
  if (!url) return { kind: "not_a_link" };

  let host: string;
  let path: string;
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname;
  } catch {
    return { kind: "not_a_link" };
  }

  for (const { platform, domains } of PLATFORM_DOMAINS) {
    if (domains.some((domain) => hostMatches(host, domain))) {
      return pointsToContent(platform, host, path) ? { kind: "supported", url, platform } : { kind: "not_a_video", url, platform };
    }
  }
  return { kind: "unsupported", url };
}
