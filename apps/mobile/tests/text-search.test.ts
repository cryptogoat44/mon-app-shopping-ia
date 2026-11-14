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

import { ApiError, fetchSearch, runTextSearch } from "../src/lib/api";
import { clearLastSpotResult, getLastSpotResult, setLastSpotResult } from "../src/api/spotSession";
import type { SpotResult } from "../src/api/types";
import {
  chooseInitialResult,
  recoverTextSearch,
  settledTextSearch,
  textSearchFailure,
  textSearchSettled,
  toSpotResult,
  withoutTextPrompt,
  withTextSearch,
} from "../src/lib/spot-result";

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

  it("refus du serveur avant toute recherche (409, 404, 429) : une ApiError, sans issue « failed » comptée", async () => {
    const refusals = [
      [409, { error: "text_search_already_used", message: "Déjà lancée." }],
      [409, { error: "text_search_not_allowed", message: "" }],
      [404, { error: "text_search_unavailable", message: "" }],
      [429, { error: "search_capacity_day", message: "" }],
      [429, { error: "rate_limited", message: "" }],
    ] as const;
    for (const [status, body] of refusals) {
      track.mockReset();
      fetchMock.mockResolvedValueOnce(jsonResponse(status, body));
      const error = await runTextSearch("s1", WORDS).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status });
      expect(track.mock.calls).toEqual([["text_search_launched"]]);
    }
  });

  it("panne du réseau ou du serveur : l'issue « failed »", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "internal_error", message: "" }));
    await expect(runTextSearch("s1", WORDS)).rejects.toBeInstanceOf(ApiError);
    expect(track.mock.calls).toEqual([["text_search_launched"], ["text_search_completed", { outcome: "failed", results_count: 0 }]]);
    track.mockReset();
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
    await expect(runTextSearch("s1", WORDS)).rejects.toBeInstanceOf(TypeError);
    expect(track.mock.calls).toEqual([["text_search_launched"], ["text_search_completed", { outcome: "failed", results_count: 0 }]]);
  });

  it("mots refusés avant toute recherche (400) : une ApiError, sans issue « failed » comptée", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: "invalid_body", message: "Décrivez la pièce en quelques mots." }));
    const error = await runTextSearch("s1", "site:zalando.fr").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400 });
    expect(track.mock.calls).toEqual([["text_search_launched"]]);
  });
});

describe("relecture de la recherche (voie B)", () => {
  it("fetchSearch relit la recherche sans corps, et peut être abandonnée", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, search()));
    const controller = new AbortController();
    await fetchSearch("s1", controller.signal);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.exemple.test/api/searches/s1");
    expect(init?.method).toBeUndefined();
    expect(init?.body).toBeUndefined();
    expect(init?.signal).toBe(controller.signal);
    expect(init?.headers).not.toHaveProperty("Content-Type");
    // Sans signal : l'appel d'avant, inchangé (Aperçu, écran rouvert).
    fetchMock.mockResolvedValueOnce(jsonResponse(200, search()));
    await fetchSearch("s1");
    expect(fetchMock.mock.calls[1]![1]?.signal).toBeUndefined();
  });

  it("« Annuler » trop tard puis nouvel essai : 409, la recherche relue montre les propositions des mots, remplacées sur place", async () => {
    const launched = toSpotResult(search({ complement: { status: "shown", query: "veste daim", suggestText: true, textStatus: null } }));
    // Le premier essai, abandonné, est allé au bout côté serveur : le verrou est pris, les propositions enregistrées.
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: "text_search_already_used", message: "Déjà lancée." }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, search({ matches: [match("l1"), match("l2"), match("s1", "shopping"), match("w1", "words")], complement: { status: "shown", suggestText: false, textStatus: "shown" } }))
    );
    const controller = new AbortController();
    const error = await runTextSearch("s1", WORDS, controller.signal).catch((caught: unknown) => caught);

    const next = await recoverTextSearch(textSearchFailure(error), () => fetchSearch("s1", controller.signal));

    expect(next.kind).toBe("done");
    if (next.kind !== "done") return;
    const replaced = withTextSearch(launched, next.search);
    expect(replaced.complement?.words.map((piece) => piece.id)).toEqual(["w1"]);
    expect(replaced.complement).toMatchObject({ query: "veste daim", suggestText: false, textStatus: "shown" });
    expect(fetchMock.mock.calls[1]![0]).toBe("https://api.exemple.test/api/searches/s1");
    expect(JSON.stringify(fetchMock.mock.calls[1])).not.toContain("daim");
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

  it("mots refusés (400 « invalid_body », rien ne reste une fois les opérateurs retirés) : un texte à part, l'invitation reste", () => {
    expect(textSearchFailure(new ApiError(400, { error: "invalid_body", message: "Décrivez la pièce en quelques mots." }))).toEqual({ kind: "invalid_words" });
    // Un autre refus 400 n'accuse pas les mots.
    expect(textSearchFailure(new ApiError(400, { error: "invalid_params", message: "" }))).toEqual({ kind: "technical" });
  });
});

describe("après un échec, la recherche relue dit ce que le serveur a fait des mots", () => {
  const inProgress = search({ complement: { status: "shown", suggestText: false, textStatus: null } });
  const withWords = search({ matches: [match("l1"), match("w1", "words")], complement: { status: "shown", suggestText: false, textStatus: "shown" } });
  const nothingForWords = search({ complement: { status: "shown", suggestText: false, textStatus: "empty" } });
  // Propositions enregistrées, issue non écrite (500 « search_save_failed » après l'enregistrement).
  const rowsOnly = search({ matches: [match("l1"), match("w1", "words")], complement: { status: "shown", suggestText: false, textStatus: null } });
  const unreadable = () => Promise.reject(new TypeError("Network request failed"));

  it("issue des mots : des propositions « words », ou une issue enregistrée", () => {
    expect(textSearchSettled(withWords)).toBe(true);
    expect(textSearchSettled(nothingForWords)).toBe(true);
    expect(textSearchSettled(rowsOnly)).toBe(true);
    expect(textSearchSettled(inProgress)).toBe(false);
    expect(textSearchSettled(search({ complement: undefined }))).toBe(false);
  });

  it("409 déjà lancée : l'issue relue remplace le résultat ; sinon « déjà lancée », l'invitation disparaît", async () => {
    const used = textSearchFailure(new ApiError(409, { error: "text_search_already_used", message: "" }));
    expect(await recoverTextSearch(used, async () => withWords)).toEqual({ kind: "done", search: withWords });
    expect(await recoverTextSearch(used, async () => nothingForWords)).toEqual({ kind: "done", search: nothingForWords });
    expect(await recoverTextSearch(used, async () => rowsOnly)).toEqual({ kind: "done", search: rowsOnly });
    // Recherche encore en cours côté serveur, ou relecture impossible : la phrase.
    expect(await recoverTextSearch(used, async () => inProgress)).toEqual({ kind: "closed", alreadyUsed: true });
    expect(await recoverTextSearch(used, unreadable)).toEqual({ kind: "closed", alreadyUsed: true });
  });

  it("réseau ou serveur : l'issue relue remplace le résultat ; sinon un nouvel essai est proposé", async () => {
    const technical = textSearchFailure(new ApiError(500, { error: "search_save_failed", message: "" }));
    expect(await recoverTextSearch(technical, async () => rowsOnly)).toEqual({ kind: "done", search: rowsOnly });
    expect(await recoverTextSearch(technical, async () => inProgress)).toEqual({ kind: "idle", failure: { kind: "technical" } });
    expect(await recoverTextSearch(technical, unreadable)).toEqual({ kind: "idle", failure: { kind: "technical" } });
  });

  it("refus sans recherche engagée : aucune relecture", async () => {
    const read = vi.fn(async () => withWords);
    const hidden = textSearchFailure(new ApiError(404, { error: "text_search_unavailable", message: "" }));
    expect(await recoverTextSearch(hidden, read)).toEqual({ kind: "closed", alreadyUsed: false });
    const limit = textSearchFailure(new ApiError(429, { error: "rate_limited", message: "" }));
    expect(await recoverTextSearch(limit, read)).toEqual({ kind: "idle", failure: limit });
    const refused = textSearchFailure(new ApiError(400, { error: "invalid_body", message: "" }));
    expect(await recoverTextSearch(refused, read)).toEqual({ kind: "idle", failure: { kind: "invalid_words" } });
    expect(read).not.toHaveBeenCalled();
  });

  it("après « Annuler » : la recherche relue seulement si l'issue des mots y est, jamais une erreur", async () => {
    expect(await settledTextSearch(async () => withWords)).toBe(withWords);
    expect(await settledTextSearch(async () => inProgress)).toBeNull();
    expect(await settledTextSearch(unreadable)).toBeNull();
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

  it("plus proposée par le serveur : l'invitation disparaît, ici comme au retour sur l'écran", () => {
    const next = withoutTextPrompt(launched);
    expect(next.complement).toMatchObject({ suggestText: false, query: "veste daim", textStatus: null });
    expect(next.pieces).toEqual(launched.pieces);
    expect(next.sortedByWords).toBe(true);
    // Le résultat d'avant n'est pas modifié ; sans complément, rien à retirer.
    expect(launched.complement?.suggestText).toBe(true);
    const plain = toSpotResult(search({ complement: undefined, matches: [match("l1")] }));
    expect(withoutTextPrompt(plain)).toBe(plain);
  });

  it("« déjà lancée » : plus de copie en mémoire, l'écran rouvert depuis « Récemment spottées » relit la recherche", () => {
    // handleTextSearchClosed(true), result.tsx : les propositions des mots peuvent encore arriver.
    setLastSpotResult(launched);
    expect(chooseInitialResult(getLastSpotResult(), "s1")).toEqual({ kind: "ready", result: launched });
    clearLastSpotResult();
    expect(getLastSpotResult()).toBeNull();
    expect(chooseInitialResult(getLastSpotResult(), "s1")).toEqual({ kind: "loading", searchId: "s1" });
  });

  it("rien pour les mots : toujours « rien trouvé », l'issue est gardée, l'invitation disparaît", () => {
    const nothing = toSpotResult(search({ matches: [], status: "failed", errorMessage: "Aucun produit identifié sur cette image.", complement: { status: "no_query", suggestText: true, textStatus: null } }));
    const next = withTextSearch(nothing, search({ matches: [], status: "failed", errorMessage: "Aucun produit identifié sur cette image.", complement: { status: "no_query", suggestText: false, textStatus: "empty" } }));
    expect(next).toMatchObject({ status: "failed", failReason: "no_match" });
    expect(next.complement).toMatchObject({ suggestText: false, textStatus: "empty" });
  });
});
