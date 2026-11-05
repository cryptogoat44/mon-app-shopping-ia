import { describe, expect, it } from "vitest";
import type { MatchOrigin, ProductMatch, ProductSearch, SearchComplement } from "@monapp/shared-types";
import type { Piece, SpotResult } from "../src/api/types";
import { allPieces } from "../src/lib/result-sections";
import { toSpotResult, withTextSearch } from "../src/lib/spot-result";
import { reopenParams } from "../src/lib/recent-searches";
import {
  bestProposalIndex,
  bigCardLabel,
  chooseCard,
  clickPlacements,
  hasPrice,
  holdCard,
  NO_CHOICE,
  noPriceAnywhere,
  noPriceNoticeShown,
  priceFirstSections,
  startIndexOf,
  startProposalIndex,
  WITHOUT_PRICE_SHOWN_FIRST,
  withoutPriceShown,
  wordsArrivalReveal,
  wordsSortNote,
  type BigCardChoice,
  type StartOptions,
} from "../src/lib/price-first";

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

  it("égalités : à prix égal, l'ordre du serveur décide ; un prix à 0 reste affiché avec les prix", () => {
    const same = { pieces: [piece("l1", null), piece("l2", 20), piece("l3", 20), piece("l4", 10)] };
    expect(idAt(same, bestProposalIndex(same))).toBe("l2");
    expect(ids(priceFirstSections(same, bestProposalIndex(same)).others)).toEqual(["l3", "l4"]);
    // Relecture ORD-8 : un prix à 0 n'est jamais mis en grand d'office (tests plus bas).
    const zero = { pieces: [piece("l1", null), piece("l2", 0)] };
    expect(hasPrice(zero.pieces[1]!)).toBe(true);
    expect(ids(priceFirstSections(zero, 0).others)).toEqual(["l2"]);
  });

  it("recherche visuelle vide (rien trouvé, puis vos mots) : la première du complément, avec ou sans prix", () => {
    expect(bestProposalIndex(lists("", "", "-€"))).toBe(0);
    expect(bestProposalIndex(lists("", "", "€-"))).toBe(0);
  });

  it("aucune proposition : indice 0, et aucune place pour les statistiques", () => {
    expect(bestProposalIndex({ pieces: [] })).toBe(0);
    expect(clickPlacements({ pieces: [] }, 0).size).toBe(0);
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
    const placements = clickPlacements(result, bestProposalIndex(result));
    // Ordre affiché : l2€ (grande carte), l4€, s1€, puis l1 et l3 repliées.
    expect(placements.get(1)).toEqual({ rank: 2, displayed_position: 1, in_no_price_section: false });
    expect(placements.get(3)).toEqual({ rank: 4, displayed_position: 2, in_no_price_section: false });
    expect(placements.get(4)).toEqual({ rank: 5, displayed_position: 3, in_no_price_section: false });
    expect(placements.get(0)).toEqual({ rank: 1, displayed_position: 4, in_no_price_section: true });
    expect(placements.get(2)).toEqual({ rank: 3, displayed_position: 5, in_no_price_section: true });
  });

  it("une place par proposition de l'écran, de 1 à N, et un rang égal à l'ordre du serveur", () => {
    const result = lists("-€--€", "€-", "-€");
    const placements = clickPlacements(result, bestProposalIndex(result));
    const all = allPieces(result);
    expect(placements.size).toBe(all.length);
    expect([...placements.values()].map((p) => p.displayed_position).sort((a, b) => a - b)).toEqual(all.map((_, i) => i + 1));
    all.forEach((_, index) => expect(placements.get(index)?.rank).toBe(index + 1));
  });

  it("aucun prix nulle part : la place affichée est le rang d'origine, rien dans « Sans prix »", () => {
    const placements = clickPlacements(lists("---", "-"), 0);
    for (const [index, placement] of placements) expect(placement).toEqual({ rank: index + 1, displayed_position: index + 1, in_no_price_section: false });
  });

  it("grande carte d'office sans prix (le complément a un prix plus loin) : elle n'est pas dans « Sans prix »", () => {
    const placements = clickPlacements(lists("--", "-€"), bestProposalIndex(lists("--", "-€")));
    expect(placements.get(0)).toEqual({ rank: 1, displayed_position: 1, in_no_price_section: false });
    expect(placements.get(1)).toEqual({ rank: 2, displayed_position: 4, in_no_price_section: true });
  });
});

// ---- Corrections de la relecture (2026-11-05) ----

/** Une proposition telle que le serveur l'envoie (recherche relue ou réponse des mots). */
function match(id: string, price: number | null, origin?: "words" | "shopping", currency = "EUR"): ProductMatch {
  return {
    id,
    rank: 1,
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

function searchOf(matches: ProductMatch[], complement?: SearchComplement, extra: Partial<ProductSearch> = {}): ProductSearch {
  return {
    id: "s1",
    sourceUrl: null,
    sourcePlatform: "photo",
    method: "manual_screenshot",
    thumbnailUrl: null,
    status: "completed",
    errorMessage: null,
    query: null,
    createdAt: "2026-11-05T10:00:00Z",
    matches,
    ...(complement ? { complement } : {}),
    ...extra,
  };
}

const FR: StartOptions = { country: "fr" };
// Cas de la relecture (E1, ORD-1, F1, E3) : 6 propositions Lens sans prix, « Que
// cherchez-vous ? » proposé, pas de section « boutiques » ; vos mots ramènent des prix.
const LENS6 = ["l1", "l2", "l3", "l4", "l5", "l6"].map((id) => match(id, null));
const WORDS4 = [match("w1", 74, "words"), match("w2", 99, "words"), match("w3", 45, "words"), match("w4", 120, "words")];
const launched = toSpotResult(searchOf(LENS6, { status: "no_query", suggestText: true, textStatus: null }));
// Réponse des mots, ou la même recherche relue après « Annuler », un 409 ou une panne (recoverTextSearch).
const replied = searchOf([...LENS6, ...WORDS4], { status: "no_query", suggestText: false, textStatus: "shown" });
const afterWords = withTextSearch(launched, replied);

/** Ce que result.tsx met en grand pour un geste donné. */
const bigCard = (choice: BigCardChoice, result: SpotResult, options: StartOptions = FR) => allPieces(result)[choice.chosen ?? startIndexOf(choice, result, options)]?.id;

describe("relecture ORD-1, E1, F1 (et F7) : agir sur la grande carte la retient", () => {
  it("sans aucun geste, la grande carte suit la règle quand vos mots répondent (cas limite annoncé)", () => {
    expect(bigCard(NO_CHOICE, launched)).toBe("l1");
    expect(bigCard(NO_CHOICE, afterWords)).toBe("w1");
  });

  it("« Je l'ai achetée », « … », Garder, Partager ou « Voir chez … » touché : vos mots ne la changent plus, relecture comprise", () => {
    const held = holdCard(NO_CHOICE, startIndexOf(NO_CHOICE, launched, FR));
    expect(held).toEqual({ chosen: 0, start: 0, placement: null });
    // La feuille ouverte (Vault, signalement) et le lien de secours visent toujours l1.
    expect(bigCard(held, afterWords)).toBe("l1");
    // Relue après « Annuler » ou un 409 : la même recherche, le même résultat.
    expect(bigCard(held, withTextSearch(launched, structuredClone(replied)))).toBe("l1");
    // Une seconde action ne change rien.
    expect(holdCard(held, 6)).toBe(held);
  });

  it("une carte touchée reste en grand ; agir dessus ensuite ne la remplace pas", () => {
    const chosen = chooseCard(NO_CHOICE, 2, 0, { rank: 3, displayed_position: 3, in_no_price_section: false });
    expect(bigCard(chosen, afterWords)).toBe("l3");
    expect(holdCard(chosen, 0)).toBe(chosen);
  });
});

describe("relecture E3 et E2 : quand vos mots répondent, l'écran montre ce qui a changé", () => {
  it("E3 : sans geste, la grande carte change d'elle-même — l'écran remonte la montrer", () => {
    expect(wordsArrivalReveal(launched, afterWords, NO_CHOICE, FR)).toBe("hero");
  });

  it("E2 : la grande carte ne change pas — l'écran descend sur « Résultats pour vos mots »", () => {
    expect(wordsArrivalReveal(launched, afterWords, holdCard(NO_CHOICE, 0), FR)).toBe("words");
    // Une proposition Lens a un prix : les mots ne passent jamais devant, la grande carte reste.
    const priced = [match("l1", null), match("l2", 59), ...LENS6.slice(2)];
    const before = toSpotResult(searchOf(priced, { status: "no_query", suggestText: true, textStatus: null }));
    const after = withTextSearch(before, searchOf([...priced, ...WORDS4], { status: "no_query", suggestText: false, textStatus: "shown" }));
    expect(bigCard(NO_CHOICE, after)).toBe("l2");
    expect(wordsArrivalReveal(before, after, NO_CHOICE, FR)).toBe("words");
    // Rien pour les mots (« empty ») : la phrase de la section est montrée de même.
    const empty = withTextSearch(before, searchOf(priced, { status: "no_query", suggestText: false, textStatus: "empty" }));
    expect(wordsArrivalReveal(before, empty, NO_CHOICE, FR)).toBe("words");
  });

  it("bornes de la bascule : 1re des mots sans prix, ou section « boutiques » avec prix déjà en grand — rien ne change en haut", () => {
    const wordsWithoutPrice = withTextSearch(launched, searchOf([...LENS6, match("w1", null, "words"), ...WORDS4.slice(1)], { status: "no_query", suggestText: false, textStatus: "shown" }));
    expect(bigCard(NO_CHOICE, wordsWithoutPrice)).toBe("l1");
    expect(wordsArrivalReveal(launched, wordsWithoutPrice, NO_CHOICE, FR)).toBe("words");
    const shops = [match("s1", 79, "shopping"), match("s2", 85, "shopping")];
    const before = toSpotResult(searchOf([...LENS6, ...shops], { status: "shown", suggestText: true, textStatus: null }));
    const after = withTextSearch(before, searchOf([...LENS6, ...shops, ...WORDS4], { status: "shown", suggestText: false, textStatus: "shown" }));
    expect([bigCard(NO_CHOICE, before), bigCard(NO_CHOICE, after)]).toEqual(["s1", "s1"]);
    expect(wordsArrivalReveal(before, after, NO_CHOICE, FR)).toBe("words");
  });

  it("après « rien trouvé », l'écran s'ouvre en haut, sur la grande carte : rien à faire", () => {
    const nothing = toSpotResult(searchOf([], { status: "no_query", suggestText: true, textStatus: null }, { status: "failed", errorMessage: "Aucun produit identifié sur cette image." }));
    const words = withTextSearch(nothing, searchOf(WORDS4, { status: "no_query", suggestText: false, textStatus: "shown" }));
    expect(wordsArrivalReveal(nothing, words, NO_CHOICE, FR)).toBeNull();
  });
});

describe("relecture ORD-6, F6 : statistiques du clic dans la disposition de l'écran", () => {
  it("grande carte retenue, puis vos mots : elle garde la place 1, la 1re des mots prend sa place dans sa section", () => {
    const held = holdCard(NO_CHOICE, 0);
    const placements = clickPlacements(afterWords, startIndexOf(held, afterWords, FR));
    expect(placements.get(0)).toEqual({ rank: 1, displayed_position: 1, in_no_price_section: false });
    expect(placements.get(6)).toEqual({ rank: 7, displayed_position: 2, in_no_price_section: false });
  });

  it("carte touchée avant la réponse des mots : elle garde la place où elle a été trouvée", () => {
    const start = startIndexOf(NO_CHOICE, launched, FR);
    const found = clickPlacements(launched, start).get(2);
    expect(found).toEqual({ rank: 3, displayed_position: 3, in_no_price_section: false });
    const chosen = chooseCard(NO_CHOICE, 2, start, found);
    // Les mots ont replié les Lens sans prix : la place notée au toucher reste celle envoyée.
    expect(clickPlacements(afterWords, startIndexOf(chosen, afterWords, FR)).get(2)?.in_no_price_section).toBe(true);
    expect(chosen.placement).toEqual(found);
  });

  it("sans geste, la disposition est celle de l'écran : la 1re des mots en grand, place 1", () => {
    const placements = clickPlacements(afterWords, startIndexOf(NO_CHOICE, afterWords, FR));
    expect(placements.get(6)).toEqual({ rank: 7, displayed_position: 1, in_no_price_section: false });
    expect(placements.get(0)?.in_no_price_section).toBe(true);
  });
});

describe("relecture ORD-4 : un prix dans la devise du pays d'abord", () => {
  // Cas du maillot (réponse Lens enregistrée) : rang 6 en $US, 1er prix en euros au rang 7.
  const maillot: Lists = {
    pieces: [piece("l1", null), piece("l2", null), piece("l3", null), piece("l4", null), piece("l5", null), { ...piece("l6", 38), currency: "$US" }, piece("l7", 29), piece("l8", null)],
  };

  it("un prix en euros passe devant un prix en $US ou $MX mieux classé ; la place 1 suit la grande carte", () => {
    expect(idAt(maillot, bestProposalIndex(maillot, "fr"))).toBe("l7");
    expect(clickPlacements(maillot, bestProposalIndex(maillot, "fr")).get(6)).toEqual({ rank: 7, displayed_position: 1, in_no_price_section: false });
    const tshirt: Lists = { pieces: [piece("l1", null), { ...piece("l2", 269), currency: "$MX" }, piece("l3", null), piece("l4", 120)] };
    expect(idAt(tshirt, bestProposalIndex(tshirt, "fr"))).toBe("l4");
    // La boutique à l'étranger reste dans « Autres propositions », dans son ordre.
    expect(ids(priceFirstSections(tshirt, 3).others)).toEqual(["l2"]);
  });

  it("que des prix étrangers : la 1re avec un prix, comme avant", () => {
    const foreign: Lists = { pieces: [piece("l1", null), { ...piece("l2", 269), currency: "$MX" }, { ...piece("l3", 38), currency: "$US" }] };
    expect(idAt(foreign, bestProposalIndex(foreign, "fr"))).toBe("l2");
  });

  it("pays dont la devise n'est pas connue, ou sans pays : rien ne change", () => {
    expect(idAt(maillot, bestProposalIndex(maillot, "de"))).toBe("l6");
    expect(idAt(maillot, bestProposalIndex(maillot))).toBe("l6");
    // En anglais (États-Unis), le prix en $US est le prix du pays.
    expect(idAt(maillot, bestProposalIndex(maillot, "us"))).toBe("l6");
  });
});

describe("relecture ORD-8 : un prix à 0 n'est jamais mis en grand d'office", () => {
  it("il reste affiché parmi les propositions avec prix, mais la grande carte est la suivante, ou la 1re", () => {
    const zero: Lists = { pieces: [piece("l1", null), piece("l2", 0), piece("l3", 89)] };
    expect(idAt(zero, bestProposalIndex(zero, "fr"))).toBe("l3");
    expect(ids(priceFirstSections(zero, 2).others)).toEqual(["l2"]);
    expect(bestProposalIndex({ pieces: [piece("l1", null), piece("l2", 0)] }, "fr")).toBe(0);
    // Pareil dans le complément.
    expect(bestProposalIndex(lists("--", "-"), "fr")).toBe(0);
    const shop: Lists = { pieces: [piece("l1", null)], complement: { shopping: [piece("s1", 0, "shopping")], words: [], status: "shown", query: null, suggestText: false, textStatus: null } };
    expect(bestProposalIndex(shop, "fr")).toBe(0);
  });
});

describe("relecture ORD-3 et F2 : un résultat rouvert", () => {
  // Rang 1 sans prix (la vignette de « Récemment spottées »), rangs 3 et 5 avec prix.
  const reread = (owned?: SpotResult["owned"]): SpotResult => ({
    ...toSpotResult(searchOf([match("h1", null), match("h2", null), match("h3", 89.9), match("h4", null), match("h5", 120)])),
    ...(owned ? { owned } : {}),
  });

  it("F2 : la proposition de la vignette touchée est la grande carte, « Meilleure proposition »", () => {
    const result = reread({ kept: [], bought: [] });
    const entry = { searchId: "s1", createdAt: "2026-11-04T10:00:00Z", piece: allPieces(result)[0]! };
    expect(reopenParams(entry)).toEqual({ searchId: "s1", matchId: "h1" });
    const start = startProposalIndex(result, { ...FR, matchId: reopenParams(entry).matchId });
    expect(idAt(result, start)).toBe("h1");
    expect(bigCardLabel(start, bestProposalIndex(result, "fr"))).toBe("best");
    // La meilleure avec prix est la 1re des « Autres propositions » ; rien d'autre ne change.
    expect(ids(priceFirstSections(result, start).others)).toEqual(["h3", "h5"]);
    // Sans vignette (page rechargée), ou une vignette absente du résultat : la règle.
    expect(idAt(result, startProposalIndex(result, FR))).toBe("h3");
    expect(idAt(result, startProposalIndex(result, { ...FR, matchId: "inconnue" }))).toBe("h3");
  });

  it("ORD-3 : une pièce déjà gardée ou achetée passe devant, la mieux classée d'abord", () => {
    expect(idAt(reread({ kept: ["h1"], bought: ["h1"] }), startProposalIndex(reread({ kept: ["h1"], bought: ["h1"] }), FR))).toBe("h1");
    const two = reread({ kept: ["h4"], bought: ["h2"] });
    expect(idAt(two, startProposalIndex(two, FR))).toBe("h2");
    // La grande carte « prix d'abord » est déjà gardée : elle reste.
    const best = reread({ kept: ["h3"], bought: ["h1"] });
    expect(idAt(best, startProposalIndex(best, FR))).toBe("h3");
    // Vignette gardée : elle ; vignette non gardée mais une autre l'est : celle-là.
    expect(idAt(two, startProposalIndex(two, { ...FR, matchId: "h1" }))).toBe("h2");
    // Le libellé « Meilleure proposition avec prix » reste à la règle.
    expect(bigCardLabel(3, bestProposalIndex(two, "fr"))).toBe("other");
  });

  it("ORD-3 : vos mots, lancés depuis le résultat rouvert, ne font pas perdre la pièce gardée", () => {
    const before: SpotResult = {
      ...toSpotResult(searchOf([match("h1", null), match("h2", 59)], { status: "no_query", suggestText: true, textStatus: null })),
      owned: { kept: ["h1"], bought: [] },
    };
    const after = withTextSearch(before, searchOf([match("h1", null), match("h2", 59), match("w1", 30, "words")], { status: "no_query", suggestText: false, textStatus: "shown" }));
    expect(after.owned).toEqual({ kept: ["h1"], bought: [] });
    expect(idAt(after, startProposalIndex(after, FR))).toBe("h1");
    expect(wordsArrivalReveal(before, after, NO_CHOICE, FR)).toBe("words");
  });
});

describe("relecture E4 : le libellé de la grande carte", () => {
  it("« Meilleure proposition » pour la première ; « … avec prix » quand le prix en a fait passer d'autres derrière", () => {
    expect(bigCardLabel(0, 0)).toBe("best");
    expect(bigCardLabel(8, 8)).toBe("bestWithPrice");
    expect(bigCardLabel(3, 8)).toBe("other");
    // La première touchée dans la section repliée : la plus proche selon la recherche, comme avant le lot.
    expect(bigCardLabel(0, 8)).toBe("best");
    // Lens toutes sans prix, une boutique avec prix en grand : « avec prix ».
    const shops = lists("----------", "€");
    expect(bigCardLabel(bestProposalIndex(shops, "fr"), bestProposalIndex(shops, "fr"))).toBe("bestWithPrice");
  });
});

describe("relecture F3 et ORD-7 : le message « aucun prix » suit la grande carte d'office", () => {
  const notice = (result: Lists) => noPriceNoticeShown(result, bestProposalIndex(result, "fr"));

  it("Lens sans prix, la 1re du complément sans prix (une suivante en a un) : la grande carte n'a pas de prix, le message reste", () => {
    expect(notice(lists("---", "-€"))).toBe(true);
    expect(notice(lists("---", "", "-€"))).toBe(true);
  });

  it("une boutique avec prix en grand : pas de message, toutes les Lens repliées ; rien nulle part : le message, comme avant", () => {
    expect(notice(lists("---", "€-"))).toBe(false);
    expect(priceFirstSections(lists("---", "€-"), 3).withoutPrice).toHaveLength(3);
    expect(notice(lists("---"))).toBe(true);
    expect(notice(lists("-€-", "-€"))).toBe(false);
    expect(notice(lists("", "-€"))).toBe(false);
  });
});

describe("relecture F4 : le texte du tri par les mots dit l'ordre réel", () => {
  it("grande carte d'office = la 1re de l'écran : « Triées selon vos mots » ; une autre : prix d'abord, puis vos mots", () => {
    expect(wordsSortNote({ sortedByWords: true }, 0)).toBe("words");
    expect(wordsSortNote({ sortedByWords: true }, 2)).toBe("priceThenWords");
    expect(wordsSortNote({ sortedByWords: false }, 2)).toBeNull();
    expect(wordsSortNote({}, 0)).toBeNull();
    // Vestes sans prix remontées par « veste », blouson à 79 € : le blouson en grand.
    const vestes: Lists = { pieces: [piece("veste-1", null), piece("veste-2", null), piece("blouson", 79)] };
    expect(wordsSortNote({ sortedByWords: true }, bestProposalIndex(vestes, "fr"))).toBe("priceThenWords");
  });
});

describe("relecture E6 : la section « Sans prix » dépliée montre 12 cartes, puis « Voir plus »", () => {
  it("39 propositions : 12 d'emblée, 27 derrière « Voir plus » ; toutes ensuite", () => {
    const folded = lists("-".repeat(39) + "€");
    const { withoutPrice } = priceFirstSections(folded, bestProposalIndex(folded, "fr"));
    expect(withoutPrice).toHaveLength(39);
    expect(WITHOUT_PRICE_SHOWN_FIRST).toBe(12);
    const first = withoutPriceShown(withoutPrice, false);
    expect(first.visible.map(({ index }) => index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(first.hiddenCount).toBe(27);
    expect(withoutPriceShown(withoutPrice, true)).toEqual({ visible: withoutPrice, hiddenCount: 0 });
  });
});
