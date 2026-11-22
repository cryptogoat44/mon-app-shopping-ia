import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProductMatch, ProductSearch } from "@monapp/shared-types";
import type { SpotResult } from "../src/api/types";
import { APP_NAME_DISPLAY as BRAND } from "../src/constants/brand";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { termsOfUse } from "../src/legal/conditions";
import { termsOfUseEn } from "../src/legal/conditions.en";
import { bestProposalIndex, bigCardLabel, noPriceNoticeShown, priceFirstSections, startProposalIndex } from "../src/lib/price-first";
import { allPieces } from "../src/lib/result-sections";
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
    expect(fr.result.offerMark.official_shop).toBe("Boutique officielle de la marque");
    expect(fr.result.offerMark.known_shop).toBe("Boutique connue");
    expect(fr.result.offerMark.unusual_price).toBe("Prix inhabituellement bas");
    // Ordre des boutiques (décision du fondateur, 21 novembre 2026) : aucune marque mise en avant ; seule la section
    // « Cette pièce dans d'autres boutiques » est rangée par les mentions, et la feuille (ouverte depuis n'importe
    // quelle carte) le dit, avec les trois effets : seule la boutique de la marque de la pièce y passe en premier,
    // seulement quand le serveur a reconnu cette boutique — ce qui n'arrive jamais sans 0054 : la condition porte sur
    // la boutique reconnue, jamais sur la marque, et la phrase dit que ce n'est pas toujours le cas.
    expect(fr.result.offerMark.explanation).toBe(
      `${BRAND} signale les boutiques officielles des marques, les boutiques connues et les prix inhabituellement bas. Dans « Cette pièce dans d'autres boutiques », la boutique officielle de la marque de la pièce passe en premier seulement quand ${BRAND} a reconnu cette boutique, ce qui n'est pas toujours le cas ; les autres boutiques officielles et les boutiques connues remontent un peu, et les prix inhabituellement bas passent en dernier. Vérifiez toujours la boutique avant de payer.`
    );
    expect(fr.result.offerMark.explanation).toContain(`« ${fr.result.complementTitleAi} »`);
    expect(en.result.offerMark.official_shop).toBe("Official brand store");
    expect(en.result.offerMark.known_shop).toBe("Well-known shop");
    expect(en.result.offerMark.unusual_price).toBe("Unusually low price");
    expect(en.result.offerMark.explanation).toBe(
      `${BRAND} labels official brand stores, well-known shops and unusually low prices. In “This piece at other shops”, the official store of the piece's brand comes first only when ${BRAND} has recognized that store, which is not always the case; other official brand stores and well-known shops move up a little, and unusually low prices come last. Always check the shop before you pay.`
    );
    expect(en.result.offerMark.explanation).toContain(`“${en.result.complementTitleAi}”`);
    for (const text of [fr.result.offerMark.explanation, en.result.offerMark.explanation]) expect(text).not.toMatch(/met en avant|highlight/i);
    // Refusé : la règle sans sa section (fausse dans la recherche visuelle et « Résultats pour vos mots »).
    expect(fr.result.offerMark.explanation).not.toMatch(/Pour une même pièce vendue dans plusieurs boutiques/);
    expect(en.result.offerMark.explanation).not.toMatch(/When the same piece is sold by several shops/);
    // Refusé : la règle sans condition, qui disait passer en premier toute boutique officielle (celle d'une autre
    // marque, ou non reconnue, est rangée comme une boutique connue), ou une condition sur la marque (« reconnaît
    // cette marque » : sans 0054, aucune boutique n'est reconnue, même pour une marque reconnue).
    expect(fr.result.offerMark.explanation).not.toMatch(/la boutique officielle de la marque passe en premier/);
    expect(en.result.offerMark.explanation).not.toMatch(/the official brand store comes first/);
    expect(fr.result.offerMark.explanation).not.toMatch(/reconnaît cette marque|passe en premier quand/);
    expect(en.result.offerMark.explanation).not.toMatch(/recognizes that brand|comes first when/);
    const all = JSON.stringify([fr.result.offerMark, en.result.offerMark]).toLowerCase();
    for (const word of ["arnaque", "escroc", "fraude", "faux", "fausse", "scam", "fraud", "fake"]) expect(all).not.toContain(word);
  });

  it("conditions d'utilisation : une phrase dit que Spotto peut masquer des offres, les signale, et comment « Cette pièce dans d'autres boutiques » est rangée — comme la feuille, avec aussi les adresses douteuses (français et anglais)", () => {
    const blocks = (doc: typeof termsOfUse) => doc.sections.flatMap((section) => section.blocks.flat()).join("\n");
    expect(blocks(termsOfUse)).toContain(
      `peut ne pas afficher certaines offres, et signale les boutiques officielles des marques, les boutiques connues et les prix inhabituellement bas ; dans « Cette pièce dans d'autres boutiques », la boutique officielle de la marque de la pièce passe en premier seulement quand ${BRAND} a reconnu cette boutique, ce qui n'est pas toujours le cas ; les autres boutiques officielles et les boutiques connues remontent un peu, et les offres à prix inhabituellement bas ou à l'adresse douteuse passent en dernier. Ce n'est pas une garantie : vérifiez toujours la boutique avant de payer.`
    );
    expect(blocks(termsOfUseEn)).toContain(
      `may not show some offers, and labels official brand stores, well-known shops and unusually low prices; in “This piece at other shops”, the official store of the piece's brand comes first only when ${BRAND} has recognized that store, which is not always the case; other official brand stores and well-known shops move up a little, and offers with an unusually low price or a dubious address come last. This is not a guarantee: always check the shop before you pay.`
    );
    for (const text of [blocks(termsOfUse), blocks(termsOfUseEn)]) expect(text).not.toMatch(/mettre en avant les boutiques|highlight official/i);
    // Refusé : la règle sans sa section, ou sans condition (toute boutique officielle en premier).
    expect(blocks(termsOfUse)).not.toMatch(/pour une même pièce vendue dans plusieurs boutiques/i);
    expect(blocks(termsOfUseEn)).not.toMatch(/when the same piece is sold by several shops/i);
    expect(blocks(termsOfUse)).not.toMatch(/la boutique officielle de la marque passe en premier/);
    expect(blocks(termsOfUseEn)).not.toMatch(/the official brand store comes first/);
    // Refusé : la condition sur la marque, ou sans « pas toujours ».
    expect(blocks(termsOfUse)).not.toMatch(/la reconnaît, passe en premier|reconnaît cette marque/);
    expect(blocks(termsOfUseEn)).not.toMatch(/when \S+ recognizes it|recognizes that brand/);
    expect(blocks(termsOfUse)).toContain("ce qui n'est pas toujours le cas");
    expect(blocks(termsOfUseEn)).toContain("which is not always the case");
  });
});

describe("mentions des boutiques : ce que l'app reçoit et affiche", () => {
  it("la mention suit la proposition ; une valeur inconnue (serveur plus récent) ou absente (ancien serveur) : rien", () => {
    expect(matchToPiece(match("p1", 10, { offerMark: "known_shop" })).offerMark).toBe("known_shop");
    expect(matchToPiece(match("p1", 10, { offerMark: "official_shop" })).offerMark).toBe("official_shop");
    expect(matchToPiece(match("p2", 10, { offerMark: "unusual_price" })).offerMark).toBe("unusual_price");
    expect(matchToPiece(match("p3", 10, { offerMark: "autre" as never }))).not.toHaveProperty("offerMark");
    expect(matchToPiece(match("p4", 10))).not.toHaveProperty("offerMark");
  });

  it("« Prix inhabituellement bas » : jamais « Le moins cher », ni « à partir de »", () => {
    const lists = result([match("p1", 120), match("p2", 110), match("p3", 25, { offerMark: "unusual_price" }), match("p4", 130)]);
    expect(cheapestIndex(lists, "fr")).toBe(1);
    expect(priceSummary(lists, "fr")).toMatchObject({ count: 3, cheapest: { index: 1 } });
  });

  it("grande carte d'office (ordre des boutiques, 21 novembre 2026) : la première reçue avec un prix, quelle que soit sa mention — une offre « Prix inhabituellement bas » n'est plus sautée et garde sa mention ; une boutique officielle ou connue plus bas ne passe pas devant", () => {
    const unusualFirst = result([match("p1", 25, { offerMark: "unusual_price" }), match("p2", 110), match("p3", null)]);
    expect(bestProposalIndex(unusualFirst, "fr")).toBe(0);
    expect(unusualFirst.pieces[0]!.offerMark).toBe("unusual_price");
    const markedLater = result([match("p1", 120), match("p2", 110, { offerMark: "official_shop" }), match("p3", 100, { offerMark: "known_shop" })]);
    expect(bestProposalIndex(markedLater, "fr")).toBe(0);
  });

  it("grande carte prise dans le complément (aucun prix dans la recherche visuelle, au rechargement du site comme à l'ouverture) : la première REÇUE de « Cette pièce dans d'autres boutiques », jamais la boutique officielle ou connue que le serveur y remonte", () => {
    const lens = [match("p1", null), match("p2", null), match("p3", null)];
    // Refusé : nike.com, reçue 8ᵉ, envoyée en tête de la section (boutique officielle de la marque).
    const official = result([
      ...lens,
      match("p8", 135, { origin: "shopping", offerMark: "official_shop", merchantUrl: "https://www.nike.com/fr/p8" }),
      match("p4", 115, { origin: "shopping", merchantUrl: "https://boutique-c.fr/p4" }),
      match("p5", 122, { origin: "shopping", merchantUrl: "https://boutique-d.fr/p5" }),
    ]);
    const best = bestProposalIndex(official, "fr");
    // Permis : la première reçue avec un prix, boutique-c.fr (rang 4), libellé « Meilleure proposition avec prix ».
    expect(allPieces(official)[best]!.id).toBe("p4");
    const start = startProposalIndex(official, { country: "fr" });
    expect(start).toBe(best);
    expect(bigCardLabel(start, best)).toBe("bestWithPrice");
    expect(noPriceNoticeShown(official, start)).toBe(false);
    // Refusé : une boutique connue reçue 3ᵉ, remontée de 2 places par le serveur.
    const known = result([
      ...lens,
      match("p6", 119, { origin: "shopping", offerMark: "known_shop", merchantUrl: "https://www.zalando.fr/p6" }),
      match("p4", 115, { origin: "shopping" }),
      match("p5", 122, { origin: "shopping" }),
    ]);
    expect(allPieces(known)[bestProposalIndex(known, "fr")]!.id).toBe("p4");
    // La première reçue sans prix : la première proposition Lens, comme avant (jamais la boutique remontée).
    const firstWithoutPrice = result([...lens, match("p8", 135, { origin: "shopping", offerMark: "official_shop" }), match("p4", null, { origin: "shopping" })]);
    expect(bestProposalIndex(firstWithoutPrice, "fr")).toBe(0);
    // Un prix dans la recherche visuelle : rien ne change.
    const lensPriced = result([match("p1", null), match("p2", 99), match("p8", 135, { origin: "shopping", offerMark: "official_shop" }), match("p4", 115, { origin: "shopping" })]);
    expect(allPieces(lensPriced)[bestProposalIndex(lensPriced, "fr")]!.id).toBe("p2");
  });

  it("grande carte prise dans le complément : jamais une offre que le serveur range en fin de section (adresse douteuse, sans mention ; prix inhabituellement bas), même reçue la première", () => {
    const lens = [match("p1", null), match("p2", null)];
    // Dans l'ordre envoyé : la boutique de la marque de la pièce, la boutique connue remontée, puis l'adresse douteuse en dernier.
    const dubiousFirst = result([
      ...lens,
      match("p6", 1250, { origin: "shopping", offerMark: "official_shop", merchantUrl: "https://www.moncler.com/fr/p6" }),
      match("p5", 650, { origin: "shopping", offerMark: "known_shop", merchantUrl: "https://www.zalando.fr/p5" }),
      match("p4", 640, { origin: "shopping", merchantUrl: "https://boutique-c.fr/p4" }),
      match("p7", 660, { origin: "shopping", merchantUrl: "https://boutique-d.fr/p7" }),
      match("p3", 610, { origin: "shopping", demoted: true, merchantUrl: "https://moncler-outlet.shop/p3" }),
    ]);
    const best = bestProposalIndex(dubiousFirst, "fr");
    // Permis : boutique-c.fr (rang 4), la première reçue que le serveur ne range pas en fin de section.
    expect(allPieces(dubiousFirst)[best]!.id).toBe("p4");
    expect(bigCardLabel(startProposalIndex(dubiousFirst, { country: "fr" }), best)).toBe("bestWithPrice");
    // Refusé : moncler-outlet.shop (rang 3, sans mention) n'est pas « Meilleure proposition avec prix » ; elle reste dans sa section.
    expect(priceFirstSections(dubiousFirst, best).shopping.map(({ piece }) => piece.id)).toEqual(["p6", "p5", "p7", "p3"]);
    // Refusé : un prix inhabituellement bas reçu le premier, avec sa mention, ne passe pas non plus en grand.
    const unusualFirst = result([
      ...lens,
      match("p4", 80, { origin: "shopping" }),
      match("p5", 85, { origin: "shopping" }),
      match("p6", 90, { origin: "shopping" }),
      match("p3", 20, { origin: "shopping", offerMark: "unusual_price", demoted: true }),
    ]);
    expect(allPieces(unusualFirst)[bestProposalIndex(unusualFirst, "fr")]!.id).toBe("p4");
    // Toutes rangées en fin de section : la première reçue, comme avant.
    const allDemoted = result([...lens, match("p4", 70, { origin: "shopping", demoted: true }), match("p3", 75, { origin: "shopping", demoted: true })]);
    expect(allPieces(allDemoted)[bestProposalIndex(allDemoted, "fr")]!.id).toBe("p3");
    // Le signal suit la proposition, seulement quand il est vrai (un ancien serveur ne l'envoie jamais).
    expect(matchToPiece(match("p3", 10, { origin: "shopping", demoted: true })).demoted).toBe(true);
    expect(matchToPiece(match("p4", 10, { origin: "shopping" }))).not.toHaveProperty("demoted");
    expect(matchToPiece(match("p5", 10, { origin: "shopping", demoted: "oui" as never }))).not.toHaveProperty("demoted");
  });

  it("le rang envoyé par le serveur suit la proposition ; illisible, il manque, et l'app reprend l'ordre affiché", () => {
    expect(matchToPiece(match("p7", 10)).rank).toBe(7);
    expect(matchToPiece(match("p7", 10, { rank: Number.NaN }))).not.toHaveProperty("rank");
    const withoutRank = result([match("p1", null), match("p9", 50, { origin: "shopping", rank: Number.NaN }), match("p4", 40, { origin: "shopping" })]);
    expect(allPieces(withoutRank)[bestProposalIndex(withoutRank, "fr")]!.id).toBe("p9");
  });

  it("« Pertinence » suit l'ordre du serveur, section par section : l'app ne range rien d'après les mentions", () => {
    const lists = result([
      match("p1", 120),
      match("p2", 110, { offerMark: "official_shop" }),
      match("p3", 30, { offerMark: "unusual_price" }),
      match("p4", 135, { origin: "shopping", offerMark: "official_shop" }),
      match("p5", 115, { origin: "shopping" }),
      match("p6", 112, { origin: "words" }),
      match("p7", 121, { origin: "words", offerMark: "known_shop" }),
    ]);
    const sections = priceFirstSections(lists, bestProposalIndex(lists, "fr"));
    expect(bestProposalIndex(lists, "fr")).toBe(0);
    expect(sections.others.map(({ piece }) => piece.id)).toEqual(["p2", "p3"]);
    expect(sections.shopping.map(({ piece }) => piece.id)).toEqual(["p4", "p5"]);
    expect(sections.words.map(({ piece }) => piece.id)).toEqual(["p6", "p7"]);
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
