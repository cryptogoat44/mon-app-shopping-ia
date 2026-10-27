import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import { safeFetch } from "../lib/safeFetch.js";
import { exclusionReason, isCountryOrEuSite, withoutDuplicates } from "./matchFilters.js";
import { googleStateOf, isLocalCurrency, measureLens, sectionsOf, type FilterCounts, type LensMeasure, type LensSection } from "./lensMeasure.js";
import { CURRENT_LENS_SETTINGS, DEFAULT_LOCALE, type LensSettings, type SearchLocale } from "./lensSettings.js";

export { CURRENT_LENS_SETTINGS, type LensSettings, type SearchLocale };

export interface VisualMatch {
  rank: number;
  productName: string;
  /** Petite vignette hébergée par Google — toujours présente, sert de repli. */
  imageUrl: string;
  /** Image originale du marchand (haute définition), quand fournie. */
  imageHdUrl: string | null;
  merchantName: string | null;
  merchantUrl: string;
  priceValue: number | null;
  currency: string | null;
}

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
export type SerpApiVisualMatch = z.infer<typeof SERPAPI_VISUAL_MATCH>;
// Les autres rubriques sont gardées (passthrough) pour être comptées par la
// mesure, jamais lues.
const SERPAPI_LENS_RESPONSE = z
  .object({
    visual_matches: z.array(z.unknown()).optional(),
    error: z.string().optional(),
    search_information: z.object({ images_results_state: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const SERPAPI_ENDPOINT = "https://serpapi.com/search";
// Nombre de propositions gardées (programme, étape 4.A, confirmé par le
// fondateur au Lot S : jusqu'à 30, l'app en montre 12 puis « Voir plus »).
// SerpApi en renvoie ~60, dont beaucoup sans prix.
export const MAX_MATCHES = 30;
// Règle des prix (décision du fondateur du 2026-10-21, petit lot) : aux 30
// premières s'ajoutent au plus 10 propositions avec un prix trouvées plus loin,
// dans l'ordre de Google. Rien n'est retiré : la liste passe à 40 au plus.
export const MAX_PRICED_ADDITIONS = 10;
// Les 6 premières de Google restent à leur place, la moitié du premier écran :
// la pièce exacte s'y trouve le plus souvent (supposé ; réglage à revoir avec la mesure).
export const FIXED_TOP = 6;

// SerpApi lente ou muette ne doit jamais laisser une recherche bloquée en
// "processing" indéfiniment côté mobile.
const SERPAPI_TIMEOUT_MS = 15_000;

/** Type de panne d'un appel à SerpApi, rangé avec la recherche (mesure). */
export type LensFailureKind = "timeout" | "serpapi_error" | "unreadable_response";

export class LensCallError extends Error {
  constructor(
    readonly kind: LensFailureKind,
    message: string
  ) {
    super(message);
    this.name = "LensCallError";
  }
}

/** Ce que l'on garde d'une réponse de Google Lens. */
export interface LensResponse {
  matches: SerpApiVisualMatch[];
  /** Propositions renvoyées, lisibles ou non. */
  received: number;
  sections: LensSection[];
  googleState: "empty" | "other" | null;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/** Un seul appel SerpApi. `query` : réservé aux outils de mesure (scripts/).
 * Le serveur n'envoie plus jamais de mots avec l'image (petit lot, décision du
 * fondateur du 2026-10-25) : dans la série de mesure du 24 octobre, ils ont
 * fait baisser les résultats (maillot, pull blanc) ou les ont vidés (pull noir). */
export async function callSerpApi(imageUrl: string, settings: LensSettings, query: string | null = null): Promise<LensResponse> {
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
    throw new LensCallError(isTimeout(error) ? "timeout" : "serpapi_error", `SerpApi injoignable : ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new LensCallError("serpapi_error", `SerpApi a répondu ${response.status}`);

  const data = SERPAPI_LENS_RESPONSE.safeParse(await response.json().catch(() => null));
  if (!data.success) throw new LensCallError("unreadable_response", "SerpApi : réponse inattendue");
  // "Google Lens hasn't returned any results" arrive sous forme d'erreur
  // alors que c'est simplement une recherche vide : on la traite comme telle.
  if (data.data.error && !/hasn't returned any results/i.test(data.data.error)) {
    throw new LensCallError("serpapi_error", `SerpApi : ${data.data.error}`);
  }
  const items = data.data.visual_matches ?? [];
  return {
    matches: items.flatMap((item) => {
      const match = SERPAPI_VISUAL_MATCH.safeParse(item);
      return match.success ? [match.data] : [];
    }),
    received: items.length,
    sections: sectionsOf(data.data),
    googleState: googleStateOf(data.data.search_information?.images_results_state),
  };
}

type UsableMatch = SerpApiVisualMatch & { title: string; link: string };

/** Titre, lien et image présents. */
function isComplete(match: SerpApiVisualMatch): match is UsableMatch {
  return Boolean(match.title && (match.thumbnail || match.image) && match.link);
}

// Ce que la base sait ranger (product_matches) : aucun caractère nul, une
// devise de 3 caractères au plus (char(3)), un prix de moins de 100 millions
// (numeric(10,2)). Une valeur étrange n'annule jamais la proposition, ni les
// autres : le texte est nettoyé, le prix retiré (2026-10-15).
const MAX_CURRENCY_CHARACTERS = 3;
const MAX_PRICE = 99_999_999.99;

function withoutNul(text: string | undefined): string | undefined {
  return text?.replace(/\u0000/g, "");
}

function withCleanTexts(match: SerpApiVisualMatch): SerpApiVisualMatch {
  return { ...match, title: withoutNul(match.title), link: withoutNul(match.link), source: withoutNul(match.source), thumbnail: withoutNul(match.thumbnail), image: withoutNul(match.image) };
}

/** Prix et devise rangeables tels quels, sinon aucun prix. */
function storablePrice(price: SerpApiVisualMatch["price"]): Pick<VisualMatch, "priceValue" | "currency"> {
  const value = price?.extracted_value;
  const currency = withoutNul(price?.currency)?.trim() || null;
  const currencyFits = currency === null || [...currency].length <= MAX_CURRENCY_CHARACTERS;
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > MAX_PRICE || !currencyFits) {
    return { priceValue: null, currency: null };
  }
  return { priceValue: value, currency };
}

// Rang renuméroté APRÈS filtrage : le rang de Google compte aussi les
// réseaux sociaux écartés, et une liste qui commençait au rang 2 posait
// problème ailleurs (audit Lot Q, ROB-04).
function toVisualMatch(match: UsableMatch, index: number): VisualMatch {
  return {
    rank: index + 1,
    productName: match.title,
    imageUrl: (match.thumbnail ?? match.image)!,
    imageHdUrl: match.image ?? null,
    merchantName: match.source ?? null,
    merchantUrl: match.link,
    ...storablePrice(match.price),
  };
}

/** Groupe de proximité, pour le classement : 0 prix dans la devise du pays ;
 * 1 site du pays (.fr) ou .eu ; 2 le reste. */
function proximityGroup(match: UsableMatch, country: string): number {
  const { priceValue, currency } = storablePrice(match.price);
  if (priceValue !== null && isLocalCurrency(currency, country)) return 0;
  return isCountryOrEuSite(match.link, country) ? 1 : 2;
}

/** Les 6 premières de Google à leur place ; ensuite les prix dans la devise du
 * pays, puis les sites du pays ou .eu, puis le reste, dans l'ordre de Google à
 * l'intérieur de chaque groupe. Rien n'est retiré. */
function byProximity(matches: UsableMatch[], country: string): UsableMatch[] {
  const rest = matches.slice(FIXED_TOP).map((match, index) => ({ match, index, group: proximityGroup(match, country) }));
  rest.sort((a, b) => a.group - b.group || a.index - b.index);
  return [...matches.slice(0, FIXED_TOP), ...rest.map(({ match }) => match)];
}

/** Propositions gardées et classées, ce que chaque filtre a écarté, et le rang
 * d'origine chez Google des propositions ajoutées par la règle des prix (pour la
 * mesure). `country` : pays de la recherche, dont le site passe devant quand un
 * marchand propose le même article sur plusieurs sites de pays. */
export function filterVisualMatches(
  response: Pick<LensResponse, "matches" | "received">,
  country: string
): { matches: VisualMatch[]; counts: FilterCounts; addedRanks: number[] } {
  const complete = response.matches.map(withCleanTexts).filter(isComplete);
  const reasons = complete.map((match) => exclusionReason(match.link));
  const buyable = complete.filter((_, index) => reasons[index] === null);
  const unique = withoutDuplicates(buyable, country);
  const added = unique.slice(MAX_MATCHES).filter((match) => storablePrice(match.price).priceValue !== null).slice(0, MAX_PRICED_ADDITIONS);
  return {
    matches: byProximity([...unique.slice(0, MAX_MATCHES), ...added], country).map(toVisualMatch),
    counts: {
      removedIncomplete: response.received - complete.length,
      removedSocial: reasons.filter((reason) => reason === "social").length,
      removedProfessional: reasons.filter((reason) => reason === "professional").length,
      removedDuplicates: buyable.length - unique.length,
    },
    addedRanks: added.flatMap((match) => (match.position === undefined ? [] : [match.position])),
  };
}

export function toVisualMatches(matches: SerpApiVisualMatch[], country: string): VisualMatch[] {
  return filterVisualMatches({ matches, received: matches.length }, country).matches;
}

export interface VisualSearchOptions {
  locale?: SearchLocale;
}

export interface VisualSearchResult {
  matches: VisualMatch[];
  measure: LensMeasure;
  /** Rang d'origine chez Google des propositions ajoutées par la règle des prix. */
  addedRanks: number[];
}

/** Interroge Google Lens (via SerpApi) à partir d'une image publiquement
 * accessible et renvoie une liste normalisée de produits candidats, avec la
 * mesure de la recherche. Une panne lève une `LensCallError` typée.
 *
 * Exactement UN appel SerpApi (1 crédit), jamais de repli : l'ancien repli
 * en type=all doublait le coût de chaque échec pour un résultat
 * généralement aussi vide sur une image non recadrée (Lot S, décision du
 * fondateur). Un échec se traite désormais en recadrant, pas en relançant. */
export async function searchProductsByImageUrl(
  fastify: FastifyInstance,
  imageUrl: string,
  options: VisualSearchOptions = {}
): Promise<VisualSearchResult> {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const settings: LensSettings = { ...CURRENT_LENS_SETTINGS, locale };
  const response = await callSerpApi(imageUrl, settings);
  const { matches, counts, addedRanks } = filterVisualMatches(response, locale.country);
  if (matches.length === 0) {
    fastify.log.info({ type: settings.type }, "Recherche visuelle sans résultat");
  }
  return { matches, measure: measureLens(response, counts, matches, locale.country), addedRanks };
}
