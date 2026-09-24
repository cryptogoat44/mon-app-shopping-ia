import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// searchProductsByImageUrl ne doit jamais faire de vrai appel réseau en
// test (ni vers SerpApi, ni via la protection SSRF de safeFetch) — on
// remplace safeFetch entièrement et on contrôle chaque réponse simulée.
vi.mock("../src/lib/safeFetch.js", () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from "../src/lib/safeFetch.js";
import { searchProductsByImageUrl } from "../src/services/visualSearch.js";

const safeFetchMock = vi.mocked(safeFetch);

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function fakeFastify(): FastifyInstance {
  return { log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } } as unknown as FastifyInstance;
}

const PRODUCT_MATCH = {
  position: 1,
  title: "Sac Polène",
  link: "https://www.polene-paris.com/sac",
  source: "Polène",
  thumbnail: "https://example.com/thumb.jpg",
  price: { value: "640 €", extracted_value: 640, currency: "€" },
};

const SOCIAL_MATCH = {
  position: 2,
  title: "Vidéo TikTok",
  link: "https://www.tiktok.com/@user/video/123",
  source: "TikTok",
  thumbnail: "https://example.com/thumb2.jpg",
};

beforeEach(() => {
  safeFetchMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("searchProductsByImageUrl", () => {
  it("appelle SerpApi avec type=products et la localisation par défaut (fr/fr)", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ visual_matches: [PRODUCT_MATCH] }));

    const fastify = fakeFastify();
    const matches = await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg");

    expect(safeFetchMock).toHaveBeenCalledOnce();
    const calledUrl = new URL(safeFetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.searchParams.get("type")).toBe("products");
    expect(calledUrl.searchParams.get("country")).toBe("fr");
    expect(calledUrl.searchParams.get("hl")).toBe("fr");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.productName).toBe("Sac Polène");
  });

  it("accepte une locale explicite, en prévision du branchement sur la langue de l'utilisateur (Lot 3)", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ visual_matches: [PRODUCT_MATCH] }));

    const fastify = fakeFastify();
    await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg", { locale: { country: "us", hl: "en" } });

    const calledUrl = new URL(safeFetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.searchParams.get("country")).toBe("us");
    expect(calledUrl.searchParams.get("hl")).toBe("en");
  });

  it("transmet le texte « Que cherchez-vous ? » (q) seulement quand il est rempli", async () => {
    safeFetchMock.mockImplementation(async () => jsonResponse({ visual_matches: [PRODUCT_MATCH] }));
    const fastify = fakeFastify();

    await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg", { query: "veste en daim marron" });
    await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg", { query: "   " });
    await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg");

    const urls = safeFetchMock.mock.calls.map((c) => new URL(c[0] as string));
    expect(urls[0]!.searchParams.get("q")).toBe("veste en daim marron");
    expect(urls[1]!.searchParams.has("q")).toBe(false);
    expect(urls[2]!.searchParams.has("q")).toBe(false);
  });

  it("ne fait JAMAIS de second appel quand rien n'est trouvé (1 crédit par recherche)", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ visual_matches: [] }));

    const fastify = fakeFastify();
    const matches = await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg");

    expect(safeFetchMock).toHaveBeenCalledOnce();
    expect(matches).toEqual([]);
  });

  it("traite « Google Lens hasn't returned any results » comme une recherche vide, pas comme une panne", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ error: "Google Lens hasn't returned any results for this query." }));

    const fastify = fakeFastify();
    await expect(searchProductsByImageUrl(fastify, "https://example.com/photo.jpg")).resolves.toEqual([]);
  });

  it("relève une vraie erreur de SerpApi", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ error: "Invalid API key." }));

    const fastify = fakeFastify();
    await expect(searchProductsByImageUrl(fastify, "https://example.com/photo.jpg")).rejects.toThrow("Invalid API key");
  });

  it("garde l'image haute définition quand elle existe, la vignette sinon", async () => {
    safeFetchMock.mockResolvedValueOnce(
      jsonResponse({ visual_matches: [{ ...PRODUCT_MATCH, image: "https://marchand.example/hd.jpg" }, { ...PRODUCT_MATCH, position: 2 }] })
    );

    const fastify = fakeFastify();
    const matches = await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg");

    expect(matches[0]!.imageHdUrl).toBe("https://marchand.example/hd.jpg");
    expect(matches[0]!.imageUrl).toBe(PRODUCT_MATCH.thumbnail);
    expect(matches[1]!.imageHdUrl).toBeNull();
  });

  it("écarte les résultats de réseaux sociaux même quand ils sont mélangés à de vrais produits", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ visual_matches: [SOCIAL_MATCH, PRODUCT_MATCH] }));

    const fastify = fakeFastify();
    const matches = await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg");

    expect(matches).toHaveLength(1);
    expect(matches[0]!.merchantUrl).toBe(PRODUCT_MATCH.link);
  });

  it("renumérote les rangs après avoir écarté les réseaux sociaux (la liste commence toujours à 1)", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ visual_matches: [SOCIAL_MATCH, { ...PRODUCT_MATCH, position: 5 }] }));

    const fastify = fakeFastify();
    const matches = await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg");

    expect(matches.map((m) => m.rank)).toEqual([1]);
  });

  it("garde jusqu'à 20 propositions", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...PRODUCT_MATCH, position: i + 1, link: `https://marchand.example/${i}` }));
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ visual_matches: many }));

    const fastify = fakeFastify();
    expect(await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg")).toHaveLength(20);
  });
});
