import { describe, expect, it } from "vitest";
import type { MatchOrigin } from "@monapp/shared-types";
import type { Piece, SpotResult } from "../src/api/types";
import { COMPLEMENT_SHOWN_FIRST, allPieces, firstShown, merchantContextFor, opensOfferPage, otherPiecesBySection } from "../src/lib/result-sections";

// Voie C (lot c) : sections de l'écran Résultat — la recherche visuelle
// d'abord, telle qu'aujourd'hui, puis « shopping », puis « words ».
function piece(id: string, origin?: MatchOrigin, merchantUrl = `https://boutique.test/${id}`): Piece {
  return {
    id,
    name: `Pièce ${id}`,
    reference: null,
    material: null,
    imageUrl: `https://boutique.test/${id}.jpg`,
    priceFrom: null,
    currency: null,
    merchantName: "Boutique",
    merchantUrl,
    affiliateUrl: merchantUrl,
    real: true,
    ...(origin ? { origin } : {}),
  };
}

function result(lens: number, shopping: number, words: number): Pick<SpotResult, "pieces" | "complement"> {
  const list = (count: number, prefix: string, origin?: MatchOrigin) => Array.from({ length: count }, (_, i) => piece(`${prefix}${i + 1}`, origin));
  return {
    pieces: list(lens, "l"),
    complement: { shopping: list(shopping, "s", "shopping"), words: list(words, "w", "words"), status: "shown", query: null, suggestText: false, textStatus: null },
  };
}

describe("sections de l'écran Résultat (voie C)", () => {
  it("une seule liste d'indices : recherche visuelle, puis shopping, puis mots", () => {
    expect(allPieces(result(2, 2, 1)).map((p) => p.id)).toEqual(["l1", "l2", "s1", "s2", "w1"]);
    // Sans complément : la liste d'aujourd'hui.
    expect(allPieces({ pieces: [piece("l1")] }).map((p) => p.id)).toEqual(["l1"]);
  });

  it("chaque section garde ses indices dans la liste complète", () => {
    const sections = otherPiecesBySection(result(2, 2, 1), 0);
    expect(sections.lens.map(({ piece: p, index }) => [p.id, index])).toEqual([["l2", 1]]);
    expect(sections.shopping.map(({ piece: p, index }) => [p.id, index])).toEqual([["s1", 2], ["s2", 3]]);
    expect(sections.words.map(({ piece: p, index }) => [p.id, index])).toEqual([["w1", 4]]);
  });

  it("la proposition montrée en grand sort de sa section, et de celle-là seulement", () => {
    const fromShopping = otherPiecesBySection(result(2, 2, 1), 3);
    expect(fromShopping.lens.map(({ piece: p }) => p.id)).toEqual(["l1", "l2"]);
    expect(fromShopping.shopping.map(({ piece: p }) => p.id)).toEqual(["s1"]);
    expect(fromShopping.words.map(({ piece: p }) => p.id)).toEqual(["w1"]);
    // Recherche visuelle vide, mots trouvés : la première proposition des mots est en grand.
    const wordsOnly = otherPiecesBySection(result(0, 0, 3), 0);
    expect(wordsOnly.lens).toEqual([]);
    expect(wordsOnly.words.map(({ piece: p, index }) => [p.id, index])).toEqual([["w2", 1], ["w3", 2]]);
  });

  it("la recherche par les mots ajoute à la fin : aucune proposition affichée ne change d'indice", () => {
    const before = allPieces(result(3, 2, 0));
    const after = allPieces(result(3, 2, 4));
    before.forEach((p, index) => expect(after[index]?.id).toBe(p.id));
  });

  it("6 propositions du complément d'emblée, puis « Voir plus »", () => {
    expect(COMPLEMENT_SHOWN_FIRST).toBe(6);
    const others = otherPiecesBySection(result(1, 9, 0), 0).shopping;
    expect(firstShown(others, false, COMPLEMENT_SHOWN_FIRST)).toMatchObject({ hiddenCount: 3 });
    expect(firstShown(others, false, COMPLEMENT_SHOWN_FIRST).visible).toHaveLength(6);
    expect(firstShown(others, true, COMPLEMENT_SHOWN_FIRST)).toMatchObject({ hiddenCount: 0 });
    expect(firstShown(others.slice(0, 4), false, COMPLEMENT_SHOWN_FIRST)).toMatchObject({ hiddenCount: 0 });
  });

  it("clic marchand : « similar » pour le complément, « result » pour la recherche visuelle", () => {
    expect(merchantContextFor(piece("l1"))).toBe("result");
    expect(merchantContextFor(piece("l1", "lens"))).toBe("result");
    expect(merchantContextFor(piece("s1", "shopping"))).toBe("similar");
    expect(merchantContextFor(piece("w1", "words"))).toBe("similar");
  });

  it("« Voir l'offre » seulement pour une page produit de Google du complément", () => {
    expect(opensOfferPage(piece("s1", "shopping", "https://www.google.fr/shopping/product/123"))).toBe(true);
    expect(opensOfferPage(piece("w1", "words", "https://shopping.google.com/product/1"))).toBe(true);
    expect(opensOfferPage(piece("s2", "shopping", "https://www.google.co.uk/shopping/product/9"))).toBe(true);
    expect(opensOfferPage(piece("s3", "shopping"))).toBe(false);
    // Un faux domaine qui contient « google » n'en est pas un.
    expect(opensOfferPage(piece("s4", "shopping", "https://google.fr.boutique.test/p"))).toBe(false);
    // La recherche visuelle ne change jamais de bouton.
    expect(opensOfferPage(piece("l1", undefined, "https://www.google.fr/shopping/product/123"))).toBe(false);
  });
});
