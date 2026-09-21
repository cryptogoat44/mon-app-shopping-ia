// Protection SSRF (règle 9 de docs/spotto-ameliorations-v1.md) : toute URL
// récupérée par le backend — même une URL de départ fixe et fiable — passe
// par une liste blanche d'hôtes, ET chaque redirection éventuelle est
// revérifiée contre cette même liste avant d'être suivie. `fetch()` normal
// suit les redirections en aveugle (`redirect: "follow"` par défaut) : si un
// hôte de confiance était un jour compromis ou mal configuré, il pourrait
// rediriger notre serveur vers une adresse interne ou arbitraire sans qu'on
// ne le remarque.
const MAX_REDIRECTS = 5;

export interface SafeFetchOptions extends Omit<RequestInit, "redirect"> {
  /** Hôtes autorisés — nom exact ou sous-domaine (ex. "tiktok.com" autorise
   * aussi "www.tiktok.com"). La requête initiale ET chaque redirection
   * doivent y correspondre. */
  allowedHosts: string[];
  /** Schémas autorisés — "https:" uniquement par défaut. Ne s'élargit que
   * pour les tests (serveur local en http, sans certificat). */
  allowedSchemes?: string[];
}

function hostIsAllowed(hostname: string, allowedHosts: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export class SafeFetchError extends Error {}

/** Comme `fetch()`, mais refuse tout schéma autre que https et ne suit une
 * redirection que si sa cible fait partie de `allowedHosts` — jamais
 * aveuglément. */
export async function safeFetch(url: string, options: SafeFetchOptions): Promise<Response> {
  const { allowedHosts, allowedSchemes = ["https:"], ...init } = options;
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new SafeFetchError(`safeFetch: URL invalide`);
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!allowedSchemes.includes(current.protocol)) {
      throw new SafeFetchError(`safeFetch: schéma non autorisé (${current.protocol})`);
    }
    if (!hostIsAllowed(current.hostname, allowedHosts)) {
      throw new SafeFetchError(`safeFetch: hôte non autorisé (${current.hostname})`);
    }

    const response = await fetch(current.toString(), { ...init, redirect: "manual" });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new SafeFetchError("safeFetch: redirection sans en-tête Location");
      }
      current = new URL(location, current);
      continue;
    }

    return response;
  }

  throw new SafeFetchError("safeFetch: trop de redirections");
}
