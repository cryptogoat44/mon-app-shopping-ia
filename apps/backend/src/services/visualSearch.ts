import type { FastifyInstance } from "fastify";
import { exclusionReason, isCountryOrEuSite, withoutDuplicates } from "./matchFilters.js";
import { isLocalCurrency, measureLens, type FilterCounts, type LensMeasure } from "./lensMeasure.js";
import { DEFAULT_LOCALE, type SearchLocale } from "./lensSettings.js";
import { serpApiProvider } from "./serpapi.js";
import type { ImageSearchResponse, ProviderVisualMatch, SearchProvider } from "./searchProvider.js";

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

/** Le fournisseur de la recherche par image (un seul adaptateur pour
 * l'instant). Son nom est rangé avec chaque recherche. */
export const IMAGE_SEARCH_PROVIDER: SearchProvider = serpApiProvider;

// Nombre de propositions gardées (programme, étape 4.A, confirmé par le
// fondateur au Lot S : jusqu'à 30, l'app en montre 12 puis « Voir plus »).
// Google Lens en renvoie ~60, dont beaucoup sans prix.
export const MAX_MATCHES = 30;
// Règle des prix (décision du fondateur du 2026-10-21, petit lot) : aux 30
// premières s'ajoutent au plus 10 propositions avec un prix trouvées plus loin,
// dans l'ordre de Google. Rien n'est retiré : la liste passe à 40 au plus.
export const MAX_PRICED_ADDITIONS = 10;
// Les 6 premières de Google restent à leur place, la moitié du premier écran :
// la pièce exacte s'y trouve le plus souvent (supposé ; réglage à revoir avec la mesure).
export const FIXED_TOP = 6;

type UsableMatch = ProviderVisualMatch & { title: string; link: string };

/** Titre, lien et image présents. */
function isComplete(match: ProviderVisualMatch): match is UsableMatch {
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

function withCleanTexts(match: ProviderVisualMatch): ProviderVisualMatch {
  return { ...match, title: withoutNul(match.title), link: withoutNul(match.link), source: withoutNul(match.source), thumbnail: withoutNul(match.thumbnail), image: withoutNul(match.image) };
}

/** Prix et devise rangeables tels quels, sinon aucun prix. */
function storablePrice(price: ProviderVisualMatch["price"]): Pick<VisualMatch, "priceValue" | "currency"> {
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
  response: Pick<ImageSearchResponse, "matches" | "received">,
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

export function toVisualMatches(matches: ProviderVisualMatch[], country: string): VisualMatch[] {
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
  /** Code de réponse du fournisseur (rangé avec la recherche). */
  statusCode: number;
}

/** Interroge Google Lens (par le fournisseur de la recherche par image) à
 * partir d'une image publiquement accessible et renvoie une liste normalisée
 * de produits candidats, avec la mesure de la recherche. Une panne lève une
 * `ProviderFailure` classée (services/searchProvider.ts).
 *
 * Exactement UN appel au fournisseur (1 crédit), jamais de repli : l'ancien
 * repli en type=all doublait le coût de chaque échec pour un résultat
 * généralement aussi vide sur une image non recadrée (Lot S, décision du
 * fondateur). Un échec se traite désormais en recadrant, pas en relançant. */
export async function searchProductsByImageUrl(
  fastify: FastifyInstance,
  imageUrl: string,
  options: VisualSearchOptions = {}
): Promise<VisualSearchResult> {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const response = await IMAGE_SEARCH_PROVIDER.searchByImage(imageUrl, locale);
  const { matches, counts, addedRanks } = filterVisualMatches(response, locale.country);
  if (matches.length === 0) {
    fastify.log.info({ provider: IMAGE_SEARCH_PROVIDER.name }, "Recherche visuelle sans résultat");
  }
  return { matches, measure: measureLens(response, counts, matches, locale.country), addedRanks, statusCode: response.statusCode };
}
