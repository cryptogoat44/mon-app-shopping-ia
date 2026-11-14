// Garde des tests (lot c, voie C, 2026-11-02) : aucun test ne peut appeler
// SerpApi ni Anthropic, même s'il oublie un faux. Chargé avant chaque fichier
// de tests (vitest.config.ts, setupFiles) : `fetch` refuse alors tout appel à
// serpapi.com ou à anthropic.com (et leurs sous-domaines), avant tout envoi,
// et au service des notifications d'Expo (exp.host, lot notifications).
// Essayage virtuel : FASHN (fashn.ai et ses sous-domaines, dont l'API
// api.fashn.ai) aussi ; seul le script tryon:smoke y envoie un vrai essai
// (tryon:report n'y lit le solde, gratuit, qu'avec --solde-fashn).
// Un faux posé par un test (vi.stubGlobal, vi.spyOn, faux safeFetch) passe
// devant cette garde, comme avant ; les autres adresses (Supabase de
// développement, serveur local des tests) ne changent pas. Le message ne dit
// que le nom de l'hôte : jamais l'adresse complète, qui porterait la clé.

const PAID_HOSTS = ["serpapi.com", "anthropic.com", "fashn.ai"];
// Lot notifications : le service d'Expo est gratuit, mais aucun test ne doit
// envoyer une vraie notification à un téléphone.
const PUSH_HOSTS = ["exp.host"];

function hostOf(input: unknown): string | null {
  try {
    if (typeof input === "string") return new URL(input).hostname.toLowerCase();
    if (input instanceof URL) return input.hostname.toLowerCase();
    if (input instanceof Request) return new URL(input.url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return null;
}

export function isPaidHost(host: string | null): boolean {
  return host !== null && PAID_HOSTS.some((paid) => host === paid || host.endsWith(`.${paid}`));
}

export function isPushHost(host: string | null): boolean {
  return host !== null && PUSH_HOSTS.some((push) => host === push || host.endsWith(`.${push}`));
}

const realFetch = globalThis.fetch;

globalThis.fetch = async function guardedFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const host = hostOf(input);
  if (isPaidHost(host)) {
    throw new Error(`Appel payant refusé pendant les tests (${host}) : remplacez-le par un faux.`);
  }
  if (isPushHost(host)) {
    throw new Error(`Vraie notification refusée pendant les tests (${host}) : remplacez l'envoi par un faux.`);
  }
  return realFetch(input, init);
};
