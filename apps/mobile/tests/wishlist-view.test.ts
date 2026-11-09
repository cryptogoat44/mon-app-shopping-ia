import { afterEach, describe, expect, it } from "vitest";
import type { WishlistItem } from "../src/api/types";
import { setActiveLocale } from "../src/i18n";
import { sanitizeProps } from "../src/lib/analytics-events";
import {
  appendPage,
  DEFAULT_WISHLIST_SORT,
  loadAllPages,
  matchesSearch,
  parseWishlistSort,
  readWishlistSort,
  saveWishlistSort,
  searchKey,
  searchWishlist,
  sortWishlist,
  WISHLIST_SORT_STORAGE_KEY,
  wishlistScope,
  wishlistSortChangeProps,
  wishlistTotal,
  wishlistTotalText,
  wishlistView,
  type WishlistPageOf,
} from "../src/lib/wishlist-view";

// Écran Envies (2026-11-09) : recherche sans accents ni majuscules, tri par
// prix avec les règles de devises des résultats (lib/result-sort.ts), total
// dans la devise la plus fréquente, collection et recherche ensemble, tri
// gardé sur l'appareil, et lecture de toutes les pages.

afterEach(() => setActiveLocale("fr"));

/** Une envie : identifiant, nom, boutique, prix (null : sans prix), devise. */
function wish(id: string, name: string, price: number | null, currency: string | null = "EUR", merchantName: string | null = "Boutique"): WishlistItem {
  return {
    id,
    name,
    reference: null,
    material: null,
    imageUrl: `https://boutique.test/${id}.jpg`,
    priceFrom: price,
    currency: price === null ? null : currency,
    merchantName,
    merchantUrl: `https://boutique.test/${id}`,
    affiliateUrl: `https://boutique.test/${id}`,
    real: true,
    addedAt: "2026-11-09T10:00:00.000000+00:00",
    productMatchId: null,
  };
}

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);
// Espaces insécables des nombres et devises (Intl) : remplacés pour comparer.
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

describe("recherche : nom et boutique, sans majuscules ni accents", () => {
  const items = [
    wish("a", "Veste en daim", 120, "EUR", "Zara"),
    wish("b", "Robe d'été fleurie", 59, "EUR", "Sézane"),
    wish("c", "Cœur en or", 340, "EUR", "Maison Lœwe"),
    wish("d", "Sac cabas", null, null, null),
  ];

  it("texte comparable : minuscules, accents et ligatures retirés, espaces réduits", () => {
    expect(searchKey("  ÉTÉ   Sézane ")).toBe("ete sezane");
    expect(searchKey("Cœur")).toBe("coeur");
    expect(searchKey("L’Été")).toBe("l'ete");
    expect(searchKey(null)).toBe("");
  });

  it("accents et majuscules indifférents, dans les deux sens", () => {
    expect(ids(searchWishlist(items, "ETE"))).toEqual(["b"]);
    expect(ids(searchWishlist(items, "sezane"))).toEqual(["b"]);
    expect(ids(searchWishlist(items, "Sézane"))).toEqual(["b"]);
    expect(ids(searchWishlist(items, "coeur"))).toEqual(["c"]);
    expect(ids(searchWishlist(items, "LOEWE"))).toEqual(["c"]);
  });

  it("le nom ou la boutique ; chaque mot tapé doit s'y trouver", () => {
    expect(ids(searchWishlist(items, "zara"))).toEqual(["a"]);
    expect(ids(searchWishlist(items, "veste zara"))).toEqual(["a"]);
    expect(ids(searchWishlist(items, "veste sezane"))).toEqual([]);
    expect(matchesSearch(items[3]!, "cabas")).toBe(true);
    expect(matchesSearch(items[3]!, "boutique")).toBe(false);
  });

  it("recherche vide ou faite d'espaces : toutes les envies, dans le même ordre", () => {
    expect(ids(searchWishlist(items, ""))).toEqual(["a", "b", "c", "d"]);
    expect(ids(searchWishlist(items, "   "))).toEqual(["a", "b", "c", "d"]);
  });
});

describe("tri par prix : mêmes règles de devises que les résultats", () => {
  // Ordre récent : a (le plus récent) … h.
  const items = [
    wish("a", "A", 80),
    wish("b", "B", null),
    wish("c", "C", 30, "USD"),
    wish("d", "D", 0),
    wish("e", "E", 20, "€"),
    wish("f", "F", 50),
    wish("g", "G", 10, "USD"),
    wish("h", "H", null),
  ];

  it("« Récentes » : l'ordre d'aujourd'hui, inchangé", () => {
    expect(ids(sortWishlist(items, "recent"))).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });

  it("« Prix croissant » : la devise la plus fréquente d'abord (« € » et « EUR » ensemble), les autres ensuite, 0 € puis sans prix à la fin, dans l'ordre récent", () => {
    expect(ids(sortWishlist(items, "price_asc", "fr"))).toEqual(["e", "f", "a", "g", "c", "d", "b", "h"]);
  });

  it("« Prix décroissant » : un prix à 0 n'est jamais en tête, les envies sans prix restent en dernier", () => {
    expect(ids(sortWishlist(items, "price_desc", "fr"))).toEqual(["a", "f", "e", "c", "g", "d", "b", "h"]);
  });

  it("deux devises ne sont jamais comparées comme des nombres", () => {
    const sorted = ids(sortWishlist([wish("eur", "E", 100), wish("usd", "U", 5, "USD"), wish("eur2", "E2", 200)], "price_asc", "fr"));
    expect(sorted).toEqual(["eur", "eur2", "usd"]);
  });

  it("« $ » seul : le dollar américain pour l'app en anglais aux États-Unis, à part ailleurs", () => {
    const dollars = [wish("a", "A", 30, "$"), wish("b", "B", 10, "USD"), wish("c", "C", 20, "USD")];
    expect(ids(sortWishlist(dollars, "price_asc", "us"))).toEqual(["b", "c", "a"]);
    expect(ids(sortWishlist(dollars, "price_asc", "fr"))).toEqual(["b", "c", "a"]);
    expect(wishlistTotal(dollars, "us")).toMatchObject({ currency: "USD", amount: 60, counted: 3, otherCurrency: 0 });
    expect(wishlistTotal(dollars, "fr")).toMatchObject({ currency: "USD", amount: 30, counted: 2, otherCurrency: 1 });
  });

  it("à prix égal, l'ordre récent décide", () => {
    expect(ids(sortWishlist([wish("x", "X", 40), wish("y", "Y", 40), wish("z", "Z", 10)], "price_desc", "fr"))).toEqual(["x", "y", "z"]);
  });
});

describe("total : la devise la plus fréquente seulement", () => {
  it("devises mélangées et envies sans prix : jamais additionnées, comptées à part", () => {
    const items = [wish("a", "A", 1000), wish("b", "B", 249), wish("c", "C", 99, "USD"), wish("d", "D", null), wish("e", "E", 0), wish("f", "F", 19.99)];
    expect(wishlistTotal(items, "fr")).toEqual({ count: 6, currency: "EUR", amount: 1268.99, counted: 3, otherCurrency: 1, withoutPrice: 2 });
    expect(plain(wishlistTotalText(wishlistTotal(items, "fr"), "all", "fr").text)).toBe("6 envies · total 1 268,99 € + 1 dans une autre devise + 2 sans prix");
  });

  it("au centime près, sans erreur d'arrondi", () => {
    expect(wishlistTotal([wish("a", "A", 0.1), wish("b", "B", 0.2)]).amount).toBe(0.3);
    expect(wishlistTotal([wish("a", "A", 19.99), wish("b", "B", 5.01)]).amount).toBe(25);
  });

  it("à égalité, la devise du pays (l'euro en français), sinon la plus récente", () => {
    const tie = [wish("a", "A", 10, "USD"), wish("b", "B", 20, "EUR")];
    expect(wishlistTotal(tie, "fr").currency).toBe("EUR");
    expect(wishlistTotal(tie, "us").currency).toBe("USD");
    expect(wishlistTotal(tie, "de").currency).toBe("USD");
  });

  it("« 12 envies · total 1 249 € » ; « + 2 sans prix » ; aucune envie avec un prix", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => wish(`w${i}`, `W${i}`, i === 0 ? 149 : 100));
    expect(plain(wishlistTotalText(wishlistTotal(twelve), "all", "fr").text)).toBe("12 envies · total 1 249 €");
    const withMissing = [...twelve.slice(0, 10), wish("n1", "N1", null), wish("n2", "N2", null)];
    expect(plain(wishlistTotalText(wishlistTotal(withMissing), "all", "fr").text)).toBe("12 envies · total 1 049 € + 2 sans prix");
    const none = [wish("n1", "N1", null), wish("n2", "N2", 0)];
    expect(wishlistTotal(none)).toMatchObject({ currency: null, amount: 0, counted: 0, withoutPrice: 2 });
    expect(wishlistTotalText(wishlistTotal(none), "all", "fr").text).toBe("2 envies · aucun prix indiqué");
  });

  it("une collection : ce qu'elle coûterait ; une recherche : les envies trouvées ; singulier", () => {
    const one = wishlistTotal([wish("a", "A", 120)]);
    expect(plain(wishlistTotalText(one, "collection", "fr").text)).toBe("1 envie dans cette collection · total 120 €");
    expect(plain(wishlistTotalText(one, "search", "fr").text)).toBe("1 envie trouvée · total 120 €");
    const two = wishlistTotal([wish("a", "A", 120), wish("b", "B", 30, "GBP"), wish("c", "C", 40, "CHF")]);
    expect(plain(wishlistTotalText(two, "search", "fr").text)).toBe("3 envies trouvées · total 120 € + 2 dans d'autres devises");
  });

  it("en anglais, et lue par VoiceOver avec des virgules", () => {
    setActiveLocale("en");
    const items = [wish("a", "A", 1000), wish("b", "B", 249), wish("c", "C", 99, "USD"), wish("d", "D", null)];
    const line = wishlistTotalText(wishlistTotal(items, "fr"), "collection", "en");
    expect(line.text).toBe("4 wishes in this collection · total €1,249 + 1 in another currency + 1 without a price");
    expect(line.label).toBe("4 wishes in this collection, total €1,249 + 1 in another currency + 1 without a price");
    expect(wishlistTotalText(wishlistTotal([wish("a", "A", null)]), "search", "en").text).toBe("1 wish found · no price given");
  });
});

describe("collection et recherche ensemble", () => {
  // Les envies de la collection choisie (lues pour sa puce), dans l'ordre récent.
  const collection = [
    wish("a", "Veste en daim", 120, "EUR", "Zara"),
    wish("b", "Veste légère", 80, "EUR", "Sézane"),
    wish("c", "Veste vintage", 45, "GBP", "Depop"),
    wish("d", "Veste à capuche", null, null, "Zara"),
    wish("e", "Pull col roulé", 60, "EUR", "Zara"),
  ];

  it("la recherche filtre la collection, le tri ordonne, le total porte sur les envies trouvées", () => {
    const view = wishlistView(collection, { query: "VESTE", sort: "price_asc", country: "fr" });
    expect(ids(view.visible)).toEqual(["b", "a", "c", "d"]);
    expect(view.total).toEqual({ count: 4, currency: "EUR", amount: 200, counted: 2, otherCurrency: 1, withoutPrice: 1 });
    expect(plain(wishlistTotalText(view.total, wishlistScope("VESTE", true), "fr").text)).toBe("4 envies trouvées · total 200 € + 1 dans une autre devise + 1 sans prix");
  });

  it("une boutique dans la collection ; sans recherche, toute la collection", () => {
    expect(ids(wishlistView(collection, { query: "zara", sort: "price_desc", country: "fr" }).visible)).toEqual(["a", "e", "d"]);
    const all = wishlistView(collection, { query: "", sort: "recent", country: "fr" });
    expect(ids(all.visible)).toEqual(["a", "b", "c", "d", "e"]);
    expect(all.total).toMatchObject({ amount: 260, counted: 3 });
    expect(wishlistScope("", true)).toBe("collection");
    expect(wishlistScope("  ", false)).toBe("all");
    expect(wishlistScope("zara", false)).toBe("search");
  });

  it("la devise du total ne dépend jamais du tri choisi", () => {
    const mixed = [wish("u1", "U1", 5, "USD"), wish("e1", "E1", 50), wish("u2", "U2", 7, "USD"), wish("e2", "E2", 70)];
    for (const sort of ["recent", "price_asc", "price_desc"] as const) {
      expect(wishlistView(mixed, { query: "", sort, country: "de" }).total.currency).toBe("USD");
    }
  });

  it("recherche sans résultat : rien d'affiché, total à zéro", () => {
    const view = wishlistView(collection, { query: "chaussures", sort: "recent" });
    expect(view.visible).toEqual([]);
    expect(view.total).toMatchObject({ count: 0, currency: null });
  });
});

describe("tri gardé sur l'appareil", () => {
  it("valeur illisible ou inconnue : « Récentes »", () => {
    expect(DEFAULT_WISHLIST_SORT).toBe("recent");
    expect(parseWishlistSort("price_desc")).toBe("price_desc");
    for (const raw of [null, undefined, "", "relevance", "prix", 3, { sort: "price_asc" }]) {
      expect(parseWishlistSort(raw)).toBe("recent");
    }
  });

  it("lecture : la valeur gardée ; stockage vide, refusé ou en panne : « Récentes »", async () => {
    const keys: string[] = [];
    expect(
      await readWishlistSort(async (key) => {
        keys.push(key);
        return "price_asc";
      })
    ).toBe("price_asc");
    expect(keys).toEqual([WISHLIST_SORT_STORAGE_KEY]);
    expect(await readWishlistSort(async () => null)).toBe("recent");
    expect(await readWishlistSort(() => Promise.reject(new Error("navigation privée")))).toBe("recent");
    expect(
      await readWishlistSort(() => {
        throw new Error("stockage indisponible");
      })
    ).toBe("recent");
  });

  it("écriture : sous sa clé ; refusée, sans erreur (le choix vaut pour la session)", async () => {
    const written: [string, string][] = [];
    await saveWishlistSort(async (key, value) => {
      written.push([key, value]);
    }, "price_desc");
    expect(written).toEqual([["spotto.tri-envies", "price_desc"]]);
    await expect(saveWishlistSort(() => Promise.reject(new Error("quota")), "price_asc")).resolves.toBeUndefined();
    await expect(
      saveWishlistSort(() => {
        throw new Error("stockage indisponible");
      }, "price_asc")
    ).resolves.toBeUndefined();
  });

  it("statistiques : le nouveau tri et la collection, jamais la recherche ; rien si le tri ne change pas", () => {
    expect(wishlistSortChangeProps("recent", "price_asc", true)).toEqual({ sort: "price_asc", in_collection: true });
    expect(wishlistSortChangeProps("price_asc", "price_asc", false)).toBeNull();
    expect(sanitizeProps("wishlist_sort_changed", { sort: "price_desc", in_collection: false })).toEqual({ sort: "price_desc", in_collection: false });
    expect(sanitizeProps("wishlist_sort_changed", { sort: "veste en daim", in_collection: "oui", query: "veste" })).toEqual({});
  });
});

describe("toutes les pages lues, pour une recherche, un tri et un total honnêtes", () => {
  /** Une liste de `count` envies servie par pages de `size`, curseur = identifiant. */
  function pages(count: number, size = 24, failAt?: string) {
    const all = Array.from({ length: count }, (_, i) => wish(`w${i}`, `W${i}`, 10));
    const calls: (string | undefined)[] = [];
    const fetchPage = async (cursor?: string): Promise<WishlistPageOf<WishlistItem>> => {
      calls.push(cursor);
      if (cursor !== undefined && cursor === failAt) throw new Error("réseau");
      const start = cursor === undefined ? 0 : all.findIndex((item) => item.id === cursor) + 1;
      const items = all.slice(start, start + size);
      return { items, nextCursor: start + size < all.length ? items.at(-1)!.id : null };
    };
    return { fetchPage, calls };
  }

  it("toutes les pages, la première remise tout de suite", async () => {
    const { fetchPage, calls } = pages(100);
    const first: number[] = [];
    const result = await loadAllPages(fetchPage, { max: 500, onFirstPage: (page) => first.push(page.items.length) });
    expect(result?.items).toHaveLength(100);
    expect(result?.nextCursor).toBeNull();
    expect(first).toEqual([24]);
    expect(calls).toEqual([undefined, "w23", "w47", "w71", "w95"]);
  });

  it("au-delà du plafond : arrêt, avec le curseur de la suite (l'écran dit « sur les N chargées »)", async () => {
    const { fetchPage } = pages(60, 24);
    const result = await loadAllPages(fetchPage, { max: 30 });
    expect(result?.items).toHaveLength(48);
    expect(result?.nextCursor).toBe("w47");
  });

  it("une page suivante en échec : ce qui est lu, et le curseur de la page manquante", async () => {
    const { fetchPage } = pages(60, 24, "w23");
    const result = await loadAllPages(fetchPage, { max: 500 });
    expect(result).toEqual({ items: expect.any(Array), nextCursor: "w23" });
    expect(result?.items).toHaveLength(24);
  });

  it("la première page en échec : l'erreur remonte (l'écran l'affiche, comme avant)", async () => {
    await expect(loadAllPages(() => Promise.reject(new Error("réseau")), { max: 500 })).rejects.toThrow("réseau");
  });

  it("lecture abandonnée (autre puce choisie) : rien n'est rendu, plus aucune page demandée", async () => {
    const { fetchPage, calls } = pages(100);
    let active = true;
    const result = await loadAllPages(fetchPage, {
      max: 500,
      active: () => active,
      onFirstPage: () => {
        active = false;
      },
    });
    expect(result).toBeNull();
    expect(calls).toEqual([undefined]);
  });

  it("jamais deux fois la même envie ; un curseur qui n'avance pas arrête la lecture", async () => {
    const a = wish("a", "A", 1);
    const b = wish("b", "B", 2);
    let call = 0;
    const result = await loadAllPages(async () => (call++ === 0 ? { items: [a, b], nextCursor: "x" } : { items: [b], nextCursor: "x" }), { max: 500 });
    expect(ids(result!.items)).toEqual(["a", "b"]);
    expect(call).toBe(2);
    expect(ids(appendPage([a], [a, b]))).toEqual(["a", "b"]);
  });
});
