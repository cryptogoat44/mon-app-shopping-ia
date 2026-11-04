import { describe, expect, it } from "vitest";
import type { MatchOrigin } from "@monapp/shared-types";
import type { Piece, SpotResult } from "../src/api/types";
import { allPieces } from "../src/lib/result-sections";
import { bestProposalIndex, clickPlacements, hasPrice, noPriceAnywhere, priceFirstSections } from "../src/lib/price-first";

// Prix d'abord (décision du fondateur du 2026-11-03) : les propositions avec
// prix d'abord, celles de la recherche visuelle sans prix repliées en
// dernier ; rien de replié quand rien n'a de prix. L'ordre du serveur et les
// indices de l'écran ne changent jamais.
type Lists = Pick<SpotResult, "pieces" | "complement">;

/** Une proposition : son identifiant dit son origine et si elle a un prix (« l3€ » : 3ᵉ de Lens, avec prix). */
function piece(id: string, price: number | null, origin?: MatchOrigin): Piece {
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
  };
}

/** « € » : avec prix ; « - » : sans prix. Ex. lists("-€-", "€") : 3 de Lens (la 2ᵉ seule avec prix), 1 « boutiques ». */
function lists(lens: string, shopping = "", words = "", withComplement = shopping !== "" || words !== ""): Lists {
  const make = (marks: string, prefix: string, origin?: MatchOrigin) =>
    [...marks].map((mark, i) => piece(`${prefix}${i + 1}${mark === "€" ? "€" : ""}`, mark === "€" ? 49 + i : null, origin));
  return {
    pieces: make(lens, "l"),
    ...(withComplement
      ? { complement: { shopping: make(shopping, "s", "shopping"), words: make(words, "w", "words"), status: "shown" as const, query: null, suggestText: false, textStatus: null } }
      : {}),
  };
}

const ids = (items: { piece: Piece }[]) => items.map(({ piece: p }) => p.id);
const idAt = (result: Lists, index: number) => allPieces(result)[index]?.id;

describe("prix d'abord : la grande carte proposée d'office", () => {
  it("la mieux classée des propositions Lens avec prix", () => {
    const result = lists("--€-€");
    expect(idAt(result, bestProposalIndex(result))).toBe("l3€");
  });

  it("Lens sans aucun prix : la première du complément, si elle a un prix", () => {
    const shops = lists("---", "€€");
    expect(idAt(shops, bestProposalIndex(shops))).toBe("s1€");
    // Pas de section « boutiques » : la première des mots.
    const words = lists("---", "", "€-");
    expect(idAt(words, bestProposalIndex(words))).toBe("w1€");
  });

  it("la première du complément sans prix : la première proposition Lens, comme avant (même si une suivante a un prix)", () => {
    const result = lists("---", "-€");
    expect(bestProposalIndex(result)).toBe(0);
    expect(idAt(result, 0)).toBe("l1");
  });

  it("aucun prix nulle part : la première proposition, comme avant", () => {
    expect(bestProposalIndex(lists("---"))).toBe(0);
    expect(bestProposalIndex(lists("--", "--", "-"))).toBe(0);
  });

  it("une Lens avec prix passe toujours avant le complément, même à prix égal", () => {
    const result: Lists = {
      pieces: [piece("l1", null), piece("l2", 30)],
      complement: { shopping: [piece("s1", 30, "shopping")], words: [], status: "shown", query: null, suggestText: false, textStatus: null },
    };
    expect(idAt(result, bestProposalIndex(result))).toBe("l2");
  });

  it("égalités : à prix égal, l'ordre du serveur décide ; un prix à 0 est un prix", () => {
    const same = { pieces: [piece("l1", null), piece("l2", 20), piece("l3", 20), piece("l4", 10)] };
    expect(idAt(same, bestProposalIndex(same))).toBe("l2");
    expect(ids(priceFirstSections(same, bestProposalIndex(same)).others)).toEqual(["l3", "l4"]);
    const zero = { pieces: [piece("l1", null), piece("l2", 0)] };
    expect(hasPrice(zero.pieces[1]!)).toBe(true);
    expect(idAt(zero, bestProposalIndex(zero))).toBe("l2");
  });

  it("recherche visuelle vide (rien trouvé, puis vos mots) : la première du complément, avec ou sans prix", () => {
    expect(bestProposalIndex(lists("", "", "-€"))).toBe(0);
    expect(bestProposalIndex(lists("", "", "€-"))).toBe(0);
  });

  it("aucune proposition : indice 0, et aucune place pour les statistiques", () => {
    expect(bestProposalIndex({ pieces: [] })).toBe(0);
    expect(clickPlacements({ pieces: [] }).size).toBe(0);
  });
});

describe("prix d'abord : les sections, dans leur ordre d'origine", () => {
  it("avec prix : « Autres propositions » avec prix, le complément inchangé, puis « Sans prix »", () => {
    const result = lists("-€-€€-", "€-", "€");
    const sections = priceFirstSections(result, bestProposalIndex(result));
    expect(idAt(result, bestProposalIndex(result))).toBe("l2€");
    expect(ids(sections.others)).toEqual(["l4€", "l5€"]);
    expect(ids(sections.shopping)).toEqual(["s1€", "s2"]);
    expect(ids(sections.words)).toEqual(["w1€"]);
    expect(ids(sections.withoutPrice)).toEqual(["l1", "l3", "l6"]);
  });

  it("complément seul avec prix : grande carte du complément, toutes les Lens repliées", () => {
    const result = lists("---", "€€€");
    const sections = priceFirstSections(result, bestProposalIndex(result));
    expect(sections.others).toEqual([]);
    expect(ids(sections.shopping)).toEqual(["s2€", "s3€"]);
    expect(ids(sections.withoutPrice)).toEqual(["l1", "l2", "l3"]);
    expect(noPriceAnywhere(result)).toBe(false);
  });

  it("aucun prix nulle part : rien n'est replié, tout s'affiche comme avant", () => {
    const result = lists("----", "-", "-");
    const sections = priceFirstSections(result, 0);
    expect(ids(sections.others)).toEqual(["l2", "l3", "l4"]);
    expect(ids(sections.shopping)).toEqual(["s1"]);
    expect(ids(sections.words)).toEqual(["w1"]);
    expect(sections.withoutPrice).toEqual([]);
    expect(noPriceAnywhere(result)).toBe(true);
  });

  it("une seule proposition : rien d'autre à montrer, avec ou sans prix", () => {
    for (const marks of ["€", "-"]) {
      const result = lists(marks);
      expect(bestProposalIndex(result)).toBe(0);
      expect(priceFirstSections(result, 0)).toEqual({ others: [], shopping: [], words: [], withoutPrice: [] });
    }
    expect(noPriceAnywhere(lists("-"))).toBe(true);
    expect(noPriceAnywhere(lists("€"))).toBe(false);
  });

  it("une proposition sans prix mise en grand quitte « Sans prix » ; la meilleure revient à sa place", () => {
    const result = lists("-€-€");
    const sections = priceFirstSections(result, 2);
    expect(ids(sections.others)).toEqual(["l2€", "l4€"]);
    expect(ids(sections.withoutPrice)).toEqual(["l1"]);
  });

  it("les indices restent ceux de la liste complète de l'écran", () => {
    const result = lists("-€", "€", "-");
    const sections = priceFirstSections(result, bestProposalIndex(result));
    for (const { piece: p, index } of [...sections.others, ...sections.shopping, ...sections.words, ...sections.withoutPrice]) {
      expect(allPieces(result)[index]).toBe(p);
    }
  });

  it("la recherche par les mots ajoute à la fin : aucune proposition déjà affichée ne change d'indice", () => {
    const before = lists("--", "", "", true);
    const after = lists("--", "", "€-");
    expect(idAt(after, bestProposalIndex(after))).toBe("w1€");
    allPieces(before).forEach((p, index) => expect(allPieces(after)[index]?.id).toBe(p.id));
  });
});

describe("prix d'abord : place de chaque proposition pour les statistiques du clic", () => {
  it("rang d'origine inchangé, place affichée dans l'ordre « prix d'abord », section « Sans prix »", () => {
    const result = lists("-€-€", "€");
    const placements = clickPlacements(result);
    // Ordre affiché : l2€ (grande carte), l4€, s1€, puis l1 et l3 repliées.
    expect(placements.get(1)).toEqual({ rank: 2, displayed_position: 1, in_no_price_section: false });
    expect(placements.get(3)).toEqual({ rank: 4, displayed_position: 2, in_no_price_section: false });
    expect(placements.get(4)).toEqual({ rank: 5, displayed_position: 3, in_no_price_section: false });
    expect(placements.get(0)).toEqual({ rank: 1, displayed_position: 4, in_no_price_section: true });
    expect(placements.get(2)).toEqual({ rank: 3, displayed_position: 5, in_no_price_section: true });
  });

  it("une place par proposition de l'écran, de 1 à N, et un rang égal à l'ordre du serveur", () => {
    const result = lists("-€--€", "€-", "-€");
    const placements = clickPlacements(result);
    const all = allPieces(result);
    expect(placements.size).toBe(all.length);
    expect([...placements.values()].map((p) => p.displayed_position).sort((a, b) => a - b)).toEqual(all.map((_, i) => i + 1));
    all.forEach((_, index) => expect(placements.get(index)?.rank).toBe(index + 1));
  });

  it("aucun prix nulle part : la place affichée est le rang d'origine, rien dans « Sans prix »", () => {
    const placements = clickPlacements(lists("---", "-"));
    for (const [index, placement] of placements) expect(placement).toEqual({ rank: index + 1, displayed_position: index + 1, in_no_price_section: false });
  });

  it("grande carte d'office sans prix (le complément a un prix plus loin) : elle n'est pas dans « Sans prix »", () => {
    const placements = clickPlacements(lists("--", "-€"));
    expect(placements.get(0)).toEqual({ rank: 1, displayed_position: 1, in_no_price_section: false });
    expect(placements.get(1)).toEqual({ rank: 2, displayed_position: 4, in_no_price_section: true });
  });
});
