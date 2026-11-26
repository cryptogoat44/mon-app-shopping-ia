import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MatchOrigin, ProductMatch } from "@monapp/shared-types";
import type { Piece, SpotResult } from "../src/api/types";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { sanitizeProps } from "../src/lib/analytics-events";
import { matchToPiece } from "../src/lib/spot-result";
import { bestProposalIndex, bigCardLabel, firstAvailableIndex, isSoldOut, priceFirstSections, wordsSortNote } from "../src/lib/price-first";
import {
  bigCardShown,
  DEFAULT_RESULT_VIEW,
  nothingWithFilters,
  parseResultView,
  priceSortedList,
  priceSummary,
  resultLayout,
  resultViewChangeProps,
  serializeResultView,
  stockFilterShown,
  type ResultView,
} from "../src/lib/result-sort";
import type { IndexedPiece } from "../src/lib/result-sections";

// Stock affiché (lot « stock visible ») : « En stock » ou « Épuisée » quand
// Google le disait au moment de la recherche (serveur, migration 0056), rien
// quand c'est inconnu ; le filtre « En stock seulement » retire les offres
// épuisées et garde les inconnues ; une offre épuisée n'est jamais la grande
// carte d'office (« Meilleure proposition ») quand une autre existe.
type Lists = Pick<SpotResult, "pieces" | "complement">;

/** Une proposition : identifiant, prix (null : sans prix), stock (undefined : inconnu). */
function piece(id: string, price: number | null, inStock?: boolean, origin?: MatchOrigin): Piece {
  return {
    id,
    name: `Pièce ${id}`,
    reference: null,
    material: null,
    imageUrl: `https://boutique.test/${id}.jpg`,
    priceFrom: price,
    currency: price === null ? null : "EUR",
    merchantName: "Boutique",
    merchantUrl: `https://boutique.test/${id}`,
    affiliateUrl: `https://boutique.test/${id}`,
    real: true,
    ...(origin ? { origin } : {}),
    ...(inStock === undefined ? {} : { inStock }),
  };
}

function lists(lens: Piece[], shopping: Piece[] = []): Lists {
  return {
    pieces: lens,
    complement: { shopping: shopping.map((p) => ({ ...p, origin: "shopping" as const })), words: [], status: "shown", query: null, suggestText: false, textStatus: null },
  };
}

const ids = (items: readonly IndexedPiece[]) => items.map(({ piece: p }) => p.id);
const STOCK_ONLY: ResultView = { sort: "relevance", withPriceOnly: false, inStockOnly: true };
const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

const match = (extra: Record<string, unknown>): ProductMatch =>
  ({
    id: "m1",
    rank: 1,
    productName: "Veste",
    brand: null,
    imageUrl: "https://boutique.test/m1.jpg",
    imageHdUrl: null,
    priceMin: 49,
    priceMax: 49,
    currency: "EUR",
    merchantName: "Boutique",
    merchantUrl: "https://boutique.test/m1",
    affiliateUrl: "https://boutique.test/m1",
    feedbackReason: null,
    ...extra,
  }) as ProductMatch;

describe("la réponse du serveur : seulement un vrai oui ou non", () => {
  it("permis : en stock et épuisée sont gardés sur la pièce", () => {
    expect(matchToPiece(match({ inStock: true })).inStock).toBe(true);
    expect(matchToPiece(match({ inStock: false })).inStock).toBe(false);
  });

  it("refusé : absent (ancien serveur, inconnu) ou autre chose qu'un oui / non — rien sur la pièce", () => {
    for (const value of [undefined, null, "yes", 1]) expect("inStock" in matchToPiece(match({ inStock: value })), String(value)).toBe(false);
  });
});

describe("la grande carte d'office : jamais une offre épuisée quand une autre existe", () => {
  it("permis : la première avec prix est épuisée — la suivante avec prix, pas épuisée, passe en grand, et c'est elle la « Meilleure proposition »", () => {
    const result = lists([piece("l1", 30, false), piece("l2", 40), piece("l3", 50, true)]);
    const best = bestProposalIndex(result, "fr");
    expect(best).toBe(1);
    expect(firstAvailableIndex(result)).toBe(1);
    expect(bigCardLabel(best, best, firstAvailableIndex(result))).toBe("best");
    // Touchée par la personne, l'offre épuisée passe en grand, mais n'est pas « Meilleure proposition ».
    expect(bigCardLabel(0, best, firstAvailableIndex(result))).toBe("other");
    // Elle garde sa place dans sa section.
    expect(ids(priceFirstSections(result, best).others)).toEqual(["l1", "l3"]);
  });

  it("permis : aucune offre avec prix n'est disponible — la première non épuisée, même sans prix ou dans les boutiques", () => {
    expect(bestProposalIndex(lists([piece("l1", 30, false), piece("l2", null)]), "fr")).toBe(1);
    expect(bestProposalIndex(lists([piece("l1", 30, false)], [piece("s1", 20)]), "fr")).toBe(1);
    expect(bestProposalIndex({ ...lists([piece("l1", 30, false), piece("l2", null)]), complement: { ...lists([]).complement!, late: true } }, "fr")).toBe(1);
  });

  it("refusé : sans stock connu, ou quand tout est épuisé, rien ne change — la grande carte et son libellé sont ceux d'avant", () => {
    const unknown = lists([piece("l1", 30), piece("l2", 40)]);
    expect(bestProposalIndex(unknown, "fr")).toBe(0);
    expect(firstAvailableIndex(unknown)).toBe(0);
    expect(bigCardLabel(0, 0, firstAvailableIndex(unknown))).toBe("best");
    const allSoldOut = lists([piece("l1", 30, false), piece("l2", 40, false)]);
    expect(bestProposalIndex(allSoldOut, "fr")).toBe(0);
    expect(bigCardLabel(0, 0, firstAvailableIndex(allSoldOut))).toBe("best");
    // Une offre en stock n'est pas mise devant une mieux classée au stock inconnu : rien n'est favorisé.
    expect(bestProposalIndex(lists([piece("l1", 30), piece("l2", 40, true)]), "fr")).toBe(0);
  });
});

describe("tout est épuisé dans la recherche visuelle : l'ordre reçu, jamais l'ordre affiché des boutiques (aucune marque mise en avant)", () => {
  /** Une boutique du complément, avec son rang reçu de Google. */
  const shop = (id: string, price: number | null, rank: number, extra: Partial<Piece> = {}): Piece => ({ ...piece(id, price), rank, ...extra });

  it("refusé : la boutique de la marque, remontée en tête de « Cette pièce dans d'autres boutiques », n'est ni la grande carte d'office ni « Meilleure proposition »", () => {
    // Affichée en premier : la boutique de la marque (rang 12) ; reçue en premier : s1 (rang 11), sans prix.
    const noPrice = lists([piece("l1", 30, false), piece("l2", 40, false)], [shop("brand", null, 12, { offerMark: "official_shop" }), shop("s1", null, 11)]);
    expect(bestProposalIndex(noPrice, "fr")).toBe(3);
    expect(firstAvailableIndex(noPrice)).toBe(3);
    expect(bigCardLabel(2, bestProposalIndex(noPrice, "fr"), firstAvailableIndex(noPrice), noPrice.complement!.shopping[0])).toBe("other");
    // s1 a un prix : la grande carte d'office ; touchée, la boutique de la marque reste « Autre proposition ».
    const priced = lists([piece("l1", 30, false)], [shop("brand", 50, 12, { offerMark: "official_shop" }), shop("s1", 40, 11)]);
    const best = bestProposalIndex(priced, "fr");
    expect(best).toBe(2);
    expect(bigCardLabel(1, best, firstAvailableIndex(priced), priced.complement!.shopping[0])).toBe("other");
    expect(bigCardLabel(best, best, firstAvailableIndex(priced), priced.complement!.shopping[1])).toBe("best");
  });

  it("permis : sans stock connu, ou une offre visuelle disponible, rien ne change ; la première reçue épuisée : la première de l'écran, comme avant", () => {
    expect(firstAvailableIndex(lists([piece("l1", 30)], [shop("brand", 50, 12), shop("s1", 40, 11)]))).toBe(0);
    expect(firstAvailableIndex(lists([piece("l1", 30, false), piece("l2", null)], [shop("brand", 50, 12)]))).toBe(1);
    expect(firstAvailableIndex(lists([piece("l1", 30, false)], [shop("brand", 50, 12), shop("s1", 40, 11, { inStock: false })]))).toBe(0);
  });

  it("refusé : boutiques arrivées après le premier affichage — la grande carte épuisée sans prix n'est jamais « … avec prix »", () => {
    const late = { ...lists([piece("l1", null, false)], [piece("s1", 30)]), complement: { ...lists([], [piece("s1", 30)]).complement!, late: true } };
    const best = bestProposalIndex(late, "fr");
    expect(best).toBe(0);
    expect(firstAvailableIndex(late)).toBe(0);
    expect(bigCardLabel(best, best, firstAvailableIndex(late), late.pieces[0])).toBe("best");
    // Même hors de ce cas, « … avec prix » demande un vrai prix et une offre disponible.
    expect(bigCardLabel(2, 2, 0, piece("x", null))).toBe("other");
    expect(bigCardLabel(2, 2, 0, piece("x", 30, false))).toBe("other");
  });

  it("permis : « … avec prix » sur une offre avec prix, disponible, mise en grand d'office", () => {
    expect(bigCardLabel(2, 2, 0, piece("x", 30))).toBe("bestWithPrice");
    expect(bigCardLabel(2, 2, 0, piece("x", 30, true))).toBe("bestWithPrice");
  });
});

describe("tri par vos mots : le texte dit l'ordre de l'écran", () => {
  it("refusé : la première a un prix mais est épuisée — pas « Avec prix d'abord, puis selon vos mots »", () => {
    const result = { ...lists([piece("l1", 20, false), piece("l2", 25)]), sortedByWords: true };
    const start = bestProposalIndex(result, "fr");
    expect(start).toBe(1);
    expect(wordsSortNote(result, start)).toBeNull();
  });

  it("refusé : rien n'a de prix, la première est épuisée — pas « Avec prix d'abord » au-dessus d'une carte sans prix", () => {
    const result = { ...lists([piece("l1", null, false), piece("l2", null)]), sortedByWords: true };
    const start = bestProposalIndex(result, "fr");
    expect(start).toBe(1);
    expect(wordsSortNote(result, start)).toBeNull();
    // Une boutique sans prix non plus : toujours aucun texte d'ordre.
    const withShop = { ...lists([piece("l1", null, false), piece("l2", null)], [piece("b1", null)]), sortedByWords: true };
    expect(wordsSortNote(withShop, bestProposalIndex(withShop, "fr"))).toBeNull();
  });

  it("permis : les premières n'ont pas de prix — « Avec prix d'abord, puis selon vos mots », comme avant", () => {
    const result = { ...lists([piece("l1", null), piece("l2", null, false), piece("l3", 25)]), sortedByWords: true };
    expect(wordsSortNote(result, bestProposalIndex(result, "fr"))).toBe("priceThenWords");
    expect(wordsSortNote(result, 0)).toBe("words");
  });
});

describe("« En stock seulement » : les épuisées retirées, les inconnues gardées", () => {
  const result = lists([piece("l1", 30, true), piece("l2", 40, false), piece("l3", null), piece("l4", null, false)], [piece("s1", 25, false), piece("s2", 35)]);

  it("permis : en « Pertinence », dans chaque section ; trié par prix, dans la liste unique", () => {
    const layout = resultLayout(result, STOCK_ONLY, { selectedIndex: 0, pickedInPriceList: false, country: "fr" });
    expect(ids(layout.sections.others)).toEqual([]);
    expect(ids(layout.sections.withoutPrice)).toEqual(["l3"]);
    expect(ids(layout.sections.shopping)).toEqual(["s2"]);
    expect(ids(priceSortedList(result, "price_asc", { country: "fr", inStockOnly: true }))).toEqual(["l1", "s2", "l3"]);
    expect(layout.emptyWithStockFilter).toBe(false);
  });

  it("refusé : filtre éteint, rien n'est retiré (l'écran d'avant) ; une grande carte épuisée est seulement masquée avec le filtre", () => {
    const layout = resultLayout(result, DEFAULT_RESULT_VIEW, { selectedIndex: 0, pickedInPriceList: false, country: "fr" });
    expect(layout.sections).toEqual(priceFirstSections(result, 0));
    expect(ids(priceSortedList(result, "price_asc", { country: "fr" }))).toEqual(["s1", "l1", "s2", "l2", "l3", "l4"]);
    expect(bigCardShown(STOCK_ONLY, piece("l2", 40, false), false)).toBe(false);
    expect(bigCardShown(STOCK_ONLY, piece("l3", null), false)).toBe(true);
    expect(bigCardShown(DEFAULT_RESULT_VIEW, piece("l2", 40, false), false)).toBe(true);
  });

  it("permis : plus rien à montrer — un seul message, celui des filtres ; refusé : jamais quand une offre reste", () => {
    const soldOut = lists([piece("l1", 30, false)]);
    expect(nothingWithFilters(soldOut, STOCK_ONLY)).toBe(true);
    expect(resultLayout(soldOut, STOCK_ONLY, { selectedIndex: 0, pickedInPriceList: false })).toMatchObject({ emptyWithStockFilter: true, emptyWithFilter: false, bigCard: null });
    // Avec les deux filtres : une offre en stock sans prix ne suffit pas.
    expect(resultLayout(lists([piece("l1", null, true), piece("l2", 30, false)]), { ...STOCK_ONLY, withPriceOnly: true }, { selectedIndex: 0, pickedInPriceList: false })).toMatchObject({ emptyWithStockFilter: true, emptyWithFilter: false });
    expect(nothingWithFilters(lists([piece("l1", 30, false), piece("l2", null)]), STOCK_ONLY)).toBe(false);
    expect(nothingWithFilters(soldOut, DEFAULT_RESULT_VIEW)).toBe(false);
  });

  it("refusé : avec le filtre, ni « à partir de » ni « Le moins cher » sur une offre épuisée cachée", () => {
    const offers = lists([piece("a", 30, false), piece("b", 45, true), piece("c", 50)]);
    const layout = resultLayout(offers, { ...STOCK_ONLY, sort: "price_asc" }, { selectedIndex: 1, pickedInPriceList: false, country: "fr" });
    expect(layout.summary).toMatchObject({ count: 2, cheapest: { index: 1 } });
    expect(layout.cheapest).toBe(1);
    expect(priceSummary(offers, "fr", { inStockOnly: true })?.cheapest.piece.priceFrom).toBe(45);
    expect(resultLayout(lists([piece("a", 30, false), piece("b", 45)]), STOCK_ONLY, { selectedIndex: 1, pickedInPriceList: false, country: "fr" }).cheapest).toBeNull();
  });

  it("permis : filtre éteint, le résumé compte toutes les offres, comme avant (l'épuisée reste visible, avec sa mention)", () => {
    const offers = lists([piece("a", 30, false), piece("b", 45, true), piece("c", 50)]);
    const layout = resultLayout(offers, DEFAULT_RESULT_VIEW, { selectedIndex: 1, pickedInPriceList: false, country: "fr" });
    expect(layout.summary).toEqual(priceSummary(offers, "fr"));
    expect(layout.summary).toMatchObject({ count: 3, cheapest: { index: 0 } });
    expect(layout.cheapest).toBe(0);
  });

  it("proposé seulement quand une offre dit son stock, ou quand il est déjà choisi (pour le retirer)", () => {
    expect(stockFilterShown(lists([piece("l1", 30, true)]), DEFAULT_RESULT_VIEW)).toBe(true);
    expect(stockFilterShown(lists([piece("l1", 30)]), DEFAULT_RESULT_VIEW)).toBe(false);
    expect(stockFilterShown(lists([piece("l1", 30)]), STOCK_ONLY)).toBe(true);
    expect(isSoldOut(piece("l1", 30))).toBe(false);
  });
});

describe("le choix gardé sur l'appareil", () => {
  it("permis : « En stock seulement » relu tel quel", () => {
    expect(parseResultView(serializeResultView({ sort: "price_asc", withPriceOnly: false, inStockOnly: true }))).toEqual({ sort: "price_asc", withPriceOnly: false, inStockOnly: true });
  });

  it("refusé : une valeur illisible ou un choix d'avant ce lot ne l'allume jamais", () => {
    expect(parseResultView(JSON.stringify({ sort: "relevance", withPriceOnly: true, inStockOnly: "oui" }))).toEqual({ sort: "relevance", withPriceOnly: true });
    expect(parseResultView(JSON.stringify({ sort: "relevance", withPriceOnly: false }))).toEqual(DEFAULT_RESULT_VIEW);
    expect(serializeResultView(DEFAULT_RESULT_VIEW)).toBe(JSON.stringify({ sort: "relevance", withPriceOnly: false }));
  });
});

describe("statistiques : result_view_changed, sans changer le sens des propriétés d'avant", () => {
  it("permis : « stock_filter » quand c'est lui qui change, et in_stock_only à chaque changement", () => {
    expect(resultViewChangeProps(DEFAULT_RESULT_VIEW, { ...DEFAULT_RESULT_VIEW, inStockOnly: true })).toEqual({ sort: "relevance", with_price_only: false, in_stock_only: true, change: "stock_filter" });
    expect(resultViewChangeProps(STOCK_ONLY, { ...STOCK_ONLY, withPriceOnly: true })).toEqual({ sort: "relevance", with_price_only: true, in_stock_only: true, change: "filter" });
    expect(sanitizeProps("result_view_changed", { sort: "relevance", with_price_only: false, in_stock_only: true, change: "stock_filter" })).toEqual({ sort: "relevance", with_price_only: false, in_stock_only: true, change: "stock_filter" });
  });

  it("refusé : rien quand le filtre ne change pas (absent ou éteint, c'est pareil) ; aucune autre valeur ni texte", () => {
    expect(resultViewChangeProps(DEFAULT_RESULT_VIEW, { ...DEFAULT_RESULT_VIEW, inStockOnly: false })).toBeNull();
    expect(sanitizeProps("result_view_changed", { sort: "relevance", with_price_only: false, in_stock_only: "oui", change: "stock", platform: "web", merchant: "Boutique" })).toEqual({ sort: "relevance", with_price_only: false });
  });

  it("le mode d'emploi le dit", () => {
    const doc = read("STATISTIQUES.md");
    expect(doc).toContain("`stock_filter` (« En stock\n  seulement »)");
    expect(doc).toContain("`in_stock_only` = « En stock seulement »");
  });
});

describe("les textes et l'accessibilité", () => {
  it("les textes exacts, en français et en anglais, avec d'où et de quand vient le stock", () => {
    expect(fr.result.stock).toEqual({
      inStock: "En stock",
      soldOut: "Épuisée",
      source: "d'après Google, au moment de la recherche",
      hint: "Explique d'où vient cette information.",
      explanation: "D'après Google, au moment de la recherche. Le stock a pu changer depuis : vérifiez-le sur le site de la boutique avant d'acheter.",
      close: "J'ai compris",
    });
    expect(en.result.stock).toEqual({
      inStock: "In stock",
      soldOut: "Sold out",
      source: "according to Google, at the time of the search",
      hint: "Explains where this information comes from.",
      explanation: "According to Google, at the time of the search. Stock may have changed since then: check it on the shop's website before you buy.",
      close: "Got it",
    });
    expect([fr.result.inStockOnly, en.result.inStockOnly]).toEqual(["En stock seulement", "In stock only"]);
    expect(fr.result.inStockOnlyHint).toBe("Masque les offres que Google disait épuisées au moment de la recherche. Celles dont le stock est inconnu restent.");
    expect(en.result.inStockOnlyHint).toBe("Hides offers Google listed as sold out at the time of the search. Offers with unknown stock stay.");
    expect([fr.result.filtersEmpty, en.result.filtersEmpty]).toEqual(["Aucune proposition ne correspond à ces filtres pour l'instant.", "No suggestions match these filters for now."]);
    expect([fr.result.showAllWithoutFilters, en.result.showAllWithoutFilters]).toEqual(["Afficher toutes les propositions", "Show all suggestions"]);
    // Jamais de mot de vente forcée.
    expect(JSON.stringify([fr.result.stock, en.result.stock])).not.toMatch(/authentique|promotion|dernière|vite|hurry|last one/i);
  });

  it("la mention : une zone à part, touchable, dont le libellé lu dit la source ; rien quand c'est inconnu", () => {
    const note = read("src/components/stock-note.tsx");
    expect(note).toContain('if (typeof piece.inStock !== "boolean") return null;');
    expect(note).toContain('accessibilityRole="button"');
    expect(note).toContain("accessibilityLabel={`${label}, ${t.result.stock.source}`}");
    expect(note).toContain("accessibilityHint={t.result.stock.hint}");
    expect(note).toContain("{t.result.stock.explanation}");
    expect(note).toContain("accessibilityViewIsModal");
    expect(note).toContain('animationType={reduceMotion ? "none" : "slide"}');
  });

  it("sur la grande carte, les cartes des sections et la liste triée, juste après la mention de la boutique", () => {
    const card = read("src/components/proposal-card.tsx");
    expect(card.match(/<OfferMarkNote piece=\{piece\} \/>\n\s*\{\/\*[^\n]*\*\/\}\n\s*<StockNote piece=\{piece\} \/>/g)).toHaveLength(2);
    const screen = read("src/app/(app)/spot/result.tsx");
    expect(screen.indexOf("<StockNote piece={piece} />")).toBeGreaterThan(screen.indexOf("<OfferMarkNote piece={piece} />"));
    expect(screen).toContain("bigCardLabel(selectedIndex, bestIndex, firstAvailableIndex(result), allPieces(result)[selectedIndex])");
  });

  it("le filtre : un interrupteur, avec son libellé et ce qu'il fait, juste sous la barre de tri", () => {
    const bar = read("src/components/result-sort-bar.tsx");
    expect(bar).toContain("aria-checked={checked}");
    expect(bar).toContain("accessibilityLabel={t.result.inStockOnly}");
    expect(bar).toContain("accessibilityHint={t.result.inStockOnlyHint}");
    expect(bar).toContain("onChange({ ...view, inStockOnly: !checked })");
    // Lot « vitrine » (retours du build 3) : à côté de « Avec prix seulement », dans la même ligne de pastilles de la barre.
    const filters = bar.slice(bar.indexOf("<View style={styles.filters}>"), bar.indexOf("export function InStockOnlyToggle"));
    expect(filters.indexOf('testID="with-price-only"')).toBeGreaterThan(-1);
    expect(filters.indexOf("{stockShown ? <InStockOnlyToggle view={view} onChange={onChange} /> : null}")).toBeGreaterThan(filters.indexOf('testID="with-price-only"'));
    const screen = read("src/app/(app)/spot/result.tsx");
    const sortBar = screen.indexOf("<ResultSortBar view={view} onChange={changeView} summary={summaryText} stockShown={stockFilterShown(result, view)} />");
    expect(sortBar).toBeGreaterThan(-1);
    expect(sortBar).toBeLessThan(screen.indexOf("<YourPiece image={yourPiece} />"));
    // Refusé : plus de rendu séparé sous la barre.
    expect(screen).not.toContain("<InStockOnlyToggle");
    expect(screen).toContain("changeView({ ...view, withPriceOnly: false, inStockOnly: false })");
  });
});
