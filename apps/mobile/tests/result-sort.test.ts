import { describe, expect, it } from "vitest";
import type { MatchOrigin, ProductMatch, ProductSearch, SearchComplement } from "@monapp/shared-types";
import type { Piece, SpotResult } from "../src/api/types";
import { allPieces, type IndexedPiece } from "../src/lib/result-sections";
import { bestProposalIndex, priceFirstSections, startIndexOf, startProposalIndex, NO_CHOICE } from "../src/lib/price-first";
import { toSpotResult } from "../src/lib/spot-result";
import { afterShops, shopsOutcomeOf } from "../src/lib/spot-shops";
import { sanitizeProps } from "../src/lib/analytics-events";
import {
  bigCardShown,
  cheapestIndex,
  currencyGroups,
  currencyKey,
  DEFAULT_RESULT_VIEW,
  dominantCurrency,
  nothingWithPrice,
  parseResultView,
  PRICE_LIST_SHOWN_FIRST,
  priceListShown,
  priceSortedList,
  priceSummary,
  resultLayout,
  resultViewChangeProps,
  sectionsWithPriceOnly,
  serializeResultView,
  type ResultView,
} from "../src/lib/result-sort";

// Tri des résultats (2026-11-08) : « Pertinence » inchangé ; « Prix croissant »
// et « Prix décroissant » en une seule liste, dans la devise la plus fréquente,
// les autres devises ensuite, les propositions sans prix en dernier ; « Avec
// prix seulement » ; la ligne des prix et « Le moins cher ». Jamais deux
// devises comparées comme des nombres.
type Lists = Pick<SpotResult, "pieces" | "complement">;

/** Une proposition : identifiant, prix (null : sans prix), devise, origine. */
function piece(id: string, price: number | null, currency: string | null = "EUR", origin?: MatchOrigin): Piece {
  return {
    id,
    name: `Pièce ${id}`,
    reference: null,
    material: null,
    imageUrl: `https://boutique.test/${id}.jpg`,
    priceFrom: price,
    currency: price === null ? null : currency,
    merchantName: "Boutique",
    merchantUrl: `https://boutique.test/${id}`,
    affiliateUrl: `https://boutique.test/${id}`,
    real: true,
    ...(origin ? { origin } : {}),
  };
}

function lists(lens: Piece[], shopping: Piece[] = [], words: Piece[] = []): Lists {
  return {
    pieces: lens,
    complement: {
      shopping: shopping.map((p) => ({ ...p, origin: "shopping" as const })),
      words: words.map((p) => ({ ...p, origin: "words" as const })),
      status: "shown",
      query: null,
      suggestText: false,
      textStatus: null,
    },
  };
}

const ids = (items: readonly IndexedPiece[]) => items.map(({ piece: p }) => p.id);
const ASC = "price_asc" as const;
const DESC = "price_desc" as const;
const PRICE_ASC: ResultView = { sort: ASC, withPriceOnly: false };
const PRICE_DESC: ResultView = { sort: DESC, withPriceOnly: false };

// Lens : sans prix, 49 €, 120 €, sans prix, 35 € ; boutiques : 42 €, sans prix ; vos mots : 35 €.
const MIXED = lists([piece("l1", null), piece("l2", 49), piece("l3", 120), piece("l4", null), piece("l5", 35)], [piece("s1", 42), piece("s2", null)], [piece("w1", 35)]);

describe("tri par prix : une seule liste de toutes les propositions", () => {
  it("prix croissant : Lens, boutiques et vos mots mêlés ; à prix égal, l'ordre de la recherche ; sans prix en dernier", () => {
    expect(ids(priceSortedList(MIXED, ASC))).toEqual(["l5", "w1", "s1", "l2", "l3", "l1", "l4", "s2"]);
  });

  it("prix décroissant : du plus cher au moins cher ; à prix égal, toujours l'ordre de la recherche ; sans prix en dernier, dans leur ordre", () => {
    expect(ids(priceSortedList(MIXED, DESC))).toEqual(["l3", "l2", "s1", "l5", "w1", "l1", "l4", "s2"]);
  });

  it("toutes les propositions de l'écran, une seule fois, chacune avec son propre indice (ses boutons visent sa pièce)", () => {
    for (const sort of [ASC, DESC]) {
      const list = priceSortedList(MIXED, sort);
      expect(list).toHaveLength(allPieces(MIXED).length);
      expect(new Set(list.map(({ index }) => index)).size).toBe(list.length);
      for (const { piece: p, index } of list) expect(allPieces(MIXED)[index]).toBe(p);
    }
  });

  it("aucun prix nulle part : l'ordre de la recherche, rien de perdu", () => {
    const none = lists([piece("l1", null), piece("l2", null)], [piece("s1", null)]);
    expect(ids(priceSortedList(none, ASC))).toEqual(["l1", "l2", "s1"]);
    expect(ids(priceSortedList(none, DESC))).toEqual(["l1", "l2", "s1"]);
  });

  it("un prix à 0 (donnée douteuse, relecture ORD-8) ne passe jamais devant un vrai prix : après les prix, avant les sans prix", () => {
    const zero = lists([piece("l1", null), piece("l2", 0), piece("l3", 89), piece("l4", 12)]);
    expect(ids(priceSortedList(zero, ASC))).toEqual(["l4", "l3", "l2", "l1"]);
    expect(ids(priceSortedList(zero, DESC))).toEqual(["l3", "l4", "l2", "l1"]);
  });

  it("la proposition touchée dans la liste triée passe en grand et quitte la liste ; rien d'autre ne bouge", () => {
    const list = priceSortedList(MIXED, ASC);
    expect(ids(priceListShown(list, 1))).toEqual(["l5", "w1", "s1", "l3", "l1", "l4", "s2"]);
    expect(priceListShown(list, null)).toEqual(list);
  });

  it("au-delà de 20 lignes, un « Voir plus »", () => {
    expect(PRICE_LIST_SHOWN_FIRST).toBe(20);
  });
});

describe("devises : jamais comparées entre elles", () => {
  it("une même devise écrite de plusieurs façons (Lens : « € », Google Shopping : « EUR ») est une seule devise", () => {
    expect(currencyKey("€")).toBe("EUR");
    expect(currencyKey("EUR")).toBe("EUR");
    expect(currencyKey(" eur ")).toBe("EUR");
    // La base complète la devise par des espaces (« €  », char(3)).
    expect(currencyKey("€  ")).toBe("EUR");
    expect(currencyKey("£")).toBe("GBP");
    expect(currencyKey("$US")).toBe("USD");
    expect(currencyKey("US$")).toBe("USD");
    // La table unique des devises (packages/shared-types) : « $MX » est le peso mexicain, comme « MXN ».
    expect(currencyKey("$MX")).toBe("MXN");
    expect(currencyKey("MXN")).toBe("MXN");
    // Une écriture que la table ne connaît pas reste à part, jamais mêlée aux autres.
    expect(currencyKey("¥")).toBe("¥");
    expect(currencyKey(null)).toBeNull();
    expect(currencyKey("  ")).toBeNull();
  });

  it("« $ » seul n'est le dollar américain que pour une recherche aux États-Unis", () => {
    expect(currencyKey("$", "us")).toBe("USD");
    expect(currencyKey("$", "fr")).toBe("$");
    expect(currencyKey("$")).toBe("$");
  });

  it("devise dominante : la plus fréquente, symboles et codes réunis", () => {
    const result = lists([piece("l1", 38, "$US"), piece("l2", 30, "€"), piece("l3", 20, "$US")], [piece("s1", 45, "EUR"), piece("s2", 50, "EUR")]);
    expect(dominantCurrency(result, "fr")).toBe("EUR");
    expect(currencyGroups(allPieces(result).map((p, index) => ({ piece: p, index })), "fr").map((g) => [g.currency, ids(g.items)])).toEqual([
      ["EUR", ["l2", "s1", "s2"]],
      ["USD", ["l1", "l3"]],
    ]);
  });

  it("égalité : l'euro quand l'app est en français (recherche en France) ; en anglais, la devise du pays, sinon la première apparue", () => {
    const tie = lists([piece("l1", 38, "$US"), piece("l2", 30, "€")]);
    expect(dominantCurrency(tie, "fr")).toBe("EUR");
    expect(dominantCurrency(tie, "us")).toBe("USD");
    // Pays dont la devise n'est pas parmi les ex æquo : la première dans l'ordre de la recherche.
    expect(dominantCurrency(tie, "gb")).toBe("USD");
    expect(dominantCurrency(tie)).toBe("USD");
    // La plus fréquente l'emporte toujours sur la devise du pays.
    expect(dominantCurrency(lists([piece("l1", 38, "$US"), piece("l2", 30, "€"), piece("l3", 9, "$US")]), "fr")).toBe("USD");
  });

  it("aucun prix utilisable (sans prix, prix à 0, prix sans devise) : pas de devise dominante", () => {
    expect(dominantCurrency(lists([piece("l1", null), piece("l2", 0), { ...piece("l3", 25), currency: null }]), "fr")).toBeNull();
  });

  it("tri : la devise dominante d'abord, les autres ensuite, chacune triée à part (jamais 20 $US avant 30 €), sans prix en dernier", () => {
    const result = lists(
      [piece("l1", 38, "$US"), piece("l2", null), piece("l3", 30, "€"), piece("l4", 20, "$US"), piece("l5", 269, "$MX")],
      [piece("s1", 45, "EUR"), piece("s2", 25, "EUR")]
    );
    expect(ids(priceSortedList(result, ASC, { country: "fr" }))).toEqual(["s2", "l3", "s1", "l4", "l1", "l5", "l2"]);
    expect(ids(priceSortedList(result, DESC, { country: "fr" }))).toEqual(["s1", "l3", "s2", "l1", "l4", "l5", "l2"]);
  });

  it("un prix sans devise ne se compare à rien : avec les prix douteux, après les autres devises", () => {
    const result = lists([{ ...piece("l1", 15), currency: null }, piece("l2", 40), piece("l3", 30, "$US"), piece("l4", null)]);
    expect(ids(priceSortedList(result, ASC, { country: "fr" }))).toEqual(["l2", "l3", "l1", "l4"]);
  });
});

describe("« Avec prix seulement » : les propositions sans prix masquées, dans tous les modes", () => {
  it("tri par prix : plus aucune ligne sans prix ; les prix, toutes devises, restent", () => {
    const list = priceSortedList(MIXED, ASC, { withPriceOnly: true });
    expect(ids(list)).toEqual(["l5", "w1", "s1", "l2", "l3"]);
    const currencies = lists([piece("l1", 38, "$US"), piece("l2", null), piece("l3", 30)]);
    expect(ids(priceSortedList(currencies, DESC, { country: "fr", withPriceOnly: true }))).toEqual(["l3", "l1"]);
  });

  it("« Pertinence » : les mêmes sections, dans le même ordre, sans les propositions sans prix ; « Sans prix » disparaît", () => {
    const sections = priceFirstSections(MIXED, bestProposalIndex(MIXED, "fr"));
    expect(ids(sections.withoutPrice)).toEqual(["l1", "l4"]);
    const filtered = sectionsWithPriceOnly(sections);
    expect(ids(filtered.others)).toEqual(["l3", "l5"]);
    expect(ids(filtered.shopping)).toEqual(["s1"]);
    expect(ids(filtered.words)).toEqual(["w1"]);
    expect(filtered.withoutPrice).toEqual([]);
  });

  it("« Pertinence », aucun prix dans la recherche visuelle (rien de replié) : la section se vide", () => {
    const result = lists([piece("l1", null), piece("l2", null)], [piece("s1", null)]);
    const filtered = sectionsWithPriceOnly(priceFirstSections(result, 0));
    expect(filtered).toEqual({ others: [], shopping: [], words: [], withoutPrice: [] });
    expect(nothingWithPrice(result, { sort: "relevance", withPriceOnly: true })).toBe(true);
    expect(nothingWithPrice(result, DEFAULT_RESULT_VIEW)).toBe(false);
    expect(nothingWithPrice(MIXED, { sort: ASC, withPriceOnly: true })).toBe(false);
  });

  it("une grande carte sans prix est masquée (pas changée) ; avec prix, elle reste", () => {
    expect(bigCardShown({ sort: "relevance", withPriceOnly: true }, piece("l1", null), false)).toBe(false);
    expect(bigCardShown({ sort: "relevance", withPriceOnly: true }, piece("l1", 30), false)).toBe(true);
    expect(bigCardShown({ sort: ASC, withPriceOnly: true }, piece("l1", null), true)).toBe(false);
  });
});

describe("la ligne « N offres · à partir de X € » et « Le moins cher »", () => {
  it("les offres avec un prix dans la devise dominante, et la moins chère", () => {
    const summary = priceSummary(MIXED, "fr");
    expect(summary?.count).toBe(5);
    expect(summary?.cheapest.piece.id).toBe("l5");
    // À prix égal (l5 et w1 à 35 €) : la première de la recherche porte la pastille.
    expect(cheapestIndex(MIXED, "fr")).toBe(4);
  });

  it("autres devises : ni comptées, ni « moins chères » (20 $US n'est pas moins cher que 30 €)", () => {
    const result = lists([piece("l1", 20, "$US"), piece("l2", 30, "€"), piece("l3", 45)]);
    expect(priceSummary(result, "fr")).toMatchObject({ count: 2, cheapest: { index: 1 } });
    expect(cheapestIndex(result, "fr")).toBe(1);
  });

  it("aucun prix : ni ligne, ni pastille ; une seule offre : la ligne, sans pastille (rien à comparer) ; un prix à 0 ne compte pas", () => {
    expect(priceSummary(lists([piece("l1", null)]), "fr")).toBeNull();
    expect(cheapestIndex(lists([piece("l1", null)]), "fr")).toBeNull();
    expect(priceSummary(lists([piece("l1", null), piece("l2", 59)]), "fr")).toMatchObject({ count: 1, cheapest: { index: 1 } });
    expect(cheapestIndex(lists([piece("l1", null), piece("l2", 59)]), "fr")).toBeNull();
    expect(priceSummary(lists([piece("l1", 0), piece("l2", 59), piece("l3", 70)]), "fr")).toMatchObject({ count: 2, cheapest: { index: 1 } });
  });

  it("« Pertinence » : la pastille peut être sur la grande carte", () => {
    const result = lists([piece("l1", null), piece("l2", 19), piece("l3", 49)]);
    expect(cheapestIndex(result, "fr")).toBe(bestProposalIndex(result, "fr"));
    expect(resultLayout(result, DEFAULT_RESULT_VIEW, { selectedIndex: 1, pickedInPriceList: false, country: "fr" })).toMatchObject({ bigCard: 1, cheapest: 1 });
  });
});

// ---- Boutiques ensuite : boutiques arrivées après l'affichage ----

function match(id: string, rank: number, price: number | null, origin?: MatchOrigin, currency = "EUR"): ProductMatch {
  return {
    id,
    rank,
    productName: `Pièce ${id}`,
    brand: null,
    imageUrl: `https://boutique.test/${id}.jpg`,
    imageHdUrl: null,
    priceMin: price,
    priceMax: price,
    currency: price === null ? null : currency,
    merchantName: "Boutique",
    merchantUrl: `https://boutique.test/${id}`,
    affiliateUrl: `https://boutique.test/${id}`,
    feedbackReason: null,
    ...(origin ? { origin } : {}),
  };
}

const PENDING: SearchComplement = { status: null, suggestText: false, textStatus: null, pending: true };

function search(matches: ProductMatch[], complement: SearchComplement): ProductSearch {
  return {
    id: "s1",
    sourceUrl: null,
    sourcePlatform: "photo",
    method: "manual_screenshot",
    thumbnailUrl: null,
    status: "completed",
    errorMessage: null,
    query: null,
    createdAt: "2026-11-08T10:00:00.000Z",
    matches,
    complement,
  };
}

// Lens (devise écrite « € » par Google Lens) : sans prix, 59 €, sans prix, 89 € ; boutiques (« EUR ») : 45 €, 99 €, sans prix.
const LENS = [match("l1", 1, null), match("l2", 2, 59, undefined, "€"), match("l3", 3, null), match("l4", 4, 89, undefined, "€")];
const SHOPS = [match("s1", 5, 45, "shopping"), match("s2", 6, 99, "shopping"), match("s3", 7, null, "shopping")];
const launched = toSpotResult(search(LENS, PENDING));
const arrived = afterShops(launched, "s1", shopsOutcomeOf(search([...LENS, ...SHOPS], { status: "shown", query: "Exemplor veste", suggestText: false, textStatus: null })));

describe("boutiques ensuite : arrivées à leur place dans le tri, la grande carte ne change pas", () => {
  it("prix croissant : les boutiques prennent leur place ; la recherche visuelle garde son ordre relatif", () => {
    expect(ids(priceSortedList(launched, ASC, { country: "fr" }))).toEqual(["l2", "l4", "l1", "l3"]);
    expect(ids(priceSortedList(arrived, ASC, { country: "fr" }))).toEqual(["s1", "l2", "l4", "s2", "l1", "l3", "s3"]);
    expect(ids(priceSortedList(arrived, DESC, { country: "fr" }))).toEqual(["s2", "l4", "l2", "s1", "l1", "l3", "s3"]);
    // Les propositions déjà affichées gardent leur indice : leurs boutons visent la même pièce.
    allPieces(launched).forEach((p, index) => expect(allPieces(arrived)[index]?.id).toBe(p.id));
  });

  it("la ligne des prix et « Le moins cher » changent ; la grande carte, jamais", () => {
    expect(priceSummary(launched, "fr")).toMatchObject({ count: 2, cheapest: { piece: { id: "l2" } } });
    expect(priceSummary(arrived, "fr")).toMatchObject({ count: 4, cheapest: { piece: { id: "s1" } } });
    expect(allPieces(arrived)[cheapestIndex(arrived, "fr")!]?.id).toBe("s1");
    const start = startProposalIndex(launched, { country: "fr" });
    expect(startProposalIndex(arrived, { country: "fr" })).toBe(start);
    expect(allPieces(arrived)[start]?.id).toBe("l2");
  });

  it("« Pertinence » : même grande carte, même disposition au-dessus des boutiques, avant et après leur arrivée", () => {
    const country = "fr";
    const before = resultLayout(launched, DEFAULT_RESULT_VIEW, { selectedIndex: startIndexOf(NO_CHOICE, launched, { country }), pickedInPriceList: false, country });
    const after = resultLayout(arrived, DEFAULT_RESULT_VIEW, { selectedIndex: startIndexOf(NO_CHOICE, arrived, { country }), pickedInPriceList: false, country });
    expect(after.bigCard).toBe(before.bigCard);
    expect(allPieces(arrived)[after.bigCard!]?.id).toBe(allPieces(launched)[before.bigCard!]?.id);
    expect(ids(after.sections.others)).toEqual(ids(before.sections.others));
    expect(ids(after.sections.withoutPrice)).toEqual(ids(before.sections.withoutPrice));
    expect(ids(after.sections.shopping)).toEqual(["s1", "s2", "s3"]);
    // Seules la ligne des prix et la pastille ont changé.
    expect([before.cheapest, after.cheapest]).toEqual([1, 4]);
  });

  it("tri par prix retenu sur l'appareil : pas de grande carte avant ni après ; celle d'office reste la même pour « Pertinence »", () => {
    const country = "fr";
    for (const result of [launched, arrived]) {
      const layout = resultLayout(result, PRICE_ASC, { selectedIndex: startIndexOf(NO_CHOICE, result, { country }), pickedInPriceList: false, country });
      expect(layout.bigCard).toBeNull();
      expect(layout.priceList).toHaveLength(allPieces(result).length);
    }
  });

  it("aucun prix dans la recherche visuelle : la grande carte reste la 1re pièce Lens, la boutique avec prix devient « la moins chère »", () => {
    const lens = [match("l1", 1, null), match("l2", 2, null)];
    const before = toSpotResult(search(lens, PENDING));
    const after = afterShops(before, "s1", shopsOutcomeOf(search([...lens, match("s1", 3, 40, "shopping"), match("s2", 4, 55, "shopping")], { status: "shown", suggestText: false, textStatus: null })));
    const layout = resultLayout(after, DEFAULT_RESULT_VIEW, { selectedIndex: startIndexOf(NO_CHOICE, after, { country: "fr" }), pickedInPriceList: false, country: "fr" });
    expect(layout.bigCard).toBe(0);
    expect(allPieces(after)[layout.cheapest!]?.id).toBe("s1");
    expect(ids(priceSortedList(after, ASC, { country: "fr" }))).toEqual(["s1", "s2", "l1", "l2"]);
  });
});

describe("le contrôle de tri change la disposition de l'écran", () => {
  const options = { selectedIndex: bestProposalIndex(MIXED, "fr"), pickedInPriceList: false, country: "fr" };

  it("« Pertinence » (par défaut) : exactement l'écran d'avant — même grande carte, mêmes sections, aucune liste triée", () => {
    const layout = resultLayout(MIXED, DEFAULT_RESULT_VIEW, options);
    expect(layout.bigCard).toBe(options.selectedIndex);
    expect(layout.sections).toEqual(priceFirstSections(MIXED, options.selectedIndex));
    expect(layout.priceList).toBeNull();
    // Mêmes sections que price-first pour toute grande carte, résultat sans complément compris.
    for (const result of [MIXED, { pieces: [piece("l1", null), piece("l2", 30)] }, lists([piece("l1", null)], [piece("s1", 25)])]) {
      for (const [index] of allPieces(result).entries()) {
        expect(resultLayout(result, DEFAULT_RESULT_VIEW, { selectedIndex: index, pickedInPriceList: false, country: "fr" }).sections).toEqual(priceFirstSections(result, index));
      }
    }
  });

  it("« Prix croissant » puis « Prix décroissant » : plus de grande carte ni de section, une seule liste triée", () => {
    const asc = resultLayout(MIXED, PRICE_ASC, options);
    expect(asc.bigCard).toBeNull();
    expect(ids(asc.priceList!)).toEqual(ids(priceSortedList(MIXED, ASC, { country: "fr" })));
    const desc = resultLayout(MIXED, PRICE_DESC, options);
    expect(ids(desc.priceList!)).toEqual(["l3", "l2", "s1", "l5", "w1", "l1", "l4", "s2"]);
  });

  it("une carte touchée dans la liste triée passe en grand (ses boutons visent sa pièce) et quitte la liste", () => {
    const picked = resultLayout(MIXED, PRICE_ASC, { ...options, selectedIndex: 5, pickedInPriceList: true });
    expect(picked.bigCard).toBe(5);
    expect(allPieces(MIXED)[5]?.id).toBe("s1");
    expect(ids(picked.priceList!)).not.toContain("s1");
    expect(picked.priceList).toHaveLength(allPieces(MIXED).length - 1);
  });

  it("retour à « Pertinence » : sans geste, la grande carte d'avant le tri ; après une carte touchée dans la liste, celle-ci (geste retenu)", () => {
    expect(resultLayout(MIXED, DEFAULT_RESULT_VIEW, options).bigCard).toBe(1);
    const held = resultLayout(MIXED, DEFAULT_RESULT_VIEW, { ...options, selectedIndex: 5, pickedInPriceList: false });
    expect(held.bigCard).toBe(5);
    expect(ids(held.sections.shopping)).toEqual(["s2"]);
  });

  it("« Avec prix seulement » retiré : une grande carte sans prix masquée revient, la même", () => {
    const filtered = resultLayout(MIXED, { sort: "relevance", withPriceOnly: true }, { ...options, selectedIndex: 0 });
    expect(filtered.bigCard).toBeNull();
    expect(resultLayout(MIXED, DEFAULT_RESULT_VIEW, { ...options, selectedIndex: 0 }).bigCard).toBe(0);
  });
});

describe("choix gardé sur l'appareil", () => {
  it("relu tel qu'enregistré ; illisible, inconnu ou absent : « Pertinence » sans filtre", () => {
    const view: ResultView = { sort: "price_desc", withPriceOnly: true };
    expect(parseResultView(serializeResultView(view))).toEqual(view);
    expect(parseResultView(null)).toEqual(DEFAULT_RESULT_VIEW);
    expect(parseResultView("{pas du json")).toEqual(DEFAULT_RESULT_VIEW);
    expect(parseResultView("null")).toEqual(DEFAULT_RESULT_VIEW);
    expect(parseResultView(JSON.stringify({ sort: "alphabetique", withPriceOnly: "oui" }))).toEqual(DEFAULT_RESULT_VIEW);
    expect(parseResultView(JSON.stringify({ sort: "price_asc" }))).toEqual({ sort: "price_asc", withPriceOnly: false });
    expect(DEFAULT_RESULT_VIEW).toEqual({ sort: "relevance", withPriceOnly: false });
  });
});

describe("statistiques : un événement à valeurs fermées", () => {
  it("le nouveau tri ou filtre et ce qui a changé ; rien si rien n'a changé", () => {
    expect(resultViewChangeProps(DEFAULT_RESULT_VIEW, PRICE_ASC)).toEqual({ sort: "price_asc", with_price_only: false, change: "sort" });
    expect(resultViewChangeProps(PRICE_ASC, { sort: "price_asc", withPriceOnly: true })).toEqual({ sort: "price_asc", with_price_only: true, change: "filter" });
    expect(resultViewChangeProps(PRICE_ASC, PRICE_ASC)).toBeNull();
  });

  it("result_view_changed : aucune autre valeur ni aucun texte libre ne passe", () => {
    expect(sanitizeProps("result_view_changed", { sort: "price_desc", with_price_only: true, change: "sort" })).toEqual({ sort: "price_desc", with_price_only: true, change: "sort" });
    expect(sanitizeProps("result_view_changed", { sort: "veste en daim", with_price_only: "oui", change: "autre", query: "veste" })).toEqual({});
  });
});
