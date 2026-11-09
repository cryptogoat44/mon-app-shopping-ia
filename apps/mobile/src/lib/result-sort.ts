// Tri et filtre des résultats (demande du fondateur, 2026-11-08 : « je veux
// les prix »). Écran Résultat seulement, affichage seulement : le serveur, ses
// résultats et leurs rangs ne changent pas.
// - « Pertinence » (par défaut) : l'écran d'aujourd'hui, inchangé (grande
//   carte, sections, « Sans prix » replié : lib/price-first.ts).
// - « Prix croissant » / « Prix décroissant » : une seule liste de toutes les
//   propositions (recherche visuelle, boutiques, vos mots), triée par prix,
//   sans grande carte ni titres de section.
// - Une devise n'est jamais convertie ni comparée à une autre : le tri se fait
//   dans la devise la plus fréquente des résultats ; les autres devises
//   viennent après, chacune triée à part ; les propositions sans prix en
//   dernier, dans l'ordre de la recherche.
// - « Avec prix seulement » masque les propositions sans prix, dans tous les modes.
// - Les indices restent ceux de la liste complète de l'écran (allPieces) :
//   chaque carte et ses boutons visent toujours sa propre pièce.
// Logique pure, testée. Imports relatifs : fichier testé par vitest.
import type { Piece, SpotResult } from "../api/types";
import { allPieces, type IndexedPiece } from "./result-sections";
import { hasPrice, priceFirstSections, type PriceFirstSections } from "./price-first";

type ResultLists = Pick<SpotResult, "pieces" | "complement">;

export const RESULT_SORTS = ["relevance", "price_asc", "price_desc"] as const;
export type ResultSort = (typeof RESULT_SORTS)[number];
export type PriceSort = Exclude<ResultSort, "relevance">;

/** Le tri et le filtre choisis, gardés sur l'appareil (preferences-context.tsx). */
export interface ResultView {
  sort: ResultSort;
  withPriceOnly: boolean;
}

export const DEFAULT_RESULT_VIEW: ResultView = { sort: "relevance", withPriceOnly: false };

export const RESULT_VIEW_STORAGE_KEY = "spotto.tri-resultats";

export function isPriceSort(sort: ResultSort): sort is PriceSort {
  return sort === "price_asc" || sort === "price_desc";
}

/** Valeur gardée sur l'appareil ; illisible ou absente : le choix par défaut. */
export function parseResultView(raw: unknown): ResultView {
  if (typeof raw !== "string") return DEFAULT_RESULT_VIEW;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return DEFAULT_RESULT_VIEW;
    const { sort, withPriceOnly } = value as { sort?: unknown; withPriceOnly?: unknown };
    return {
      sort: typeof sort === "string" && (RESULT_SORTS as readonly string[]).includes(sort) ? (sort as ResultSort) : "relevance",
      withPriceOnly: withPriceOnly === true,
    };
  } catch {
    return DEFAULT_RESULT_VIEW;
  }
}

export function serializeResultView(view: ResultView): string {
  return JSON.stringify({ sort: view.sort, withPriceOnly: view.withPriceOnly });
}

// ---- Devises ----

// Écritures d'une même devise : Google Lens écrit souvent un symbole (« € »,
// « $US »), Google Shopping un code (« EUR ») — même table que
// lib/foreign-shop.ts et le serveur. « $ » seul n'est le dollar américain que
// pour une recherche faite aux États-Unis (ailleurs : dollar canadien,
// australien…) ; il reste à part sinon.
const CURRENCY_ALIASES: Record<string, string> = { "€": "EUR", "£": "GBP", US$: "USD", $US: "USD" };
const COUNTRY_CURRENCY: Record<string, string> = { fr: "EUR", us: "USD", gb: "GBP", ch: "CHF" };

/** La devise d'un prix, écrite d'une seule façon (« € » et « EUR » → « EUR »).
 * null sans devise. `country` : pays de la recherche (lib/foreign-shop.ts). */
export function currencyKey(currency: string | null | undefined, country?: string): string | null {
  const code = currency?.trim().toUpperCase();
  if (!code) return null;
  if (code === "$") return country === "us" ? "USD" : "$";
  return CURRENCY_ALIASES[code] ?? code;
}

/** Un prix qu'on peut trier : supérieur à 0 (un prix à 0 est une donnée
 * douteuse, relecture ORD-8) et avec sa devise. */
function sortablePrice(piece: Pick<Piece, "priceFrom" | "currency">, country?: string): { amount: number; currency: string } | null {
  const currency = currencyKey(piece.currency, country);
  if (piece.priceFrom === null || !(piece.priceFrom > 0) || currency === null) return null;
  return { amount: piece.priceFrom, currency };
}

export interface CurrencyGroup {
  currency: string;
  /** Propositions avec un prix dans cette devise, dans l'ordre de la recherche. */
  items: IndexedPiece[];
}

/** Les propositions avec un prix, groupées par devise. La première est la
 * devise dominante : la plus fréquente ; à égalité, celle du pays de la
 * recherche (l'euro quand l'app est en français), sinon celle qui apparaît
 * la première dans l'ordre de la recherche. Les autres suivent dans le même ordre. */
export function currencyGroups(items: readonly IndexedPiece[], country?: string): CurrencyGroup[] {
  const groups = new Map<string, IndexedPiece[]>();
  for (const item of items) {
    const price = sortablePrice(item.piece, country);
    if (!price) continue;
    const list = groups.get(price.currency) ?? [];
    list.push(item);
    groups.set(price.currency, list);
  }
  const preferred = country ? COUNTRY_CURRENCY[country] : undefined;
  const firstIndex = (group: CurrencyGroup) => Math.min(...group.items.map(({ index }) => index));
  return [...groups]
    .map(([currency, list]) => ({ currency, items: [...list].sort((a, b) => a.index - b.index) }))
    .sort(
      (a, b) =>
        b.items.length - a.items.length || Number(b.currency === preferred) - Number(a.currency === preferred) || firstIndex(a) - firstIndex(b)
    );
}

function indexed(result: ResultLists): IndexedPiece[] {
  return allPieces(result).map((piece, index) => ({ piece, index }));
}

/** Devise dominante des résultats affichés (currencyGroups) ; null si aucun prix. */
export function dominantCurrency(result: ResultLists, country?: string): string | null {
  return currencyGroups(indexed(result), country)[0]?.currency ?? null;
}

/** Une seule liste de toutes les propositions de l'écran, triée par prix :
 * 1. la devise dominante, du moins cher au plus cher (ou l'inverse) ;
 * 2. les autres devises, chacune triée à part ;
 * 3. les prix douteux (0, ou sans devise), dans l'ordre de la recherche ;
 * 4. les propositions sans prix, dans l'ordre de la recherche — sauf avec
 *    « Avec prix seulement ».
 * À prix égal, l'ordre de la recherche décide. Des boutiques arrivées après
 * le premier affichage prennent simplement leur place dans le tri. */
export function priceSortedList(result: ResultLists, sort: PriceSort, options: { country?: string; withPriceOnly?: boolean } = {}): IndexedPiece[] {
  const items = indexed(result);
  const direction = sort === "price_asc" ? 1 : -1;
  const amount = (item: IndexedPiece) => item.piece.priceFrom ?? 0;
  const sorted = currencyGroups(items, options.country).flatMap((group) =>
    [...group.items].sort((a, b) => direction * (amount(a) - amount(b)) || a.index - b.index)
  );
  const placed = new Set(sorted.map(({ index }) => index));
  const doubtful = items.filter((item) => !placed.has(item.index) && hasPrice(item.piece));
  const withoutPrice = options.withPriceOnly ? [] : items.filter((item) => !hasPrice(item.piece));
  return [...sorted, ...doubtful, ...withoutPrice];
}

/** La liste triée affichée, sans la proposition mise en grand (touchée dans
 * la liste triée), qui la quitte comme en mode « Pertinence ». */
export function priceListShown(list: readonly IndexedPiece[], bigCardIndex: number | null): IndexedPiece[] {
  return bigCardIndex === null ? [...list] : list.filter(({ index }) => index !== bigCardIndex);
}

/** Propositions de la liste triée montrées d'emblée, avant son « Voir plus ». */
export const PRICE_LIST_SHOWN_FIRST = 20;

export interface PriceSummary {
  /** Offres avec un prix dans la devise dominante. */
  count: number;
  /** La moins chère d'entre elles (la première de la recherche à prix égal). */
  cheapest: IndexedPiece;
}

/** Ligne « N offres · à partir de X € » : offres avec un prix dans la devise
 * dominante, et la moins chère. null sans aucun prix. Comptée sur toutes les
 * propositions, quel que soit le mode : elle change quand les boutiques
 * arrivent, jamais la grande carte. */
export function priceSummary(result: ResultLists, country?: string): PriceSummary | null {
  const group = currencyGroups(indexed(result), country)[0];
  if (!group) return null;
  const cheapest = group.items.reduce((best, item) => ((item.piece.priceFrom ?? 0) < (best.piece.priceFrom ?? 0) ? item : best));
  return { count: group.items.length, cheapest };
}

/** Indice de la proposition marquée « Le moins cher » : la moins chère de la
 * devise dominante, s'il y a au moins deux offres à comparer dans cette
 * devise ; null sinon. Elle peut être la grande carte en mode « Pertinence ». */
export function cheapestIndex(result: ResultLists, country?: string): number | null {
  const summary = priceSummary(result, country);
  return summary && summary.count >= 2 ? summary.cheapest.index : null;
}

/** « Avec prix seulement » en mode « Pertinence » : les mêmes sections, dans
 * le même ordre, sans les propositions sans prix ; « Sans prix » disparaît. */
export function sectionsWithPriceOnly(sections: PriceFirstSections): PriceFirstSections {
  const priced = (list: IndexedPiece[]) => list.filter(({ piece }) => hasPrice(piece));
  return { others: priced(sections.others), shopping: priced(sections.shopping), words: priced(sections.words), withoutPrice: [] };
}

/** La grande carte est-elle montrée ?
 * - « Pertinence » : oui, toujours la même (lib/price-first.ts) ;
 * - tri par prix : seulement quand la personne a touché une carte de la
 *   liste triée (elle passe en grand, avec ses boutons) ;
 * - « Avec prix seulement » : pas une grande carte sans prix. Elle est
 *   seulement masquée : elle ne change pas, et revient le filtre retiré. */
export function bigCardShown(view: ResultView, bigCard: Pick<Piece, "priceFrom">, pickedInPriceList: boolean): boolean {
  if (view.withPriceOnly && !hasPrice(bigCard)) return false;
  return view.sort === "relevance" || pickedInPriceList;
}

/** Plus aucune proposition à montrer avec « Avec prix seulement » : l'écran le
 * dit, avec un bouton pour retirer le filtre, au lieu d'une page vide. */
export function nothingWithPrice(result: ResultLists, view: ResultView): boolean {
  return view.withPriceOnly && !allPieces(result).some(hasPrice);
}

/** Ce que l'écran Résultat affiche pour un tri et un filtre donnés. */
export interface ResultLayout {
  /** Indice de la proposition montrée en grand (allPieces), ou null : pas de grande carte. */
  bigCard: number | null;
  /** Sections de « Pertinence » (lib/price-first.ts), filtrées par « Avec prix seulement ». */
  sections: PriceFirstSections;
  /** Tri par prix : la liste unique, sans la grande carte ; null en « Pertinence ». */
  priceList: IndexedPiece[] | null;
  summary: PriceSummary | null;
  cheapest: number | null;
  /** « Avec prix seulement » et rien avec un prix : le dire, avec de quoi retirer le filtre. */
  emptyWithFilter: boolean;
}

/** La disposition de l'écran. `selectedIndex` : la grande carte de l'écran
 * (choix de la personne, sinon celle d'office — lib/price-first.ts), qui ne
 * dépend jamais du tri ; `pickedInPriceList` : la personne vient de toucher
 * une carte de la liste triée. En « Pertinence » sans filtre : exactement
 * l'écran d'avant (mêmes sections, même grande carte). */
export function resultLayout(result: ResultLists, view: ResultView, options: { selectedIndex: number; pickedInPriceList: boolean; country?: string }): ResultLayout {
  const { selectedIndex, pickedInPriceList, country } = options;
  const bigCard = allPieces(result)[selectedIndex];
  const shown = bigCard !== undefined && bigCardShown(view, bigCard, pickedInPriceList);
  const sections = priceFirstSections(result, selectedIndex);
  return {
    bigCard: shown ? selectedIndex : null,
    sections: view.withPriceOnly ? sectionsWithPriceOnly(sections) : sections,
    priceList: isPriceSort(view.sort) ? priceListShown(priceSortedList(result, view.sort, { country, withPriceOnly: view.withPriceOnly }), shown ? selectedIndex : null) : null,
    summary: priceSummary(result, country),
    cheapest: cheapestIndex(result, country),
    emptyWithFilter: nothingWithPrice(result, view),
  };
}

/** Propriétés de l'événement « result_view_changed » (analytics-events.ts) :
 * le nouveau choix et ce qui a changé, des valeurs fermées seulement. */
export function resultViewChangeProps(previous: ResultView, next: ResultView): { sort: ResultSort; with_price_only: boolean; change: "sort" | "filter" } | null {
  if (previous.sort !== next.sort) return { sort: next.sort, with_price_only: next.withPriceOnly, change: "sort" };
  if (previous.withPriceOnly !== next.withPriceOnly) return { sort: next.sort, with_price_only: next.withPriceOnly, change: "filter" };
  return null;
}
