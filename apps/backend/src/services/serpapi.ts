// Adaptateur SerpApi (0027) : Google Lens par SerpApi, derrière l'interface
// unique du fournisseur (services/searchProvider.ts). L'appel est celui d'avant
// 0027 (déplacé depuis services/visualSearch.ts), avec une seule nouveauté :
// chaque panne est classée selon ce que SerpApi facture (conception acceptée
// le 20 octobre 2026), pour rendre la place d'un refus non facturé.
// Voie C (lot c, 2026-11-02) : Google Shopping par SerpApi (moteur
// google_shopping_light, celui mesuré les 24 et 25 octobre), même classement
// des pannes, mais sans jamais le texte d'erreur de SerpApi, qui pourrait
// reprendre la requête.
import { z } from "zod";
import { env } from "../env.js";
import { safeFetch } from "../lib/safeFetch.js";
import { googleStateOf, sectionsOf } from "./lensMeasure.js";
import { CURRENT_LENS_SETTINGS, type LensSettings, type SearchLocale } from "./lensSettings.js";
import {
  ProviderFailure,
  type ImageSearchResponse,
  type ProviderShoppingItem,
  type ProviderVisualMatch,
  type SearchProvider,
  type TextSearchProvider,
  type TextSearchResponse,
} from "./searchProvider.js";

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
// Erreur annoncée et statut de la recherche chez SerpApi : lus pour classer
// les pannes, quel que soit le moteur.
const SERPAPI_STATUS_FIELDS = {
  error: z.string().optional(),
  search_metadata: z.object({ status: z.string().optional() }).passthrough().optional(),
};
type SerpApiStatusFields = { error?: string; search_metadata?: { status?: string } };
// Les autres rubriques sont gardées (passthrough) pour être comptées par la
// mesure, jamais lues.
const SERPAPI_LENS_RESPONSE = z
  .object({
    visual_matches: z.array(z.unknown()).optional(),
    ...SERPAPI_STATUS_FIELDS,
    search_information: z.object({ images_results_state: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

// Google Shopping : prix en texte, avec sa valeur lue à part (sans devise).
// La vignette hébergée par SerpApi (serpapi_thumbnail) n'est jamais lue : elle
// peut expirer, et la charger enverrait l'adresse IP de la personne à SerpApi.
const SERPAPI_SHOPPING_ITEM = z.object({
  position: z.number().optional(),
  title: z.string().optional(),
  link: z.string().optional(),
  product_link: z.string().optional(),
  source: z.string().optional(),
  price: z.string().optional(),
  extracted_price: z.number().optional(),
  thumbnail: z.string().optional(),
});
const SERPAPI_SHOPPING_RESPONSE = z
  .object({
    shopping_results: z.array(z.unknown()).optional(),
    ...SERPAPI_STATUS_FIELDS,
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

/** Un appel à SerpApi, quel que soit le moteur, avec le classement des pannes
 * d'avant la voie C, inchangé : refus (non facturé), délai dépassé, erreur
 * incertaine ou réponse illisible. `echo` : le texte de l'erreur (réseau ou
 * SerpApi) figure dans le message, comme avant pour Lens ; jamais pour Google
 * Shopping, où il pourrait reprendre la requête : seulement le type et le code. */
async function fetchSerpApi<T extends SerpApiStatusFields>(
  params: URLSearchParams,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  signal: AbortSignal,
  echo: boolean
): Promise<{ data: T; status: number }> {
  let response: Response;
  try {
    response = await safeFetch(`${SERPAPI_ENDPOINT}?${params.toString()}`, {
      allowedHosts: ["serpapi.com"],
      signal,
    });
  } catch (error) {
    const kind = isTimeout(error) ? "timeout" : "error";
    throw new ProviderFailure(kind, null, echo ? `SerpApi injoignable : ${error instanceof Error ? error.message : String(error)}` : `SerpApi injoignable (${kind})`);
  }
  if (!response.ok) {
    throw new ProviderFailure(isRefusalStatus(response.status) ? "refused" : "error", response.status, `SerpApi a répondu ${response.status}`);
  }

  const data = schema.safeParse(await response.json().catch(() => null));
  if (!data.success) throw new ProviderFailure("unreadable", response.status, "SerpApi : réponse inattendue");
  // Statut « Error » : la recherche n'a pas abouti chez SerpApi, qui ne la facture pas.
  if (data.data.search_metadata?.status === "Error") {
    const detail = echo && data.data.error ? ` (${data.data.error})` : "";
    throw new ProviderFailure("refused", response.status, `SerpApi : statut « Error »${detail}`);
  }
  // "Google Lens hasn't returned any results" arrive sous forme d'erreur
  // alors que c'est simplement une recherche vide (facturée) : on la traite
  // comme telle (même phrase pour Google Shopping).
  if (data.data.error && !/hasn't returned any results/i.test(data.data.error)) {
    throw new ProviderFailure("error", response.status, echo ? `SerpApi : ${data.data.error}` : "SerpApi : erreur annoncée");
  }
  return { data: data.data, status: response.status };
}

/** Un seul appel SerpApi. `query` : réservé aux outils de mesure (scripts/).
 * Le serveur n'envoie plus jamais de mots avec l'image (petit lot, décision du
 * fondateur du 2026-10-25) : dans la série de mesure du 24 octobre, ils ont
 * fait baisser les résultats (maillot, pull blanc) ou les ont vidés (pull noir).
 * `signal` : arrêt de l'appel (plafond fixe de la voie C) ; sans lui, 15 s
 * comme avant. Une panne lève une `ProviderFailure` classée : refus (non
 * facturé), délai dépassé, erreur incertaine ou réponse illisible. */
export async function callSerpApi(imageUrl: string, settings: LensSettings, query: string | null = null, signal?: AbortSignal): Promise<ImageSearchResponse> {
  const params = new URLSearchParams({ engine: "google_lens", url: imageUrl, type: settings.type, api_key: env.SERPAPI_KEY });
  if (settings.locale) {
    params.set("country", settings.locale.country);
    params.set("hl", settings.locale.hl);
  }
  if (query) params.set("q", query);

  const { data, status } = await fetchSerpApi(params, SERPAPI_LENS_RESPONSE, signal ?? AbortSignal.timeout(SERPAPI_TIMEOUT_MS), true);
  const items = data.visual_matches ?? [];
  return {
    matches: items.flatMap((item): ProviderVisualMatch[] => {
      const match = SERPAPI_VISUAL_MATCH.safeParse(item);
      return match.success ? [match.data] : [];
    }),
    received: items.length,
    sections: sectionsOf(data),
    googleState: googleStateOf(data.search_information?.images_results_state),
    statusCode: status,
  };
}

/** Google Lens par SerpApi, avec les réglages en service (type=visual_matches). */
export const serpApiProvider: SearchProvider = {
  name: "serpapi",
  searchByImage: (imageUrl, locale, signal) => callSerpApi(imageUrl, { ...CURRENT_LENS_SETTINGS, locale }, null, signal),
};

/** Google Shopping de la voie C : une seule constante pour le moteur (celui
 * des mesures des 24 et 25 octobre ; une recherche facturée par appel, comme
 * Lens — à vérifier dans la documentation de SerpApi). */
export const SHOPPING_SETTINGS = { engine: "google_shopping_light" } as const;

// Domaine de Google : liste FERMÉE des quatre pays dont la devise est connue
// (services/textSearch.ts, SHOPPING_CURRENCIES) ; tout autre pays : google.com.
const GOOGLE_DOMAINS: Record<string, string> = {
  fr: "google.fr",
  gb: "google.co.uk",
  us: "google.com",
  ch: "google.ch",
};
const DEFAULT_GOOGLE_DOMAIN = "google.com";

export function googleDomainFor(country: string): string {
  return GOOGLE_DOMAINS[country] ?? DEFAULT_GOOGLE_DOMAIN;
}

/** Un seul appel à Google Shopping par SerpApi, avec le même pays et la même
 * langue que Lens (lib/locale.ts). Jamais d'image (url), jamais no_cache. Une
 * panne lève une `ProviderFailure` classée comme pour Lens, dont le message ne
 * dit que le type et le code : jamais la requête, ni le texte de SerpApi. */
export async function callShopping(query: string, locale: SearchLocale, signal: AbortSignal): Promise<TextSearchResponse> {
  const params = new URLSearchParams({
    engine: SHOPPING_SETTINGS.engine,
    q: query,
    gl: locale.country,
    hl: locale.hl,
    google_domain: googleDomainFor(locale.country),
    api_key: env.SERPAPI_KEY,
  });
  const { data, status } = await fetchSerpApi(params, SERPAPI_SHOPPING_RESPONSE, signal, false);
  const items = data.shopping_results ?? [];
  return {
    items: items.flatMap((item): ProviderShoppingItem[] => {
      const parsed = SERPAPI_SHOPPING_ITEM.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
    received: items.length,
    statusCode: status,
  };
}

/** Google Shopping par SerpApi (voie C : requête de l'IA, ou vos mots). */
export const serpApiTextProvider: TextSearchProvider = {
  name: "serpapi",
  searchByText: (query, locale, signal) => callShopping(query, locale, signal),
};
