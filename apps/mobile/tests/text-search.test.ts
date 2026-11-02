import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductMatch, ProductSearch } from "@monapp/shared-types";

// Voie B (lot c) : « Que cherchez-vous ? » sous un résultat. api.ts importe
// le client Supabase réel et lit l'adresse du serveur au chargement : tout est
// remplacé ici, et `fetch` est simulé — jamais un vrai appel réseau.
const { track } = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.exemple.test";
  return { track: vi.fn() };
});
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jeton-factice" } } }) } } }));
vi.mock("../src/lib/analytics", () => ({ track, setAnalyticsConsent: vi.fn() }));
vi.mock("../src/lib/image-file", () => ({ imageFileFromUri: vi.fn() }));

import { ApiError, runTextSearch } from "../src/lib/api";
import type { SpotResult } from "../src/api/types";
import { textSearchFailure, toSpotResult, withTextSearch } from "../src/lib/spot-result";

const WORDS = "veste en daim marron";

function match(id: string, origin?: ProductMatch["origin"]): ProductMatch {
  return {
    id,
    rank: 1,
    productName: `Pièce ${id}`,
    brand: null,
    imageUrl: `https://boutique.test/${id}.jpg`,
    priceMin: 49.9,
    priceMax: 49.9,
    currency: "EUR",
    merchantName: "Boutique",
    merchantUrl: `https://boutique.test/${id}`,
    affiliateUrl: `https://boutique.test/${id}`,
    imageHdUrl: null,
    feedbackReason: null,
    ...(origin ? { origin } : {}),
  };
}

function search(overrides: Partial<ProductSearch> = {}): ProductSearch {
  return {
    id: "s1",
    sourceUrl: null,
    sourcePlatform: "photo",
    method: "manual_screenshot",
    thumbnailUrl: null,
    status: "completed",
    errorMessage: null,
    query: null,
    createdAt: "2026-11-02T10:00:00.000Z",
    matches: [match("l1"), match("l2"), match("s1", "shopping")],
    complement: { status: "shown", suggestText: true, textStatus: null },
    ...overrides,
  };
}

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  track.mockReset();
  vi.unstubAllGlobals();
});

describe("runTextSearch (voie B)", () => {
  it("envoie les mots en JSON { words } à /text, avec la session et la langue", async () => {
    const replied = search({ matches: [match("l1"), match("w1", "words"), match("w2", "words")], complement: { status: "shown", suggestText: false, textStatus: "shown" } });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, replied));
    const controller = new AbortController();

    const found = await runTextSearch("s1", WORDS, controller.signal);

    expect(found).toEqual(replied);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.exemple.test/api/searches/s1/text");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ words: WORDS });
    expect(init?.signal).toBe(controller.signal);
    expect(init?.headers).toMatchObject({ "Content-Type": "application/json", Authorization: "Bearer jeton-factice", "Accept-Language": "fr" });
  });

  it("statistiques : le lancement puis l'issue et un nombre — jamais les mots", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, search({ matches: [match("l1"), match("w1", "words")], complement: { status: "shown", suggestText: false, textStatus: "shown" } })));
    await runTextSearch("s1", WORDS);
    expect(track.mock.calls).toEqual([["text_search_launched"], ["text_search_completed", { outcome: "shown", results_count: 1 }]]);
    expect(JSON.stringify(track.mock.calls)).not.toContain("daim");
  });

  it("« Annuler » abandonne vraiment la requête, sans issue comptée", async () => {
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Abandon", "AbortError")));
        })
    );
    const controller = new AbortController();
    const pending = runTextSearch("s1", WORDS, controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(track.mock.calls).toEqual([["text_search_launched"]]);
  });

  it("refus du serveur : une ApiError, et l'issue « failed »", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: "text_search_already_used", message: "Déjà lancée." }));
    const error = await runTextSearch("s1", WORDS).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409 });
    expect(track).toHaveBeenLastCalledWith("text_search_completed", { outcome: "failed", results_count: 0 });
  });
});

describe("échecs de la recherche par les mots, tels que l'invitation les montre", () => {
  it("409 déjà lancée : l'invitation disparaît et une phrase le dit", () => {
    expect(textSearchFailure(new ApiError(409, { error: "text_search_already_used", message: "" }))).toEqual({ kind: "already_used" });
  });

  it("recherche non admissible (409) ou fonction coupée (404) : l'invitation disparaît", () => {
    expect(textSearchFailure(new ApiError(409, { error: "text_search_not_allowed", message: "" }))).toEqual({ kind: "hidden" });
    expect(textSearchFailure(new ApiError(404, { error: "text_search_unavailable", message: "" }))).toEqual({ kind: "hidden" });
  });

  it("429 : les textes du plafond des recherches, sinon « trop de recherches d'un coup »", () => {
    expect(textSearchFailure(new ApiError(429, { error: "search_capacity_user", message: "" }))).toEqual({ kind: "limit", reason: "capacity_user", resumesOn: null });
    expect(textSearchFailure(new ApiError(429, { error: "search_capacity_month", message: "", resumesOn: "2026-12-01" } as never))).toEqual({
      kind: "limit",
      reason: "capacity_month",
      resumesOn: "2026-12-01",
    });
    expect(textSearchFailure(new ApiError(429, { error: "rate_limited", message: "" }))).toEqual({ kind: "limit", reason: "rate_limited", resumesOn: null });
  });

  it("réseau ou serveur : l'invitation reste, pour réessayer", () => {
    expect(textSearchFailure(new TypeError("Network request failed"))).toEqual({ kind: "technical" });
    expect(textSearchFailure(new ApiError(500, { error: "unknown", message: "" }))).toEqual({ kind: "technical" });
  });
});

describe("le résultat est remplacé sur place", () => {
  const launched: SpotResult = {
    ...toSpotResult(search({ sortedByWords: true, complement: { status: "shown", query: "veste daim", suggestText: true, textStatus: null } })),
  };

  it("les mots s'ajoutent sous le reste ; tri du lancement et requête gardés ; plus d'invitation", () => {
    const replied = search({
      matches: [match("l1"), match("l2"), match("s1", "shopping"), match("w1", "words"), match("w2", "words")],
      complement: { status: "shown", suggestText: false, textStatus: "shown" },
    });
    const next = withTextSearch(launched, replied);
    expect(next.status).toBe("success");
    expect(next.pieces.map((piece) => piece.id)).toEqual(["l1", "l2"]);
    expect(next.complement?.shopping.map((piece) => piece.id)).toEqual(["s1"]);
    expect(next.complement?.words.map((piece) => piece.id)).toEqual(["w1", "w2"]);
    expect(next.complement).toMatchObject({ query: "veste daim", suggestText: false, textStatus: "shown" });
    expect(next.sortedByWords).toBe(true);
    // Le résultat d'avant n'est pas modifié.
    expect(launched.complement?.words).toEqual([]);
  });

  it("après « rien trouvé », des propositions pour les mots en font un succès", () => {
    const nothing = toSpotResult(search({ matches: [], status: "failed", errorMessage: "Aucun produit identifié sur cette image.", complement: { status: "no_query", suggestText: true, textStatus: null } }));
    expect(nothing.status).toBe("failed");
    const next = withTextSearch(nothing, search({ matches: [match("w1", "words")], complement: { status: "no_query", suggestText: false, textStatus: "shown" } }));
    expect(next.status).toBe("success");
    expect(next.pieces).toEqual([]);
    expect(next.complement?.words.map((piece) => piece.id)).toEqual(["w1"]);
    expect(next.sortedByWords).toBe(false);
  });

  it("rien pour les mots : toujours « rien trouvé », l'issue est gardée, l'invitation disparaît", () => {
    const nothing = toSpotResult(search({ matches: [], status: "failed", errorMessage: "Aucun produit identifié sur cette image.", complement: { status: "no_query", suggestText: true, textStatus: null } }));
    const next = withTextSearch(nothing, search({ matches: [], status: "failed", errorMessage: "Aucun produit identifié sur cette image.", complement: { status: "no_query", suggestText: false, textStatus: "empty" } }));
    expect(next).toMatchObject({ status: "failed", failReason: "no_match" });
    expect(next.complement).toMatchObject({ suggestText: false, textStatus: "empty" });
  });
});
