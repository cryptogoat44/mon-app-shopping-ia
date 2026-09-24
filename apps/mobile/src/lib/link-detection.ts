// Reconnaissance du lien collé ou tapé dans Spotter. Logique pure (aucune
// dépendance à React Native) pour être testée directement.

export type LinkPlatform = "tiktok" | "instagram" | "pinterest";

export type LinkDetection =
  | { kind: "empty" }
  | { kind: "not_a_link" }
  | { kind: "unsupported"; url: string }
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

export function detectLink(text: string): LinkDetection {
  if (!text.trim()) return { kind: "empty" };
  const url = extractUrl(text);
  if (!url) return { kind: "not_a_link" };

  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { kind: "not_a_link" };
  }

  for (const { platform, domains } of PLATFORM_DOMAINS) {
    if (domains.some((domain) => hostMatches(host, domain))) return { kind: "supported", url, platform };
  }
  return { kind: "unsupported", url };
}
