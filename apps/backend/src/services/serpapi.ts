// Adaptateur SerpApi (0027) : Google Lens par SerpApi, derrière l'interface
// unique du fournisseur (services/searchProvider.ts). L'appel est celui d'avant
// 0027 (déplacé depuis services/visualSearch.ts), avec une seule nouveauté :
// chaque panne est classée selon ce que SerpApi facture (conception acceptée
// le 20 octobre 2026), pour rendre la place d'un refus non facturé.
import { z } from "zod";
import { env } from "../env.js";
import { safeFetch } from "../lib/safeFetch.js";
import { googleStateOf, sectionsOf } from "./lensMeasure.js";
import { CURRENT_LENS_SETTINGS, type LensSettings } from "./lensSettings.js";
import { ProviderFailure, type ImageSearchResponse, type ProviderVisualMatch, type SearchProvider } from "./searchProvider.js";

// Réponse de SerpApi lue avec zod (charte, règle 19) : une proposition mal
// formée est écartée, sans faire échouer les autres.
const SERPAPI_VISUAL_MATCH = z.object({
  position: z.number().optional(),
  title: z.string().optional(),
  link: z.string().optional(),
  source: z.string().optional(),
  thumbnail: z.string().optional(),
  image: z.string().optional(),
  price: z.object({ value: z.string().optional(), extracted_value: z.number().optional(), currency: z.string().optional() }).optional(),
});
// Les autres rubriques sont gardées (passthrough) pour être comptées par la
// mesure, jamais lues.
const SERPAPI_LENS_RESPONSE = z
  .object({
    visual_matches: z.array(z.unknown()).optional(),
    error: z.string().optional(),
    search_metadata: z.object({ status: z.string().optional() }).passthrough().optional(),
    search_information: z.object({ images_results_state: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const SERPAPI_ENDPOINT = "https://serpapi.com/search";

// SerpApi lente ou muette ne doit jamais laisser une recherche bloquée en
// "processing" indéfiniment côté mobile.
const SERPAPI_TIMEOUT_MS = 15_000;

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/** Refus annoncé par SerpApi, non facturé (serpapi.com/pricing et
 * serpapi.com/api-status-and-error-codes, lus le 20 octobre 2026) : codes 400
 * à 499, 500 et 503. Tout autre code d'erreur reste incertain, donc compté. */
export function isRefusalStatus(status: number): boolean {
  return (status >= 400 && status <= 499) || status === 500 || status === 503;
}

/** Un seul appel SerpApi. `query` : réservé aux outils de mesure (scripts/).
 * Le serveur n'envoie plus jamais de mots avec l'image (petit lot, décision du
 * fondateur du 2026-10-25) : dans la série de mesure du 24 octobre, ils ont
 * fait baisser les résultats (maillot, pull blanc) ou les ont vidés (pull noir).
 * Une panne lève une `ProviderFailure` classée : refus (non facturé), délai
 * dépassé, erreur incertaine ou réponse illisible. */
export async function callSerpApi(imageUrl: string, settings: LensSettings, query: string | null = null): Promise<ImageSearchResponse> {
  const params = new URLSearchParams({ engine: "google_lens", url: imageUrl, type: settings.type, api_key: env.SERPAPI_KEY });
  if (settings.locale) {
    params.set("country", settings.locale.country);
    params.set("hl", settings.locale.hl);
  }
  if (query) params.set("q", query);

  let response: Response;
  try {
    response = await safeFetch(`${SERPAPI_ENDPOINT}?${params.toString()}`, {
      allowedHosts: ["serpapi.com"],
      signal: AbortSignal.timeout(SERPAPI_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ProviderFailure(isTimeout(error) ? "timeout" : "error", null, `SerpApi injoignable : ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new ProviderFailure(isRefusalStatus(response.status) ? "refused" : "error", response.status, `SerpApi a répondu ${response.status}`);
  }

  const data = SERPAPI_LENS_RESPONSE.safeParse(await response.json().catch(() => null));
  if (!data.success) throw new ProviderFailure("unreadable", response.status, "SerpApi : réponse inattendue");
  // Statut « Error » : la recherche n'a pas abouti chez SerpApi, qui ne la facture pas.
  if (data.data.search_metadata?.status === "Error") {
    throw new ProviderFailure("refused", response.status, `SerpApi : statut « Error »${data.data.error ? ` (${data.data.error})` : ""}`);
  }
  // "Google Lens hasn't returned any results" arrive sous forme d'erreur
  // alors que c'est simplement une recherche vide (facturée) : on la traite comme telle.
  if (data.data.error && !/hasn't returned any results/i.test(data.data.error)) {
    throw new ProviderFailure("error", response.status, `SerpApi : ${data.data.error}`);
  }
  const items = data.data.visual_matches ?? [];
  return {
    matches: items.flatMap((item): ProviderVisualMatch[] => {
      const match = SERPAPI_VISUAL_MATCH.safeParse(item);
      return match.success ? [match.data] : [];
    }),
    received: items.length,
    sections: sectionsOf(data.data),
    googleState: googleStateOf(data.data.search_information?.images_results_state),
    statusCode: response.status,
  };
}

/** Google Lens par SerpApi, avec les réglages en service (type=visual_matches). */
export const serpApiProvider: SearchProvider = {
  name: "serpapi",
  searchByImage: (imageUrl, locale) => callSerpApi(imageUrl, { ...CURRENT_LENS_SETTINGS, locale }),
};
