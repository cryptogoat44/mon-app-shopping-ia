// Fiabilité des résultats, phase 1 : les filtres rejoués sur de VRAIES
// réponses de Google Lens, enregistrées le 2026-09-24 et le 2026-10-21 sur
// spotto-dev (tests/fixtures/serpapi, voir LISEZ-MOI.md). Aucun appel réel à
// SerpApi : safeFetch est remplacé et renvoie la réponse enregistrée.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

vi.mock("../src/lib/safeFetch.js", () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from "../src/lib/safeFetch.js";
import { exclusionReason } from "../src/services/matchFilters.js";
import { searchProductsByImageUrl, type SearchLocale } from "../src/services/visualSearch.js";

const safeFetchMock = vi.mocked(safeFetch);

const RECORDED = z.object({
  visual_matches: z.array(z.object({ position: z.number(), title: z.string(), link: z.string() }).passthrough()),
});
type RecordedMatch = z.infer<typeof RECORDED>["visual_matches"][number];

function fixture(file: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/serpapi/${file}`, import.meta.url), "utf8"));
}

/** Zone recadrée sur la veste, sans texte : 60 propositions. */
const ZONE = RECORDED.parse(fixture("lens-veste-daim-zone.json")).visual_matches;
/** Même zone, avec « veste en daim marron » : 60 propositions. */
const ZONE_TEXTE = RECORDED.parse(fixture("lens-veste-daim-zone-texte.json")).visual_matches;

function at(matches: RecordedMatch[], position: number): RecordedMatch {
  const match = matches.find((m) => m.position === position);
  if (!match) throw new Error(`Position ${position} absente de la réponse enregistrée`);
  return match;
}

function fakeFastify(): FastifyInstance {
  return { log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } } as unknown as FastifyInstance;
}

async function replayWithMeasure(body: unknown, locale?: SearchLocale) {
  safeFetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  return searchProductsByImageUrl(fakeFastify(), "https://example.com/zone.jpg", locale ? { locale } : {});
}

async function replay(body: unknown, locale?: SearchLocale) {
  return (await replayWithMeasure(body, locale)).matches;
}

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe("réponses enregistrées de Google Lens : filtres sans risque pour un résultat valide", () => {
  it("vente aux professionnels (Faire) écartée ; les 6 premières restent à leur place ; les rangs se suivent", async () => {
    expect(ZONE.filter((m) => exclusionReason(m.link) === "professional").map((m) => m.position)).toEqual([21]);
    const { matches: results, addedRanks } = await replayWithMeasure({ visual_matches: ZONE });

    expect(results.some((r) => exclusionReason(r.merchantUrl) !== null)).toBe(false);
    // Au-delà des 6 premières, la règle des prix classe par proximité (devise, pays) : l'ordre de Google n'y est plus gardé.
    expect(results.slice(0, 6).map((r) => r.merchantUrl)).toEqual(ZONE.slice(0, 6).map((m) => m.link));
    expect(results.map((r) => r.rank)).toEqual(results.map((_, index) => index + 1));
    expect(results).toHaveLength(30 + addedRanks.length);
  });

  it("même article sur zalando.ch et zalando.fr : une seule proposition, le site français", async () => {
    const swiss = at(ZONE, 11);
    const french = at(ZONE, 42);
    const results = await replay({ visual_matches: ZONE });

    expect(results.filter((r) => r.merchantUrl === swiss.link || r.merchantUrl === french.link).map((r) => r.productName)).toEqual([french.title]);
  });

  it("même article, sans site du pays de la recherche (anglais, États-Unis) : la première apparition reste", async () => {
    const results = await replay({ visual_matches: ZONE }, { hl: "en", country: "us" });

    expect(results.some((r) => r.merchantUrl === at(ZONE, 11).link)).toBe(true);
    expect(results.some((r) => r.merchantUrl === at(ZONE, 42).link)).toBe(false);
  });

  it("sites d'autres pays sans équivalent dans la réponse (zalando.co.uk, zalando.es) : gardés", async () => {
    const zalando = ZONE.filter((m) => new URL(m.link).hostname.includes("zalando"));
    const results = await replay({ visual_matches: zalando });

    expect(results.map((r) => r.merchantUrl)).toEqual([3, 42, 37, 38, 39, 51, 60].map((position) => at(ZONE, position).link));
  });

  it("deux titres identiques chez le même marchand, à des adresses différentes : gardés tous les deux (variantes possibles)", async () => {
    const pairs = [at(ZONE_TEXTE, 23), at(ZONE_TEXTE, 50), at(ZONE_TEXTE, 35), at(ZONE_TEXTE, 49)];
    expect(pairs[0]!.title).toBe(pairs[1]!.title);
    expect(pairs[2]!.title).toBe(pairs[3]!.title);

    expect(await replay({ visual_matches: pairs })).toHaveLength(4);
  });

  it("réseaux sociaux (TikTok, Instagram) écartés dans la réponse avec texte", async () => {
    expect(ZONE_TEXTE.filter((m) => exclusionReason(m.link) === "social").map((m) => m.position)).toEqual([17, 57]);
    const results = await replay({ visual_matches: ZONE_TEXTE });

    expect(results.some((r) => exclusionReason(r.merchantUrl) !== null)).toBe(false);
    expect(results[0]!.merchantUrl).toBe(at(ZONE_TEXTE, 1).link);
  });

  it("défaut corrigé : un lien Pinterest est écarté, quelle que soit son extension", async () => {
    const social = at(ZONE_TEXTE, 17);
    const pins = ["https://www.pinterest.fr/pin/1/", "https://pinterest.com/pin/2/", "https://www.pinterest.co.uk/pin/3/"].map((link, index) => ({
      ...social,
      position: 101 + index,
      link,
    }));
    const results = await replay({ visual_matches: [...pins, at(ZONE_TEXTE, 1)] });

    expect(results.map((r) => r.merchantUrl)).toEqual([at(ZONE_TEXTE, 1).link]);
  });

  it("réponse complétée : un lien qui ne diffère que par des paramètres de suivi est la même page ; une autre couleur, non", async () => {
    const original = at(ZONE, 12);
    expect(original.link).toContain("?colour=chocolate");
    const withTracking = { ...original, position: 61, link: `${original.link}&utm_source=google&srsltid=AfmBOo` };
    const otherColour = { ...original, position: 62, link: original.link.replace("colour=chocolate", "colour=black") };

    const results = await replay({ visual_matches: [original, withTracking, otherColour] });
    expect(results.map((r) => r.merchantUrl)).toEqual([original.link, otherColour.link]);
  });

  it("réponse complétée de valeurs étranges : chaque proposition reste, sans prix si besoin, et les autres ne bougent pas", async () => {
    const [a, b, c, d] = [at(ZONE, 4), at(ZONE, 5), at(ZONE, 6), at(ZONE, 10)];
    const odd = [
      { ...a, price: { value: "1 990 руб.", extracted_value: 1990, currency: "руб." } },
      { ...b, price: { value: "39 €", extracted_value: 39, currency: " € " } },
      { ...c, price: { value: "1 000 000 000 000 €", extracted_value: 1e12, currency: "€" } },
      { ...d, title: `${d.title}\u0000` },
    ];

    const results = await replay({ visual_matches: odd });
    expect(results.map((r) => [r.rank, r.merchantUrl, r.priceValue, r.currency])).toEqual([
      [1, a.link, null, null],
      [2, b.link, 39, "€"],
      [3, c.link, null, null],
      [4, d.link, 70, "€"],
    ]);
    expect(results[3]!.productName).toBe(d.title);
  });

  it("mesure d'un extrait de réponse enregistrée : reçues, écartées par motif, gardées, prix, autre devise, sites, rubriques", async () => {
    const extract = [...ZONE.filter((m) => new URL(m.link).hostname.includes("zalando")), at(ZONE, 21), at(ZONE, 54), at(ZONE_TEXTE, 17)];
    const { matches, measure } = await replayWithMeasure({ visual_matches: extract });

    expect(matches).toHaveLength(8);
    expect(measure).toEqual({
      received: 11,
      removedIncomplete: 0,
      removedSocial: 1,
      removedProfessional: 1,
      removedDuplicates: 1,
      kept: 8,
      keptWithPrice: 2,
      keptOtherCurrency: 1,
      distinctSites: 4,
      sections: ["visual_matches"],
      googleState: null,
    });
  });

  it("mesure de la réponse vide enregistrée : rien reçu, aucune rubrique, Google la dit « vide »", async () => {
    const { measure } = await replayWithMeasure(fixture("lens-vignette-entiere-vide.json"));
    expect(measure).toMatchObject({ received: 0, kept: 0, sections: [], googleState: "empty" });
  });

  it("réponse enregistrée vide (« Fully empty ») : recherche vide, jamais une panne", async () => {
    await expect(replay(fixture("lens-vignette-entiere-vide.json"))).resolves.toEqual([]);
  });
});

describe("réponses réelles du 21 octobre (« visual_matches », 4 pièces du fondateur) : rejouées", () => {
  // Avant la règle des prix, l'essai avait gardé 30, 30, 30 et 8 propositions,
  // dont 12, 5, 7 et 0 avec un prix. Avec la règle (petit lot), on retrouve
  // exactement les chiffres de la conception du 21 octobre
  // (docs/conception-apres-correction-2026-10-21.md, section 2).
  const euros = (currency: string | null) => currency === "€" || currency === "EUR";
  it.each([
    ["lens-visual-veste-bleu-marine.json", { received: 60, removedSocial: 0, kept: 40, keptWithPrice: 22 }, { ecranPrix: 9, ecranEuros: 9 }, [32, 36, 37, 38, 46, 47, 51, 52, 53, 55]],
    ["lens-visual-tshirt-blanc.json", { received: 60, removedSocial: 0, kept: 33, keptWithPrice: 8 }, { ecranPrix: 5, ecranEuros: 1 }, [43, 48, 57]],
    ["lens-visual-maillot-nike.json", { received: 60, removedSocial: 4, kept: 38, keptWithPrice: 15 }, { ecranPrix: 7, ecranEuros: 6 }, [42, 43, 44, 45, 54, 55, 59, 60]],
    ["lens-visual-pull-noir.json", { received: 60, removedSocial: 52, kept: 8, keptWithPrice: 0 }, { ecranPrix: 0, ecranEuros: 0 }, []],
  ])("%s : gardées et prix avec la règle des prix ; premier écran (12) ; rangs d'origine des ajouts", async (file, attendu, ecran, ajouts) => {
    const { matches, measure, addedRanks } = await replayWithMeasure(fixture(file), { country: "fr", hl: "fr" });
    expect(measure).toMatchObject(attendu);
    const premierEcran = matches.slice(0, 12).filter((m) => m.priceValue !== null);
    expect({ ecranPrix: premierEcran.length, ecranEuros: premierEcran.filter((m) => euros(m.currency)).length }).toEqual(ecran);
    expect(addedRanks).toEqual(ajouts);
    expect(matches.map((m) => m.rank)).toEqual(matches.map((_, i) => i + 1));
  });

  it("les 6 premières de Google restent à leur place", async () => {
    const reponse = RECORDED.parse(fixture("lens-visual-veste-bleu-marine.json")).visual_matches;
    const matches = await replay({ visual_matches: reponse }, { country: "fr", hl: "fr" });
    expect(matches.slice(0, 6).map((m) => m.merchantUrl)).toEqual(reponse.slice(0, 6).map((m) => m.link));
  });

  it("le type « products », abandonné le 9 octobre : erreur de SerpApi (400), une panne, jamais « rien trouvé »", async () => {
    safeFetchMock.mockResolvedValueOnce(new Response(JSON.stringify(fixture("lens-products-abandonne-400.json")), { status: 400, headers: { "content-type": "application/json" } }));
    await expect(searchProductsByImageUrl(fakeFastify(), "https://example.com/zone.jpg")).rejects.toMatchObject({ name: "LensCallError", kind: "serpapi_error" });
  });
});

describe("exclusionReason", () => {
  it("reconnaît les sites, pas les noms qui leur ressemblent", () => {
    expect(exclusionReason("https://www.faire.com/fr-ca/product/p_1")).toBe("professional");
    expect(exclusionReason("https://faire.com/")).toBe("professional");
    expect(exclusionReason("https://notfaire.com/veste")).toBeNull();
    expect(exclusionReason("https://fr.pinterest.com/pin/1/")).toBe("social");
    expect(exclusionReason("https://pinterest.example.com/veste")).toBeNull();
    expect(exclusionReason("pas une adresse")).toBeNull();
  });
});
