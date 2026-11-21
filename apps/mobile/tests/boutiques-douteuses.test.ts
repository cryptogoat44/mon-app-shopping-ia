import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProductMatch, ProductSearch } from "@monapp/shared-types";
import type { SpotResult } from "../src/api/types";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { termsOfUse } from "../src/legal/conditions";
import { termsOfUseEn } from "../src/legal/conditions.en";
import { bestProposalIndex } from "../src/lib/price-first";
import { cheapestIndex, priceSortedList, priceSummary } from "../src/lib/result-sort";
import { matchToPiece, toSpotResult } from "../src/lib/spot-result";

// Lot « recherche confiance » : les mentions des boutiques (« Boutique
// connue », « Prix inhabituellement bas ») vues de l'app. Logique pure et
// lecture du code des écrans (aucun rendu).

const SRC = join(__dirname, "../src");
/** Code sans ses commentaires. */
const code = (path: string) =>
  readFileSync(join(SRC, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

function match(id: string, price: number | null, extra: Partial<ProductMatch> = {}): ProductMatch {
  return {
    id,
    rank: Number(id.replace(/\D/g, "")) || 1,
    productName: `Veste ${id}`,
    brand: null,
    imageUrl: `https://images.exemple.fr/${id}.jpg`,
    imageHdUrl: null,
    priceMin: price,
    priceMax: price,
    currency: price === null ? null : "EUR",
    merchantName: "Boutique",
    merchantUrl: `https://boutique-exemple.fr/${id}`,
    affiliateUrl: `https://boutique-exemple.fr/${id}`,
    feedbackReason: null,
    ...extra,
  };
}

function result(matches: ProductMatch[]): Pick<SpotResult, "pieces" | "complement"> {
  const search = { id: "s", sourceUrl: null, sourcePlatform: "photo", method: "manual_screenshot", status: "completed", errorMessage: null, query: null, createdAt: "", matches } as ProductSearch;
  return toSpotResult(search);
}

describe("mentions des boutiques : textes", () => {
  it("français et anglais, neutres et factuels — jamais une accusation", () => {
    expect(fr.result.offerMark.known_shop).toBe("Boutique connue");
    expect(fr.result.offerMark.unusual_price).toBe("Prix inhabituellement bas");
    expect(fr.result.offerMark.explanation).toMatch(/^.+ met en avant les boutiques connues et signale les prix inhabituellement bas ; vérifiez toujours la boutique avant de payer\.$/);
    expect(en.result.offerMark.known_shop).toBe("Well-known shop");
    expect(en.result.offerMark.unusual_price).toBe("Unusually low price");
    expect(en.result.offerMark.explanation).toMatch(/highlights well-known shops and flags unusually low prices; always check the shop before you pay\.$/);
    const all = JSON.stringify([fr.result.offerMark, en.result.offerMark]).toLowerCase();
    for (const word of ["arnaque", "escroc", "fraude", "faux", "fausse", "scam", "fraud", "fake"]) expect(all).not.toContain(word);
  });

  it("conditions d'utilisation : une phrase dit que Spotto peut masquer ou signaler des offres (français et anglais)", () => {
    const blocks = (doc: typeof termsOfUse) => doc.sections.flatMap((section) => section.blocks.flat()).join("\n");
    expect(blocks(termsOfUse)).toMatch(/peut ne pas afficher certaines offres, en signaler d'autres \(« Prix inhabituellement bas »\) et mettre en avant des boutiques connues/);
    expect(blocks(termsOfUseEn)).toMatch(/may not show some offers, may flag others \(“Unusually low price”\) and may highlight well-known shops/);
  });
});

describe("mentions des boutiques : ce que l'app reçoit et affiche", () => {
  it("la mention suit la proposition ; une valeur inconnue (serveur plus récent) ou absente (ancien serveur) : rien", () => {
    expect(matchToPiece(match("p1", 10, { offerMark: "known_shop" })).offerMark).toBe("known_shop");
    expect(matchToPiece(match("p2", 10, { offerMark: "unusual_price" })).offerMark).toBe("unusual_price");
    expect(matchToPiece(match("p3", 10, { offerMark: "autre" as never }))).not.toHaveProperty("offerMark");
    expect(matchToPiece(match("p4", 10))).not.toHaveProperty("offerMark");
  });

  it("« Prix inhabituellement bas » : jamais « Le moins cher », ni « à partir de », ni la grande carte d'office", () => {
    const lists = result([match("p1", 120), match("p2", 110), match("p3", 25, { offerMark: "unusual_price" }), match("p4", 130)]);
    expect(cheapestIndex(lists, "fr")).toBe(1);
    expect(priceSummary(lists, "fr")).toMatchObject({ count: 3, cheapest: { index: 1 } });
    const unusualFirst = result([match("p1", 25, { offerMark: "unusual_price" }), match("p2", 110), match("p3", null)]);
    expect(bestProposalIndex(unusualFirst, "fr")).toBe(1);
  });

  it("« Trier par prix » trie ce que le serveur envoie, rien de plus : les offres retirées n'y reviennent jamais ; une offre signalée garde sa place et sa mention", () => {
    const lists = result([match("p1", 120), match("p2", 25, { offerMark: "unusual_price" }), match("p3", 110, { offerMark: "known_shop" })]);
    const sorted = priceSortedList(lists, "price_asc", { country: "fr" });
    expect(sorted.map(({ piece }) => piece.id)).toEqual(["p2", "p3", "p1"]);
    expect(sorted.map(({ piece }) => piece.offerMark ?? null)).toEqual(["unusual_price", "known_shop", null]);
  });

  it("sur chaque carte (grille, liste triée, grande carte) : une zone à part, touchable, avec son libellé et la feuille d'une phrase", () => {
    const card = code("components/proposal-card.tsx");
    const row = card.slice(card.indexOf('if (variant === "row")'), card.indexOf("return (\n    <View style={styles.card}>"));
    const grid = card.slice(card.indexOf("return (\n    <View style={styles.card}>"), card.indexOf("export function CheapestBadge"));
    for (const variant of [row, grid]) expect(variant.indexOf("<OfferMarkNote piece={piece} />")).toBeGreaterThan(variant.indexOf("</Pressable>"));
    const screen = code("app/(app)/spot/result.tsx");
    expect(screen.indexOf("<OfferMarkNote piece={piece} />")).toBeGreaterThan(screen.indexOf("<ForeignShopNote piece={piece} />"));
    const mark = code("components/offer-mark.tsx");
    expect(mark).toContain('accessibilityRole="button"');
    expect(mark).toContain("accessibilityLabel={label}");
    expect(mark).toContain("accessibilityHint={t.result.offerMark.hint}");
    expect(mark).toContain("{t.result.offerMark.explanation}");
    expect(mark).toContain('animationType={reduceMotion ? "none" : "slide"}');
    expect(mark).toContain("accessibilityViewIsModal");
    expect(mark).toContain("if (!mark) return null;");
  });
});
