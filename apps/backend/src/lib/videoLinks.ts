// Liens de vidéos TikTok et Instagram, côté serveur (mission « liens vidéo »).
//
// Reconnaître un lien ne demande aucun appel : tout se lit dans l'adresse
// (parseVideoLink, paquet partagé). Seule exception : un lien court TikTok
// (vm.tiktok.com/…, vt.tiktok.com/…, tiktok.com/t/…) ne contient pas
// l'identifiant de la vidéo. Le serveur suit alors sa redirection, et rien
// d'autre (règle 1a de la mission) :
// - 5 sauts au plus, 5 secondes au plus en tout ;
// - seuls trois hôtes sont interrogés, en https : vm.tiktok.com,
//   vt.tiktok.com, www.tiktok.com (protection SSRF : jamais une adresse
//   choisie par un tiers) ;
// - seule l'adresse de destination (en-tête « Location ») est lue. Le contenu
//   d'une réponse n'est JAMAIS lu, et la page de la vidéo elle-même n'est
//   jamais demandée : dès que la destination est l'adresse d'une vidéo, on
//   s'arrête ;
// - le résultat est gardé en mémoire (24 h pour une vidéo trouvée, 1 h pour
//   un lien qui ne mène à aucune vidéo), pour ne pas redemander le même lien.
// Aucune vidéo, aucune image, aucune miniature n'est jamais téléchargée.
import { TIKTOK_SHORT_HOSTS, parseVideoLink, type VideoLink } from "@monapp/shared-types";

/** Les seuls hôtes que le serveur interroge pour résoudre un lien court. */
export const SHORT_LINK_HOSTS: readonly string[] = [...TIKTOK_SHORT_HOSTS, "www.tiktok.com"];
export const SHORT_LINK_MAX_HOPS = 5;
export const SHORT_LINK_TIMEOUT_MS = 5_000;
const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const NOT_FOUND_TTL_MS = 60 * 60 * 1000;
/** Liens gardés en mémoire au plus (les plus anciens partent d'abord). */
export const SHORT_LINK_CACHE_SIZE = 5_000;

/** Pourquoi un lien court n'a pas donné de vidéo. `unreachable` : TikTok n'a
 * pas répondu à temps (à réessayer) ; les autres raisons sont définitives. */
export type ShortLinkIssue = "not_a_video" | "host_not_allowed" | "too_many_hops" | "unreachable";
export type ShortLinkOutcome = { ok: true; link: VideoLink } | { ok: false; issue: ShortLinkIssue };

type Fetcher = (url: string, init: { method: "GET"; redirect: "manual"; signal: AbortSignal }) => Promise<Pick<Response, "status" | "headers" | "body">>;

function allowedHop(url: URL): boolean {
  return url.protocol === "https:" && url.port === "" && url.username === "" && url.password === "" && SHORT_LINK_HOSTS.includes(url.hostname.toLowerCase());
}

/** Suit la redirection d'un lien court TikTok jusqu'à l'adresse d'une vidéo.
 * Ne lit que le code de la réponse et son en-tête « Location ». */
export async function followShortLink(shortUrl: string, fetcher: Fetcher = fetch): Promise<ShortLinkOutcome> {
  let current: URL;
  try {
    current = new URL(shortUrl);
  } catch {
    return { ok: false, issue: "not_a_video" };
  }
  const signal = AbortSignal.timeout(SHORT_LINK_TIMEOUT_MS);
  for (let hop = 0; hop < SHORT_LINK_MAX_HOPS; hop++) {
    if (!allowedHop(current)) return { ok: false, issue: "host_not_allowed" };
    let status: number;
    let location: string | null;
    try {
      const response = await fetcher(current.href, { method: "GET", redirect: "manual", signal });
      status = response.status;
      location = response.headers.get("location");
      // Le contenu n'est jamais lu : la réponse est abandonnée aussitôt.
      await response.body?.cancel().catch(() => undefined);
    } catch {
      return { ok: false, issue: "unreachable" };
    }
    if (status >= 500 || status === 429) return { ok: false, issue: "unreachable" };
    if (status < 300 || status >= 400 || !location) return { ok: false, issue: "not_a_video" };
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return { ok: false, issue: "not_a_video" };
    }
    const parsed = parseVideoLink(next.href);
    if (parsed?.kind === "video") return { ok: true, link: parsed.link };
    current = next;
  }
  return { ok: false, issue: "too_many_hops" };
}

interface Cached {
  outcome: ShortLinkOutcome;
  expiresAt: number;
}
const cache = new Map<string, Cached>();
const pending = new Map<string, Promise<ShortLinkOutcome>>();

function remember(shortUrl: string, outcome: ShortLinkOutcome, now: number): void {
  // Sans réponse de TikTok : rien n'est retenu, le prochain essai redemande.
  if (!outcome.ok && outcome.issue === "unreachable") return;
  cache.delete(shortUrl);
  cache.set(shortUrl, { outcome, expiresAt: now + (outcome.ok ? FOUND_TTL_MS : NOT_FOUND_TTL_MS) });
  while (cache.size > SHORT_LINK_CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

/** Tests seulement : oublie les liens courts gardés en mémoire. */
export function resetShortLinkCache(): void {
  cache.clear();
  pending.clear();
}

/** Ce qu'un texte reçu désigne. `link` : la vidéo reconnue (directement, ou
 * après résolution d'un lien court) ; `issue` : pourquoi un lien court n'a
 * rien donné ; les deux absents : aucun lien TikTok ou Instagram reconnu.
 * `beforeFetch` est appelée juste avant un appel sortant (jamais pour une
 * réponse gardée en mémoire) : elle peut le refuser (limite de débit). */
export interface ResolvedVideoLink {
  link: VideoLink | null;
  issue: ShortLinkIssue | "rate_limited" | null;
}

export async function resolveVideoLink(
  input: string,
  options: { fetcher?: Fetcher; now?: () => number; beforeFetch?: () => boolean } = {}
): Promise<ResolvedVideoLink> {
  const parsed = parseVideoLink(input);
  if (!parsed) return { link: null, issue: null };
  if (parsed.kind === "video") return { link: parsed.link, issue: null };

  const now = (options.now ?? Date.now)();
  const known = cache.get(parsed.shortUrl);
  if (known && known.expiresAt > now) return known.outcome.ok ? { link: known.outcome.link, issue: null } : { link: null, issue: known.outcome.issue };

  // Deux demandes du même lien en même temps : un seul appel sortant.
  let running = pending.get(parsed.shortUrl);
  if (!running) {
    if (options.beforeFetch && !options.beforeFetch()) return { link: null, issue: "rate_limited" };
    running = followShortLink(parsed.shortUrl, options.fetcher)
      .then((outcome) => {
        remember(parsed.shortUrl, outcome, (options.now ?? Date.now)());
        return outcome;
      })
      .finally(() => pending.delete(parsed.shortUrl));
    pending.set(parsed.shortUrl, running);
  }
  const outcome = await running;
  return outcome.ok ? { link: outcome.link, issue: null } : { link: null, issue: outcome.issue };
}
