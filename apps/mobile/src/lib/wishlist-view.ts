// Écran Envies (2026-11-09, demande du fondateur : « je veux les prix ») :
// chercher dans ses envies, les trier par prix et voir leur total.
// Affichage seulement : le serveur et ses envies ne changent pas.
// - Recherche : dans le nom et la boutique, sans tenir compte des majuscules
//   ni des accents ; chaque mot tapé doit s'y trouver.
// - Tri : « Récentes » (par défaut, l'ordre d'aujourd'hui), « Prix croissant »,
//   « Prix décroissant ». Mêmes règles que les résultats, avec le code des
//   résultats lui-même (lib/result-sort.ts, inchangé) : devise la plus
//   fréquente d'abord, les autres devises ensuite (chacune à part), puis les
//   prix douteux (0, sans devise) et les envies sans prix, dans l'ordre récent.
// - Total : sur les envies affichées (collection et recherche comprises),
//   dans la devise la plus fréquente seulement, jamais converti ; la ligne dit
//   combien d'envies sont dans une autre devise ou sans prix.
// Logique pure, testée. Imports relatifs : fichier testé par vitest.
import type { Piece } from "../api/types";
import { t } from "../i18n";
import { formatPrice } from "./format";
import type { Locale } from "./preferences";
import { currencyGroups, priceSortedList } from "./result-sort";

export const WISHLIST_SORTS = ["recent", "price_asc", "price_desc"] as const;
export type WishlistSort = (typeof WISHLIST_SORTS)[number];

export const DEFAULT_WISHLIST_SORT: WishlistSort = "recent";

export const WISHLIST_SORT_STORAGE_KEY = "spotto.tri-envies";

/** Envies lues d'office pour la recherche, le tri et le total (pages de 24 ;
 * une collection en compte 100 au plus). Au-delà, la ligne du total le dit. */
export const WISHLIST_LOAD_MAX = 500;

// ---- Tri gardé sur l'appareil (preferences-context.tsx) ----

/** Valeur gardée ; illisible ou absente : « Récentes ». */
export function parseWishlistSort(raw: unknown): WishlistSort {
  return typeof raw === "string" && (WISHLIST_SORTS as readonly string[]).includes(raw) ? (raw as WishlistSort) : DEFAULT_WISHLIST_SORT;
}

/** Tri gardé ; stockage illisible ou refusé (navigation privée) : « Récentes ». */
export async function readWishlistSort(getItem: (key: string) => Promise<string | null>): Promise<WishlistSort> {
  try {
    return parseWishlistSort(await getItem(WISHLIST_SORT_STORAGE_KEY));
  } catch {
    return DEFAULT_WISHLIST_SORT;
  }
}

/** Garde le tri choisi ; stockage refusé : il vaut pour cette session seulement. */
export async function saveWishlistSort(setItem: (key: string, value: string) => Promise<void>, sort: WishlistSort): Promise<void> {
  try {
    await setItem(WISHLIST_SORT_STORAGE_KEY, sort);
  } catch {
    // Rien à faire : le choix reste affiché jusqu'à la fermeture de l'app.
  }
}

/** Propriétés de l'événement « wishlist_sort_changed » (analytics-events.ts) :
 * le nouveau tri et s'il est choisi dans une collection, des valeurs fermées
 * seulement (jamais la recherche). null : rien n'a changé. */
export function wishlistSortChangeProps(previous: WishlistSort, next: WishlistSort, inCollection: boolean): { sort: WishlistSort; in_collection: boolean } | null {
  return previous === next ? null : { sort: next, in_collection: inCollection };
}

// ---- Recherche ----

const LIGATURES: Record<string, string> = { "\u0153": "oe", "\u00e6": "ae", "\u00df": "ss" };

/** Texte comparable : minuscules, sans accents (« Été » → « ete »), espaces
 * réduits. Sans `normalize` (vieux moteur) : seulement les minuscules. */
export function searchKey(text: string | null | undefined): string {
  let key = (text ?? "").toLowerCase();
  try {
    key = key.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    // Accents gardés : la recherche marche encore, en tenant compte des accents.
  }
  return key
    .replace(/[\u0153\u00e6\u00df]/g, (letter) => LIGATURES[letter] ?? letter)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** L'envie correspond-elle à la recherche ? Chaque mot tapé doit se trouver
 * dans son nom ou sa boutique. Recherche vide : toutes correspondent. */
export function matchesSearch(item: Pick<Piece, "name" | "merchantName">, query: string): boolean {
  const words = searchKey(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${searchKey(item.name)} ${searchKey(item.merchantName)}`;
  return words.every((word) => haystack.includes(word));
}

export function searchWishlist<T extends Pick<Piece, "name" | "merchantName">>(items: readonly T[], query: string): T[] {
  return items.filter((item) => matchesSearch(item, query));
}

// ---- Tri ----

/** Envies dans l'ordre choisi. « Récentes » : l'ordre reçu, inchangé. Par
 * prix : priceSortedList des résultats, appliqué aux envies telles quelles. */
export function sortWishlist<T extends Piece>(items: readonly T[], sort: WishlistSort, country?: string): T[] {
  if (sort === "recent") return [...items];
  return priceSortedList({ pieces: [...items] }, sort, { country }).map(({ index }) => items[index]!);
}

// ---- Total ----

export interface WishlistTotal {
  /** Envies affichées. */
  count: number;
  /** Devise la plus fréquente parmi elles ; null : aucun prix utilisable. */
  currency: string | null;
  /** Somme de leurs prix dans cette devise (calculée au centime près). */
  amount: number;
  /** Envies comptées dans le total. */
  counted: number;
  /** Envies avec un prix dans une autre devise : jamais ajoutées. */
  otherCurrency: number;
  /** Envies sans prix, ou avec un prix douteux (0, sans devise). */
  withoutPrice: number;
}

/** Total des envies données, dans la devise la plus fréquente (même choix que
 * les résultats : currencyGroups ; à égalité, celle du pays, sinon la plus récente). */
export function wishlistTotal(items: readonly Piece[], country?: string): WishlistTotal {
  const [main, ...others] = currencyGroups(
    items.map((piece, index) => ({ piece, index })),
    country
  );
  const cents = main ? main.items.reduce((sum, { piece }) => sum + Math.round((piece.priceFrom ?? 0) * 100), 0) : 0;
  const counted = main?.items.length ?? 0;
  const otherCurrency = others.reduce((sum, group) => sum + group.items.length, 0);
  return { count: items.length, currency: main?.currency ?? null, amount: cents / 100, counted, otherCurrency, withoutPrice: items.length - counted - otherCurrency };
}

/** Ce que la ligne du total résume : toutes les envies, une collection, ou une recherche. */
export type WishlistScope = "all" | "collection" | "search";

/** Ligne « 12 envies · total 1 249 € + 2 sans prix », et sa version lue par
 * VoiceOver (virgules au lieu du point médian). */
export function wishlistTotalText(total: WishlistTotal, scope: WishlistScope, locale: Locale): { text: string; label: string } {
  let text: string;
  if (total.currency === null) {
    text = t.wishlist.noPriceLine(total.count, scope);
  } else {
    text = t.wishlist.totalLine(total.count, formatPrice(total.amount, total.currency, locale), scope);
    if (total.otherCurrency > 0) text += ` ${t.wishlist.totalOtherCurrency(total.otherCurrency)}`;
    if (total.withoutPrice > 0) text += ` ${t.wishlist.totalWithoutPrice(total.withoutPrice)}`;
  }
  return { text, label: text.replace(/ · /g, ", ") };
}

// ---- Ce que l'écran affiche ----

export interface WishlistView<T> {
  /** Envies affichées : recherche puis tri. */
  visible: T[];
  /** Total des envies affichées (l'ordre n'y change rien). */
  total: WishlistTotal;
}

/** `items` : les envies lues pour la puce choisie (« Toutes » ou une
 * collection), dans l'ordre récent. La recherche filtre, le tri ordonne ; le
 * total porte sur les envies trouvées, dans leur ordre récent (la devise
 * choisie ne dépend jamais du tri). */
export function wishlistView<T extends Piece>(items: readonly T[], options: { query: string; sort: WishlistSort; country?: string }): WishlistView<T> {
  const found = searchWishlist(items, options.query);
  return { visible: sortWishlist(found, options.sort, options.country), total: wishlistTotal(found, options.country) };
}

export function wishlistScope(query: string, inCollection: boolean): WishlistScope {
  if (searchKey(query).length > 0) return "search";
  return inCollection ? "collection" : "all";
}

// ---- Lecture de toutes les pages ----

export interface WishlistPageOf<T> {
  items: T[];
  nextCursor: string | null;
}

/** Lit toutes les envies, page après page, jusqu'à `max` : recherche, tri et
 * total portent ainsi sur toutes, pas seulement sur la première page.
 * - La première page est remise dès son arrivée (`onFirstPage`) ; son échec
 *   remonte, comme avant.
 * - Une page suivante en échec arrête la lecture : ce qui est lu est rendu,
 *   avec le curseur de la page manquante (l'écran dit alors que le total
 *   porte sur les envies chargées, et le défilement reprend la lecture).
 * - `active` devenu faux (autre puce choisie, écran quitté) : lecture
 *   abandonnée, null est rendu.
 * Une envie déjà reçue n'est jamais ajoutée deux fois. */
export async function loadAllPages<T extends { id: string }>(
  fetchPage: (cursor?: string) => Promise<WishlistPageOf<T>>,
  options: { max: number; onFirstPage?: (page: WishlistPageOf<T>) => void; active?: () => boolean }
): Promise<WishlistPageOf<T> | null> {
  const active = options.active ?? (() => true);
  const first = await fetchPage();
  if (!active()) return null;
  options.onFirstPage?.(first);
  const items = [...first.items];
  const seen = new Set(items.map((item) => item.id));
  let cursor = first.nextCursor;
  while (cursor !== null && items.length < options.max) {
    if (!active()) return null;
    let page: WishlistPageOf<T>;
    try {
      page = await fetchPage(cursor);
    } catch {
      break;
    }
    if (!active()) return null;
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    // Curseur qui n'avance pas : arrêt plutôt qu'une lecture sans fin.
    if (page.nextCursor === cursor) break;
    cursor = page.nextCursor;
  }
  return { items, nextCursor: cursor };
}

/** Page ajoutée au défilement (au-delà de `max`, ou après un échec) : sans doublon. */
export function appendPage<T extends { id: string }>(current: readonly T[], page: readonly T[]): T[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...page.filter((item) => !seen.has(item.id))];
}
