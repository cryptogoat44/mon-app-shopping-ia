import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProductMatch, ProductSearch, SearchVerdict } from "@monapp/shared-types";
import type { SpotResult } from "../src/api/types";
import { APP_NAME_DISPLAY as BRAND } from "../src/constants/brand";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { termsOfUse } from "../src/legal/conditions";
import { termsOfUseEn } from "../src/legal/conditions.en";
import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";
import { formatPrice } from "../src/lib/format";
import { allPieces } from "../src/lib/result-sections";
import { toSpotResult, withTextSearch } from "../src/lib/spot-result";
import { withShops } from "../src/lib/spot-shops";
import { parseVerdict, verdictSentence, verdictToTrack } from "../src/lib/verdict";

// Le verdict (lot « verdict ») côté app : la phrase de tête de l'écran
// Résultat, décidée par le serveur (apps/backend/src/lib/verdict.ts) d'après
// les titres des boutiques. L'app relit le champ, écrit la phrase, l'annonce,
// ouvre la feuille, envoie verdict_shown — et ne change l'ordre de rien.

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

const match = (id: string, extra: Partial<ProductMatch> = {}): ProductMatch =>
  ({
    id,
    rank: Number(id.replace(/\D/g, "")) || 1,
    productName: `Veste ${id}`,
    brand: null,
    imageUrl: `https://boutique.test/${id}.jpg`,
    imageHdUrl: null,
    priceMin: 70,
    priceMax: 70,
    currency: "EUR",
    merchantName: "Boutique",
    merchantUrl: `https://boutique.test/${id}`,
    affiliateUrl: `https://boutique.test/${id}`,
    feedbackReason: null,
    ...extra,
  }) as ProductMatch;

const search = (extra: Partial<ProductSearch> = {}): ProductSearch => ({
  id: "recherche-v",
  sourceUrl: null,
  sourcePlatform: "photo",
  method: "manual_screenshot",
  status: "completed",
  errorMessage: null,
  query: null,
  createdAt: "2026-11-22T10:00:00.000Z",
  matches: [match("m1"), match("m2", { origin: "shopping" }), match("m3", { origin: "shopping" })],
  complement: { status: "shown", suggestText: false, textStatus: null },
  ...extra,
});

const IDENTIFIED: SearchVerdict = { level: "identified", shopCount: 7, priceRange: { min: 59, max: 89, currency: "EUR" } };

describe("la réponse du serveur : seulement un verdict d'une forme connue", () => {
  it("permis : les trois niveaux ; le nombre et la fourchette avec « identified »", () => {
    expect(parseVerdict(IDENTIFIED)).toEqual(IDENTIFIED);
    expect(parseVerdict({ level: "identified", shopCount: 2 })).toEqual({ level: "identified", shopCount: 2 });
    expect(parseVerdict({ level: "close" })).toEqual({ level: "close" });
    expect(parseVerdict({ level: "lookalikes" })).toEqual({ level: "lookalikes" });
    // Ce qui n'a pas de sens pour un niveau est laissé de côté.
    expect(parseVerdict({ level: "close", shopCount: 4, priceRange: { min: 1, max: 2, currency: "EUR" } })).toEqual({ level: "close" });
  });

  it("refusé : absent (ancien serveur), un niveau inconnu (serveur plus récent), « identified » sans au moins deux boutiques — rien n'est affirmé", () => {
    for (const raw of [undefined, null, "identified", {}, { level: "same_piece" }, { level: "identified" }, { level: "identified", shopCount: 1 }, { level: "identified", shopCount: 2.5 }]) {
      expect(parseVerdict(raw), JSON.stringify(raw)).toBeUndefined();
    }
  });

  it("refusé : une fourchette incohérente (un seul côté, à l'envers, à zéro, devise illisible) n'est pas gardée, le nombre reste", () => {
    for (const priceRange of [{ min: 59 }, { min: 89, max: 59, currency: "EUR" }, { min: 0, max: 59, currency: "EUR" }, { min: 59, max: 89, currency: "€" }, { min: 59, max: 89 }]) {
      expect(parseVerdict({ level: "identified", shopCount: 3, priceRange }), JSON.stringify(priceRange)).toEqual({ level: "identified", shopCount: 3 });
    }
  });
});

describe("les phrases, mot pour mot, en français et en anglais", () => {
  it("permis : « identified » avec la fourchette, d'où et de quand viennent les prix", () => {
    expect(verdictSentence(IDENTIFIED, fr.result.verdict, "fr")).toBe(
      `Pièce identifiée, d'après les titres des boutiques : 7 boutiques, de ${formatPrice(59, "EUR", "fr")} à ${formatPrice(89, "EUR", "fr")} au moment de la recherche.`
    );
    expect(verdictSentence(IDENTIFIED, en.result.verdict, "en")).toBe("Piece identified, based on the shops' listing titles: 7 shops, from €59 to €89 at the time of the search.");
  });

  it("permis : « identified » sans fourchette (prix manquants), ou un même prix partout", () => {
    expect(verdictSentence({ level: "identified", shopCount: 2 }, fr.result.verdict, "fr")).toBe("Pièce identifiée, d'après les titres des boutiques : 2 boutiques.");
    expect(verdictSentence({ level: "identified", shopCount: 2 }, en.result.verdict, "en")).toBe("Piece identified, based on the shops' listing titles: 2 shops.");
    const same: SearchVerdict = { level: "identified", shopCount: 3, priceRange: { min: 70, max: 70, currency: "EUR" } };
    expect(verdictSentence(same, fr.result.verdict, "fr")).toBe(`Pièce identifiée, d'après les titres des boutiques : 3 boutiques, toutes à ${formatPrice(70, "EUR", "fr")} au moment de la recherche.`);
    expect(verdictSentence(same, en.result.verdict, "en")).toBe("Piece identified, based on the shops' listing titles: 3 shops, all at €70 at the time of the search.");
  });

  it("permis : « close » et « lookalikes »", () => {
    expect(verdictSentence({ level: "close" }, fr.result.verdict, "fr")).toBe("Pièce probablement trouvée, d'après les titres des boutiques : vérifiez le modèle avant d'acheter.");
    expect(verdictSentence({ level: "close" }, en.result.verdict, "en")).toBe("Piece probably found, based on the shops' listing titles: check the model before you buy.");
    expect(verdictSentence({ level: "lookalikes" }, fr.result.verdict, "fr")).toBe("Pas de pièce exacte trouvée : voici les plus proches.");
    expect(verdictSentence({ level: "lookalikes" }, en.result.verdict, "en")).toBe("No exact piece found: here are the closest ones.");
  });

  it("la feuille : comment Spotto décide, ce qu'il ne fait pas, « vérifiez toujours avant d'acheter »", () => {
    expect(fr.result.verdict.sheetTitle).toBe("D'après les titres des boutiques");
    expect(en.result.verdict.sheetTitle).toBe("Based on the shops' listing titles");
    expect(fr.result.verdict.how).toBe(
      `${BRAND} lit les titres des offres de « Cette pièce dans d'autres boutiques ». « Pièce identifiée » : au moins deux boutiques connues ou sites officiels de marques, différents, y nomment la même marque et le même modèle. « Pièce probablement trouvée » : la marque concorde, mais pas le modèle, ou dans trop peu de boutiques connues. Sinon, les propositions sont seulement des pièces qui se ressemblent.`
    );
    expect(fr.result.verdict.limits).toBe(
      `${BRAND} ne vérifie ni qu'une pièce est d'origine, ni son état, et cette phrase ne change pas l'ordre des propositions. Les prix sont ceux affichés par les boutiques au moment de la recherche. Vérifiez toujours avant d'acheter.`
    );
    expect(en.result.verdict.how).toBe(
      `${BRAND} reads the titles of the offers in “This piece at other shops”. “Piece identified”: at least two different well-known shops or official brand stores name the same brand and the same model there. “Piece probably found”: the brand matches, but not the model, or in too few well-known shops. Otherwise, the suggestions are only pieces that look alike.`
    );
    expect(en.result.verdict.limits).toBe(
      `${BRAND} checks neither whether a piece is an original nor its condition, and this sentence does not change the order of the suggestions. Prices are those shown by the shops at the time of the search. Always check before you buy.`
    );
    expect([fr.result.verdict.hint, en.result.verdict.hint]).toEqual([`Explique comment ${BRAND} décide.`, `Explains how ${BRAND} decides.`]);
    expect([fr.result.verdict.closeButton, en.result.verdict.closeButton]).toEqual(["J'ai compris", "Got it"]);
  });

  it("refusé : jamais « authentique » ni « promotion », jamais de garantie, de prix barré ni de prix de référence ; toujours « d'après les titres des boutiques » quand la phrase affirme", () => {
    const all = JSON.stringify([fr.result.verdict, en.result.verdict, verdictSentence(IDENTIFIED, fr.result.verdict, "fr"), verdictSentence(IDENTIFIED, en.result.verdict, "en")]);
    expect(all).not.toMatch(/authenti|promotion|promo\b|garanti|guarantee|référence|reference price|barré|vite|hurry|last one/i);
    for (const level of ["identified", "close"] as const) {
      const verdict: SearchVerdict = level === "identified" ? { level, shopCount: 2 } : { level };
      expect(verdictSentence(verdict, fr.result.verdict, "fr")).toContain("d'après les titres des boutiques");
      expect(verdictSentence(verdict, en.result.verdict, "en")).toContain("based on the shops' listing titles");
    }
  });
});

describe("le verdict arrive avec les boutiques : lancement, boutiques ensuite, relecture", () => {
  it("permis : gardé sur le résultat au lancement et à la relecture ; absent, rien", () => {
    expect(toSpotResult(search({ verdict: IDENTIFIED })).verdict).toEqual(IDENTIFIED);
    expect("verdict" in toSpotResult(search())).toBe(false);
    expect("verdict" in toSpotResult(search({ verdict: { level: "same_piece" } as unknown as SearchVerdict }))).toBe(false);
    // Rien trouvé : pas de verdict.
    expect("verdict" in toSpotResult(search({ matches: [], verdict: { level: "lookalikes" } }))).toBe(false);
  });

  it("permis : boutiques ensuite — le verdict de la réponse remplace l'absence d'avant ; refusé : une réponse sans verdict n'en garde aucun", () => {
    const pending: SpotResult = toSpotResult(search({ matches: [match("m1")], complement: { status: null, suggestText: false, textStatus: null, pending: true } }));
    expect(pending.verdict).toBeUndefined();
    const after = withShops(pending, search({ verdict: { level: "close" } }));
    expect(after.verdict).toEqual({ level: "close" });
    expect(after.complement?.late).toBe(true);
    const old = withShops({ ...pending, verdict: { level: "lookalikes" } }, search());
    expect("verdict" in old).toBe(false);
  });

  it("permis : après « Que cherchez-vous ? », celui de la recherche relue", () => {
    const first = toSpotResult(search({ verdict: { level: "close" } }));
    expect(withTextSearch(first, search({ verdict: IDENTIFIED })).verdict).toEqual(IDENTIFIED);
  });

  it("refusé : le verdict ne change ni l'ordre ni le nombre des propositions", () => {
    const without = toSpotResult(search());
    const withVerdict = toSpotResult(search({ verdict: IDENTIFIED }));
    expect(allPieces(withVerdict).map((piece) => piece.id)).toEqual(allPieces(without).map((piece) => piece.id));
    for (const file of ["src/lib/price-first.ts", "src/lib/result-sort.ts", "src/lib/result-sections.ts"]) expect(read(file), file).not.toMatch(/verdict/i);
  });
});

describe("statistiques : verdict_shown { level }", () => {
  it("permis : une fois par résultat affiché, et de nouveau quand le niveau change ; seulement le niveau", () => {
    expect(ANALYTICS_EVENTS.verdict_shown).toEqual({ level: { kind: "enum", values: ["identified", "close", "lookalikes"] } });
    const first = verdictToTrack("r1", { level: "close" }, null);
    expect(first).toEqual({ searchId: "r1", level: "close" });
    expect(verdictToTrack("r1", { level: "close" }, first)).toBeNull();
    expect(verdictToTrack("r1", IDENTIFIED, first)).toEqual({ searchId: "r1", level: "identified" });
    expect(verdictToTrack("r2", { level: "close" }, first)).toEqual({ searchId: "r2", level: "close" });
    expect(sanitizeProps("verdict_shown", { level: "identified", shopCount: 7, merchant: "Boutique", price: 59, platform: "ios" })).toEqual({ level: "identified" });
  });

  it("refusé : sans verdict, rien ; un niveau inconnu n'est jamais envoyé", () => {
    expect(verdictToTrack("r1", undefined, null)).toBeNull();
    expect(sanitizeProps("verdict_shown", { level: "same_piece" })).toEqual({});
  });

  it("l'écran l'envoie par track(), et le mode d'emploi dit comment le lire", () => {
    const screen = read("src/app/(app)/spot/result.tsx");
    expect(screen).toContain('track("verdict_shown", { level: next.level });');
    const doc = read("STATISTIQUES.md");
    for (const words of ["**`verdict_shown`**", "`identified`", "`close`", "`lookalikes`", "`merchant_link_opened`", "`wrong_item`", "title_tier"]) expect(doc, words).toContain(words);
  });
});

describe("l'écran : la phrase en tête, annoncée, touchable, sans rien déplacer", () => {
  it("permis : au-dessus du décompte et de la grande carte ; une zone touchable dont le libellé lu est la phrase", () => {
    const screen = read("src/app/(app)/spot/result.tsx");
    const line = screen.indexOf("<VerdictLine verdict={result.verdict} />");
    expect(line).toBeGreaterThan(-1);
    expect(line).toBeLessThan(screen.indexOf("t.result.count(result.pieces.length, result.query)"));
    expect(line).toBeLessThan(screen.indexOf("{showBigCard ? ("));
    const component = read("src/components/verdict-line.tsx");
    expect(component).toContain("if (!verdict || !sentence) return null;");
    expect(component).toContain('accessibilityRole="button"');
    expect(component).toContain("accessibilityLabel={sentence}");
    expect(component).toContain("accessibilityHint={t.result.verdict.hint}");
    expect(component).toContain('accessibilityLiveRegion="polite"');
    expect(component).toContain("AccessibilityInfo.announceForAccessibilityWithOptions(sentence, { queue: true });");
    // Annoncée quand elle apparaît ou change.
    expect(component).toContain("}, [sentence]);");
  });

  it("la feuille : même forme que celles des mentions, ses deux paragraphes, « J'ai compris » ; tient en grand texte", () => {
    const component = read("src/components/verdict-line.tsx");
    for (const words of ["accessibilityViewIsModal", 'animationType={reduceMotion ? "none" : "slide"}', "{t.result.verdict.how}", "{t.result.verdict.limits}", "{t.result.verdict.closeButton}", "<ScrollView"]) {
      expect(component, words).toContain(words);
    }
    // Ni hauteur fixe ni nombre de lignes : la phrase passe à la ligne (320 points, grand texte).
    expect(component).not.toMatch(/numberOfLines|adjustsFontSizeToFit/);
    for (const style of ["box", "sentence"]) expect(component.match(new RegExp(`^  ${style}: .+$`, "m"))![0], style).not.toMatch(/[^a-zA-Z]height: \d/);
  });
});

describe("conditions d'utilisation : le verdict est indicatif", () => {
  const section = (doc: typeof termsOfUse, title: string) => doc.sections.find((s) => s.title === title)!.blocks.flat().join("\n");

  it("permis : une phrase en français et en anglais, d'après les titres des offres, sans garantie, sans effet sur l'ordre", () => {
    expect(section(termsOfUse, `Ce que fait ${BRAND}`)).toContain(
      "En tête des résultats, une phrase peut dire si la même pièce semble trouvée dans plusieurs boutiques (« Pièce identifiée »), probablement trouvée (« Pièce probablement trouvée »), ou si les propositions sont seulement des pièces qui se ressemblent. Elle est indicative : elle se fonde uniquement sur les titres des offres de « Cette pièce dans d'autres boutiques » (pour « Pièce identifiée », au moins deux boutiques connues ou sites officiels de marques, différents, qui nomment la même marque et le même modèle), ne garantit ni que la pièce est la bonne, ni qu'elle est d'origine, ni son état, et ne change pas l'ordre des propositions."
    );
    expect(section(termsOfUseEn, `What ${BRAND} does`)).toContain(
      "At the top of the results, a sentence may say whether the same piece seems to have been found at several shops (“Piece identified”), probably found (“Piece probably found”), or whether the suggestions are only pieces that look alike. It is indicative only: it is based solely on the titles of the offers in “This piece at other shops” (for “Piece identified”, at least two different well-known shops or official brand stores naming the same brand and the same model), guarantees neither that the piece is the right one, nor that it is an original, nor its condition, and does not change the order of the suggestions."
    );
  });

  it("refusé : la phrase d'avant sur les propositions reste mot pour mot ; jamais « authentique »", () => {
    expect(section(termsOfUse, `Ce que fait ${BRAND}`)).toContain("Ces propositions viennent d'une recherche visuelle automatique : elles peuvent être inexactes ou incomplètes, et une pièce proposée n'est pas forcément celle de l'image.");
    expect(JSON.stringify([termsOfUse, termsOfUseEn])).not.toMatch(/authentique|authentic\b/i);
  });
});
