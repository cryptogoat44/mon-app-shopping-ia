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
    const calledUrl = new URL(safeFetchMock.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("type")).toBe("products");
    expect(calledUrl.searchParams.get("country")).toBe("fr");
    expect(calledUrl.searchParams.get("hl")).toBe("fr");
    expect(matches).toHaveLength(1);
    expect(matches[0].productName).toBe("Sac Polène");
  });

  it("accepte une locale explicite, en prévision du branchement sur la langue de l'utilisateur (Lot 3)", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ visual_matches: [PRODUCT_MATCH] }));

    const fastify = fakeFastify();
    await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg", { country: "us", hl: "en" });

    const calledUrl = new URL(safeFetchMock.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("country")).toBe("us");
    expect(calledUrl.searchParams.get("hl")).toBe("en");
  });

  it("se replie une seule fois en type=all quand products ne renvoie rien, et journalise le repli", async () => {
    safeFetchMock
      .mockResolvedValueOnce(jsonResponse({ visual_matches: [] }))
      .mockResolvedValueOnce(jsonResponse({ visual_matches: [PRODUCT_MATCH] }));

    const fastify = fakeFastify();
    const matches = await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg");

    expect(safeFetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(safeFetchMock.mock.calls[0][0] as string);
    const secondUrl = new URL(safeFetchMock.mock.calls[1][0] as string);
    expect(firstUrl.searchParams.get("type")).toBe("products");
    expect(secondUrl.searchParams.has("type")).toBe(false);
    expect(matches).toHaveLength(1);
    expect(fastify.log.warn).toHaveBeenCalledOnce();
  });

  it("ne retente jamais un deuxième repli, même si le repli en type=all est aussi vide", async () => {
    safeFetchMock
      .mockResolvedValueOnce(jsonResponse({ visual_matches: [] }))
      .mockResolvedValueOnce(jsonResponse({ visual_matches: [] }));

    const fastify = fakeFastify();
    const matches = await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg");

    // Exactement 2 appels : le premier (products) et son unique repli
    // (all) — jamais un troisième, quel que soit le résultat du repli.
    expect(safeFetchMock).toHaveBeenCalledTimes(2);
    expect(matches).toEqual([]);
  });

  it("écarte les résultats de réseaux sociaux même quand ils sont mélangés à de vrais produits", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ visual_matches: [SOCIAL_MATCH, PRODUCT_MATCH] }));

    const fastify = fakeFastify();
    const matches = await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg");

    expect(matches).toHaveLength(1);
    expect(matches[0].merchantUrl).toBe(PRODUCT_MATCH.link);
  });

  it("écarte les réseaux sociaux aussi dans les résultats du repli en type=all (qui ne les filtre pas lui-même)", async () => {
    safeFetchMock
      .mockResolvedValueOnce(jsonResponse({ visual_matches: [] }))
      .mockResolvedValueOnce(jsonResponse({ visual_matches: [SOCIAL_MATCH, PRODUCT_MATCH] }));

    const fastify = fakeFastify();
    const matches = await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg");

    expect(matches).toHaveLength(1);
    expect(matches[0].merchantUrl).toBe(PRODUCT_MATCH.link);
  });
});
