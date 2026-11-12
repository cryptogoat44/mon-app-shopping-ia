// Recherche par texte de la voie C (lot c, 2026-11-02) : Google Shopping par
// le fournisseur (services/serpapi.ts), avec la requête écrite par l'IA
// (« Cette pièce dans d'autres boutiques ») ou vos mots (« Que
// cherchez-vous ? »). Sans aucun appel ici, sauf searchProductsByText.
// - Mêmes filtres que pour Lens (services/matchFilters.ts) : propositions
//   incomplètes, réseaux sociaux, vente aux professionnels, doublons ; en plus,
//   les pages déjà proposées par Lens, et les vignettes « data: » (jamais
//   rangées : vingt d'entre elles dépasseraient la taille permise du cache).
// - Lien : le lien direct vers le marchand s'il n'est pas une page de Google,
//   sinon la page produit de Google (comptée dans la mesure : le bouton « Voir
//   chez … » mène alors à Google, texte à revoir avec le fondateur).
// - Prix : jamais convertis. Seule la devise du pays de la recherche est
//   gardée (COUNTRY_CURRENCIES et isCountryCurrency, la table unique de
//   packages/shared-types) ; une autre devise, ou un pays dont la devise
//   n'est pas connue ici (en-DE, en-ES…), et le prix est caché (« Prix à
//   vérifier chez le marchand ») : la proposition, elle, reste.
// - 20 propositions au plus, après le tri (tri léger par marque et modèle, ou
//   tri par vos mots), jamais avant.
// - Aucune requête, aucun mot, aucun titre ni aucune adresse dans les journaux
//   ou les erreurs : seulement des nombres (mesure).
import { COUNTRY_CURRENCIES, isCountryCurrency } from "@monapp/shared-types";
import { exclusionReason, isGoogleLink, pageKey, withoutDuplicates } from "./matchFilters.js";
import type { SearchLocale } from "./lensSettings.js";
import type { ProviderShoppingItem, TextSearchProvider, TextSearchResponse } from "./searchProvider.js";
import { storablePrice, type VisualMatch } from "./visualSearch.js";

/** Propositions montrées au plus, par section (boutiques, ou vos mots). */
export const MAX_TEXT_MATCHES = 20;
// Propositions gardées après les filtres, avant le tri : bien au-delà de ce que
// Google Shopping renvoie d'habitude, mais le contenu du cache reste borné.
const MAX_SHOPPING_CANDIDATES = 60;

/** Une proposition de Google Shopping, rangée comme une proposition Lens.
 * `priceHidden` : un prix existait, dans une autre devise (caché, pour la mesure).
 * `hasProductId` : SerpApi donnait un identifiant produit (seulement compté
 * dans le journal des alertes prix, jamais rangé). */
export type ShoppingMatch = VisualMatch & { priceHidden: boolean; hasProductId?: true };

/** Ce que les filtres gardent d'une réponse (avant les pages Lens, le tri et
 * la coupe à 20) : c'est ce qui va dans le cache, pour une requête de l'IA. */
export interface ShoppingFiltered {
  matches: ShoppingMatch[];
  /** Propositions renvoyées, lisibles ou non. */
  received: number;
  /** Vignettes « data: » écartées. */
  droppedDataThumbnails: number;
}

/** Mesure d'une recherche par texte : des nombres, jamais de contenu. */
export interface TextSearchMeasure {
  received: number;
  kept: number;
  keptWithPrice: number;
  /** Gardées dont le lien mène à une page de Google, faute de lien direct. */
  googleLinks: number;
  /** Gardées dont le prix est caché (autre devise, ou devise du pays inconnue). */
  priceDroppedCurrency: number;
  droppedDataThumbnails: number;
}

function withoutNul(text: string | undefined): string | undefined {
  return text?.replace(/\u0000/g, "");
}

/** Adresse http(s) lisible, sinon rien. */
function usableUrl(text: string | undefined): string | undefined {
  if (!text || !/^https?:\/\//i.test(text)) return undefined;
  try {
    new URL(text);
    return text;
  } catch {
    return undefined;
  }
}

/** Page de Google (google.fr, www.google.co.uk, shopping.google.com…) : services/matchFilters.ts. */
export { isGoogleLink };

/** Le lien direct vers le marchand s'il n'est pas une page de Google, sinon la page produit de Google. */
function chosenLink(item: ProviderShoppingItem): string | undefined {
  const direct = usableUrl(item.link);
  if (direct && !isGoogleLink(direct)) return direct;
  return usableUrl(item.product_link) ?? direct;
}

/** Écriture de la devise dans le texte du prix : ce qui reste sans les
 * chiffres, les espaces et les séparateurs (« 1 234,50 € » → « € »). */
function currencyMark(price: string): string {
  return price.replace(/[\d\s.,'’]/gu, "");
}

/** Prix rangeable dans la devise du pays (« 49,99 € », « EUR 49.99 »,
 * lus avec la table unique des devises) ; sinon aucun prix (caché
 * si un prix existait). Un pays dont la devise n'est pas connue ici : caché. */
function shoppingPrice(item: ProviderShoppingItem, country: string): Pick<ShoppingMatch, "priceValue" | "currency" | "priceHidden"> {
  if (item.extracted_price === undefined) return { priceValue: null, currency: null, priceHidden: false };
  const local = COUNTRY_CURRENCIES[country];
  if (!local || !item.price || isCountryCurrency(currencyMark(item.price), country) !== true) return { priceValue: null, currency: null, priceHidden: true };
  return { ...storablePrice({ extracted_value: item.extracted_price, currency: local }), priceHidden: false };
}

interface Candidate {
  title: string;
  link: string;
  source: string | null;
  thumbnail: string;
  item: ProviderShoppingItem;
}

/** Filtres d'une réponse de Google Shopping, sans aucun appel : ce qui peut
 * aller dans le cache. Les rangs sont renumérotés dans l'ordre de Google. */
export function filterShoppingItems(response: Pick<TextSearchResponse, "items" | "received">, country: string): ShoppingFiltered {
  let droppedDataThumbnails = 0;
  const complete: Candidate[] = [];
  for (const raw of response.items) {
    const item: ProviderShoppingItem = {
      ...raw,
      title: withoutNul(raw.title),
      link: withoutNul(raw.link),
      product_link: withoutNul(raw.product_link),
      source: withoutNul(raw.source),
      price: withoutNul(raw.price),
      thumbnail: withoutNul(raw.thumbnail),
    };
    if (item.thumbnail?.trim().toLowerCase().startsWith("data:")) droppedDataThumbnails += 1;
    const thumbnail = usableUrl(item.thumbnail);
    const link = chosenLink(item);
    const title = item.title?.trim();
    if (title && link && thumbnail) complete.push({ title, link, source: item.source?.trim() || null, thumbnail, item });
  }
  const buyable = complete.filter((candidate) => exclusionReason(candidate.link) === null);
  const unique = withoutDuplicates(buyable, country).slice(0, MAX_SHOPPING_CANDIDATES);
  return {
    matches: unique.map((candidate, index) => ({
      rank: index + 1,
      productName: candidate.title,
      imageUrl: candidate.thumbnail,
      imageHdUrl: null,
      merchantName: candidate.source,
      merchantUrl: candidate.link,
      ...shoppingPrice(candidate.item, country),
      ...(candidate.item.product_id ? { hasProductId: true as const } : {}),
    })),
    received: response.received,
    droppedDataThumbnails,
  };
}

/** Sans les pages déjà proposées (par Lens, ou par une section précédente) :
 * même page produit = doublon. */
export function withoutKnownPages<T extends { merchantUrl: string }>(matches: readonly T[], known: readonly { merchantUrl: string }[]): { matches: T[]; removed: number } {
  const pages = new Set(known.map((match) => pageKey(match.merchantUrl)));
  const kept = matches.filter((match) => !pages.has(pageKey(match.merchantUrl)));
  return { matches: kept, removed: matches.length - kept.length };
}

/** Les 20 premières après le tri, rangs renumérotés, et la mesure. */
export function keepShown(ordered: readonly ShoppingMatch[], filtered: Pick<ShoppingFiltered, "received" | "droppedDataThumbnails">): { matches: ShoppingMatch[]; measure: TextSearchMeasure } {
  const matches = ordered.slice(0, MAX_TEXT_MATCHES).map((match, index) => ({ ...match, rank: index + 1 }));
  return {
    matches,
    measure: {
      received: filtered.received,
      kept: matches.length,
      keptWithPrice: matches.filter((match) => match.priceValue !== null).length,
      googleLinks: matches.filter((match) => isGoogleLink(match.merchantUrl)).length,
      priceDroppedCurrency: matches.filter((match) => match.priceHidden).length,
      droppedDataThumbnails: filtered.droppedDataThumbnails,
    },
  };
}

export interface TextSearchResult {
  matches: ShoppingMatch[];
  measure: TextSearchMeasure;
  /** Code de réponse du fournisseur. */
  statusCode: number;
}

/** UN appel à Google Shopping par le fournisseur, puis les filtres, les pages
 * déjà proposées par Lens (`lensMatches`), le tri (`order`, sinon l'ordre de
 * Google) et la coupe à 20. Une panne lève la `ProviderFailure` classée de
 * l'adaptateur, sans contenu. */
export async function searchProductsByText(
  provider: TextSearchProvider,
  query: string,
  locale: SearchLocale,
  signal: AbortSignal,
  lensMatches: readonly { merchantUrl: string }[],
  order: (matches: ShoppingMatch[]) => ShoppingMatch[] = (matches) => matches
): Promise<TextSearchResult> {
  const response = await provider.searchByText(query, locale, signal);
  const filtered = filterShoppingItems(response, locale.country);
  const fresh = withoutKnownPages(filtered.matches, lensMatches).matches;
  return { ...keepShown(order(fresh), filtered), statusCode: response.statusCode };
}
