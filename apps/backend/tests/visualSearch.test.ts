import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// searchProductsByImageUrl ne doit jamais faire de vrai appel réseau en
// test (ni vers SerpApi, ni via la protection SSRF de safeFetch) — on
// remplace safeFetch entièrement et on contrôle chaque réponse simulée.
vi.mock("../src/lib/safeFetch.js", () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from "../src/lib/safeFetch.js";
import { callSerpApi, CURRENT_LENS_SETTINGS, searchProductsByImageUrl } from "../src/services/visualSearch.js";

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
  it("appelle SerpApi avec type=visual_matches (« products » abandonné par SerpApi le 2026-10-09) et la localisation par défaut (fr/fr)", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ visual_matches: [PRODUCT_MATCH] }));

    const fastify = fakeFastify();
    const { matches } = await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg");

    expect(safeFetchMock).toHaveBeenCalledOnce();
    const calledUrl = new URL(safeFetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.searchParams.get("type")).toBe("visual_matches");
    expect(calledUrl.searchParams.get("country")).toBe("fr");
    expect(calledUrl.searchParams.get("hl")).toBe("fr");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.productName).toBe("Sac Polène");
  });

  // Réponses fabriquées sur le modèle documenté de « visual_matches »
  // (serpapi.com/google-lens-visual-matches-api, lu le 2026-10-20) : mêmes
  // champs que « products », plus quelques-uns que le serveur ignore.
  it("visual_matches : propositions lues comme avant ; les champs en plus sont ignorés ; les réseaux sociaux restent écartés", async () => {
    const visuelle = {
      ...PRODUCT_MATCH,
      image: "https://www.polene-paris.com/sac-grand.jpg",
      source_icon: "https://example.com/icone.png",
      rating: 4.8,
      reviews: 120,
      in_stock: true,
      condition: "Neuf",
      exact_matches: true,
      serpapi_exact_matches_link: "https://serpapi.com/search.json?engine=google_lens&type=exact_matches",
    };
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ search_metadata: { status: "Success" }, visual_matches: [visuelle, SOCIAL_MATCH] }));

    const { matches, measure } = await searchProductsByImageUrl(fakeFastify(), "https://example.com/photo.jpg");

    expect(matches).toEqual([
      { rank: 1, productName: "Sac Polène", imageUrl: "https://example.com/thumb.jpg", imageHdUrl: "https://www.polene-paris.com/sac-grand.jpg", merchantName: "Polène", merchantUrl: "https://www.polene-paris.com/sac", priceValue: 640, currency: "€" },
    ]);
    expect(measure).toMatchObject({ received: 2, removedSocial: 1, kept: 1, keptWithPrice: 1, sections: ["visual_matches"] });
  });

  it("une réponse avec d'autres rubriques (correspondances exactes, contenus liés) : seules les correspondances visuelles sont lues, les autres sont comptées par la mesure", async () => {
    safeFetchMock.mockResolvedValueOnce(
      jsonResponse({
        visual_matches: [PRODUCT_MATCH],
        exact_matches: [{ position: 1, title: "Sac Polène", link: "https://www.polene-paris.com/sac", price: "640 €", extracted_price: 640 }],
        related_content: [{ query: "sac polène" }],
      })
    );

    const { matches, measure } = await searchProductsByImageUrl(fakeFastify(), "https://example.com/photo.jpg");

    expect(matches.map((m) => m.productName)).toEqual(["Sac Polène"]);
    expect(measure.sections).toEqual(["visual_matches", "related_content", "other"]);
  });

  it("un type refusé par SerpApi (code 400, comme « products » depuis son abandon) est une panne annoncée, jamais une recherche vide", async () => {
    safeFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Unsupported `products` type." }), { status: 400, headers: { "content-type": "application/json" } }));

    await expect(searchProductsByImageUrl(fakeFastify(), "https://example.com/photo.jpg")).rejects.toMatchObject({ kind: "serpapi_error" });
  });

  it("accepte une locale explicite, en prévision du branchement sur la langue de l'utilisateur (Lot 3)", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ visual_matches: [PRODUCT_MATCH] }));

    const fastify = fakeFastify();
    await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg", { locale: { country: "us", hl: "en" } });

    const calledUrl = new URL(safeFetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.searchParams.get("country")).toBe("us");
    expect(calledUrl.searchParams.get("hl")).toBe("en");
  });

  it("n'envoie jamais de mots avec l'image (petit lot) ; seuls les outils de mesure le peuvent, par callSerpApi", async () => {
    safeFetchMock.mockImplementation(async () => jsonResponse({ visual_matches: [PRODUCT_MATCH] }));
    await searchProductsByImageUrl(fakeFastify(), "https://example.com/photo.jpg");
    await callSerpApi("https://example.com/photo.jpg", CURRENT_LENS_SETTINGS, "veste en daim marron");

    const urls = safeFetchMock.mock.calls.map((c) => new URL(c[0] as string));
    expect(urls[0]!.searchParams.has("q")).toBe(false);
    expect(urls[1]!.searchParams.get("q")).toBe("veste en daim marron");
  });

  it("ne fait JAMAIS de second appel quand rien n'est trouvé (1 crédit par recherche)", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ visual_matches: [] }));

    const fastify = fakeFastify();
    const { matches } = await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg");

    expect(safeFetchMock).toHaveBeenCalledOnce();
    expect(matches).toEqual([]);
  });

  it("traite « Google Lens hasn't returned any results » comme une recherche vide, pas comme une panne", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ error: "Google Lens hasn't returned any results for this query." }));

    const fastify = fakeFastify();
    expect((await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg")).matches).toEqual([]);
  });

  it("relève une vraie erreur de SerpApi", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ error: "Invalid API key." }));

    const fastify = fakeFastify();
    await expect(searchProductsByImageUrl(fastify, "https://example.com/photo.jpg")).rejects.toThrow("Invalid API key");
  });

  it("garde l'image haute définition quand elle existe, la vignette sinon", async () => {
    safeFetchMock.mockResolvedValueOnce(
      jsonResponse({ visual_matches: [{ ...PRODUCT_MATCH, image: "https://marchand.example/hd.jpg" }, { ...PRODUCT_MATCH, position: 2, link: "https://marchand.example/autre" }] })
    );

    const fastify = fakeFastify();
    const { matches } = await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg");

    expect(matches[0]!.imageHdUrl).toBe("https://marchand.example/hd.jpg");
    expect(matches[0]!.imageUrl).toBe(PRODUCT_MATCH.thumbnail);
    expect(matches[1]!.imageHdUrl).toBeNull();
  });

  it("écarte les résultats de réseaux sociaux même quand ils sont mélangés à de vrais produits", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ visual_matches: [SOCIAL_MATCH, PRODUCT_MATCH] }));

    const fastify = fakeFastify();
    const { matches } = await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg");

    expect(matches).toHaveLength(1);
    expect(matches[0]!.merchantUrl).toBe(PRODUCT_MATCH.link);
  });

  it("renumérote les rangs après avoir écarté les réseaux sociaux (la liste commence toujours à 1)", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ visual_matches: [SOCIAL_MATCH, { ...PRODUCT_MATCH, position: 5 }] }));

    const fastify = fakeFastify();
    const { matches } = await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg");

    expect(matches.map((m) => m.rank)).toEqual([1]);
  });

  it("garde les 30 premières, plus au plus 10 avec un prix venues de plus loin (40 au plus)", async () => {
    const avecPrix = Array.from({ length: 60 }, (_, i) => ({ ...PRODUCT_MATCH, position: i + 1, link: `https://marchand.example/${i}` }));
    const sansPrix = avecPrix.map(({ price: _, ...sans }) => sans);
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ visual_matches: avecPrix })).mockResolvedValueOnce(jsonResponse({ visual_matches: sansPrix }));

    const fastify = fakeFastify();
    expect((await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg")).matches).toHaveLength(40);
    expect((await searchProductsByImageUrl(fastify, "https://example.com/photo.jpg")).matches).toHaveLength(30);
  });

  it("règle des prix et classement : 6 premières à leur place, puis prix en euros, sites .fr/.eu, le reste ; ajouts dans l'ordre de Google, 10 au plus", async () => {
    const piece = (position: number, site: string, prix?: [number, string]) => ({
      position,
      title: `Pièce ${position}`,
      link: `https://${site}/p${position}`,
      source: "Marchand",
      thumbnail: "https://example.com/t.jpg",
      ...(prix ? { price: { value: `${prix[0]} ${prix[1]}`, extracted_value: prix[0], currency: prix[1] } } : {}),
    });
    const reponse = [
      piece(1, "a.com"), piece(2, "b.com", [10, "$"]), piece(3, "c.fr"), piece(4, "d.com", [20, "€"]), piece(5, "e.mx", [300, "MXN"]), piece(6, "f.com"),
      piece(7, "g.com"), piece(8, "h.fr"), piece(9, "i.com", [30, "€"]), piece(10, "j.eu"), piece(11, "k.com", [40, "$"]), piece(12, "l.fr", [50, "$"]),
      ...Array.from({ length: 18 }, (_, i) => piece(13 + i, `m${13 + i}.com`)),
      piece(31, "n.com", [60, "€"]), piece(32, "o.com"), piece(33, "p.mx", [700, "MXN"]), piece(34, "q.fr", [80, "€"]),
      // Prix illisible (devise de plus de 3 caractères) : ne compte pas comme un prix.
      piece(35, "r.com", [90, "EUROS"]),
      ...Array.from({ length: 10 }, (_, i) => piece(36 + i, `s${36 + i}.com`, [100 + i, "$"])),
    ];
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ visual_matches: reponse }));

    const { matches, measure, addedRanks } = await searchProductsByImageUrl(fakeFastify(), "https://example.com/photo.jpg");
    const position = (lien: string) => Number(new URL(lien).pathname.slice(2));
    const groupe2 = [7, 11, ...Array.from({ length: 18 }, (_, i) => 13 + i), 33, 36, 37, 38, 39, 40, 41, 42];
    expect(matches.map((m) => position(m.merchantUrl))).toEqual([1, 2, 3, 4, 5, 6, 9, 31, 34, 8, 10, 12, ...groupe2]);
    expect(matches.map((m) => m.rank)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(addedRanks).toEqual([31, 33, 34, 36, 37, 38, 39, 40, 41, 42]);
    expect(measure.kept).toBe(40);
  });

  it("retire les doublons (même page produit), en gardant la première", async () => {
    safeFetchMock.mockResolvedValueOnce(
      jsonResponse({
        visual_matches: [
          { ...PRODUCT_MATCH, position: 1, title: "Première" },
          { ...PRODUCT_MATCH, position: 2, title: "Doublon", link: `${PRODUCT_MATCH.link}#avis` },
          { ...PRODUCT_MATCH, position: 3, title: "Doublon 2", link: `${PRODUCT_MATCH.link}/` },
          { ...PRODUCT_MATCH, position: 4, title: "Autre", link: "https://marchand.example/autre" },
        ],
      })
    );

    const { matches } = await searchProductsByImageUrl(fakeFastify(), "https://example.com/photo.jpg");
    expect(matches.map((m) => [m.rank, m.productName])).toEqual([
      [1, "Première"],
      [2, "Autre"],
    ]);
  });

  // Lot 4 ter : la réponse de SerpApi est lue avec zod, plus de conversion « de confiance » (charte, règle 19).
  it("proposition mal formée écartée, sans faire échouer les autres", async () => {
    safeFetchMock.mockResolvedValueOnce(
      jsonResponse({ visual_matches: [{ ...PRODUCT_MATCH, title: 42 }, { ...PRODUCT_MATCH, position: 2, price: { extracted_value: "beaucoup" } }, { ...PRODUCT_MATCH, position: 3, link: "https://marchand.example/bon" }] })
    );
    const { matches } = await searchProductsByImageUrl(fakeFastify(), "https://example.com/photo.jpg");
    expect(matches.map((m) => m.merchantUrl)).toEqual(["https://marchand.example/bon"]);
  });

  // Mesure (fiabilité des résultats) : chaque panne est rangée avec son type.
  it("panne typée : délai dépassé, SerpApi en erreur ou injoignable, réponse illisible", async () => {
    safeFetchMock.mockRejectedValueOnce(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    await expect(searchProductsByImageUrl(fakeFastify(), "https://example.com/photo.jpg")).rejects.toMatchObject({ kind: "timeout" });
    safeFetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(searchProductsByImageUrl(fakeFastify(), "https://example.com/photo.jpg")).rejects.toMatchObject({ kind: "serpapi_error" });
    safeFetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await expect(searchProductsByImageUrl(fakeFastify(), "https://example.com/photo.jpg")).rejects.toMatchObject({ kind: "serpapi_error" });
    safeFetchMock.mockResolvedValueOnce(new Response("<html>erreur</html>", { status: 200 }));
    await expect(searchProductsByImageUrl(fakeFastify(), "https://example.com/photo.jpg")).rejects.toMatchObject({ kind: "unreadable_response" });
  });

  it("réponse illisible : panne technique, jamais « aucune pièce »", async () => {
    safeFetchMock.mockResolvedValueOnce(new Response("<html>erreur</html>", { status: 200 }));
    await expect(searchProductsByImageUrl(fakeFastify(), "https://example.com/photo.jpg")).rejects.toThrow("réponse inattendue");
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ visual_matches: "aucune" }));
    await expect(searchProductsByImageUrl(fakeFastify(), "https://example.com/photo.jpg")).rejects.toThrow("réponse inattendue");
  });
});
