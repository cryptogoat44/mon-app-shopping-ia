// Fiabilité des résultats, phase 1 : les filtres rejoués sur de VRAIES
// réponses de Google Lens, enregistrées le 2026-09-24 sur spotto-dev
// (tests/fixtures/serpapi, voir LISEZ-MOI.md). Aucun appel réel à SerpApi :
// safeFetch est remplacé et renvoie la réponse enregistrée.
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

async function replay(body: unknown, locale?: SearchLocale) {
  safeFetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  return searchProductsByImageUrl(fakeFastify(), "https://example.com/zone.jpg", locale ? { locale } : {});
}

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe("réponses enregistrées de Google Lens : filtres sans risque pour un résultat valide", () => {
  it("vente aux professionnels (Faire) écartée ; l'ordre de Google est conservé, les rangs se suivent", async () => {
    expect(ZONE.filter((m) => exclusionReason(m.link) === "professional").map((m) => m.position)).toEqual([21]);
    const results = await replay({ visual_matches: ZONE });

    expect(results.some((r) => exclusionReason(r.merchantUrl) !== null)).toBe(false);
    expect(results.slice(0, 10).map((r) => r.merchantUrl)).toEqual(ZONE.slice(0, 10).map((m) => m.link));
    expect(results.map((r) => r.rank)).toEqual(results.map((_, index) => index + 1));
    expect(results).toHaveLength(30);
  });

  it("même article sur zalando.ch et zalando.fr : une seule proposition, le site français, à la place de la première apparition", async () => {
    const swiss = at(ZONE, 11);
    const french = at(ZONE, 42);
    const results = await replay({ visual_matches: ZONE });

    expect(results[10]).toMatchObject({ rank: 11, merchantUrl: french.link, productName: french.title });
    expect(results.filter((r) => r.merchantUrl === swiss.link || r.merchantUrl === french.link)).toHaveLength(1);
  });

  it("même article, sans site du pays de la recherche (anglais, États-Unis) : la première apparition reste", async () => {
    const results = await replay({ visual_matches: ZONE }, { hl: "en", country: "us" });

    expect(results[10]!.merchantUrl).toBe(at(ZONE, 11).link);
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

  it("réponse enregistrée vide (« Fully empty ») : recherche vide, jamais une panne", async () => {
    await expect(replay(fixture("lens-vignette-entiere-vide.json"))).resolves.toEqual([]);
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
