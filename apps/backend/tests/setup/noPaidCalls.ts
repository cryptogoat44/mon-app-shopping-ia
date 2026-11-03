// Garde des tests (lot c, voie C, 2026-11-02) : aucun test ne peut appeler
// SerpApi ni Anthropic, même s'il oublie un faux. Chargé avant chaque fichier
// de tests (vitest.config.ts, setupFiles) : `fetch` refuse alors tout appel à
// serpapi.com ou à anthropic.com (et leurs sous-domaines), avant tout envoi.
// Un faux posé par un test (vi.stubGlobal, vi.spyOn, faux safeFetch) passe
// devant cette garde, comme avant ; les autres adresses (Supabase de
// développement, serveur local des tests) ne changent pas. Le message ne dit
// que le nom de l'hôte : jamais l'adresse complète, qui porterait la clé.

const PAID_HOSTS = ["serpapi.com", "anthropic.com"];

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

const realFetch = globalThis.fetch;

globalThis.fetch = async function guardedFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const host = hostOf(input);
  if (isPaidHost(host)) {
    throw new Error(`Appel payant refusé pendant les tests (${host}) : remplacez-le par un faux.`);
  }
  return realFetch(input, init);
};
