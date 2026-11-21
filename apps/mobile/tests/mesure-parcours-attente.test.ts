import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductMatch, ProductSearch } from "@monapp/shared-types";

// Lot « mesure du parcours » : la règle « durée » du catalogue fermé, et les
// temps d'attente de la recherche (du lancement aux premiers résultats, puis
// aux boutiques) et de « Que cherchez-vous ? ». Horloge simulée : des durées
// exactes. api.ts importe le client Supabase réel et lit l'adresse du serveur
// au chargement : tout est remplacé ici, et `fetch` est simulé — jamais un
// vrai appel réseau.
const { track } = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.exemple.test";
  return { track: vi.fn() };
});
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jeton-factice" } } }) } } }));
vi.mock("../src/lib/analytics", () => ({ track, setAnalyticsConsent: vi.fn() }));
vi.mock("../src/lib/image-file", () => ({ imageFileFromUri: vi.fn() }));

import { runSearch, runTextSearch } from "../src/lib/api";
import { ANALYTICS_EVENTS, DURATION_MAX_MS, sanitizeProps } from "../src/lib/analytics-events";
import { forgetShopsRequests } from "../src/lib/spot-shops";
import { __setWaitClock } from "../src/lib/wait-clock";

const match = (id: string, origin?: ProductMatch["origin"]): ProductMatch => ({
  id,
  rank: 1,
  productName: `Pièce ${id}`,
  brand: null,
  imageUrl: `https://boutique.test/${id}.jpg`,
  imageHdUrl: null,
  priceMin: 50,
  priceMax: 50,
  currency: "EUR",
  merchantName: "Boutique",
  merchantUrl: `https://boutique.test/${id}`,
  affiliateUrl: `https://boutique.test/${id}`,
  feedbackReason: null,
  ...(origin ? { origin } : {}),
});

const LAUNCHED: ProductSearch = {
  id: "s1",
  sourceUrl: null,
  sourcePlatform: "photo",
  method: "manual_screenshot",
  status: "completed",
  errorMessage: null,
  query: null,
  createdAt: "2026-11-21T10:00:00.000Z",
  matches: [match("l1"), match("l2")],
  complement: { status: null, suggestText: false, textStatus: null, pending: true },
};
const SHOPS: ProductSearch = { ...LAUNCHED, matches: [...LAUNCHED.matches, match("b1", "shopping")], complement: { status: "shown", query: "veste", suggestText: false, textStatus: null } };
const WORDS_DONE: ProductSearch = { ...SHOPS, matches: [...SHOPS.matches, match("w1", "words")], complement: { status: "shown", suggestText: false, textStatus: "shown" } };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const eventsNamed = (name: string) => track.mock.calls.filter(([event]) => event === name).map(([, props]) => props as Record<string, unknown>);

const fetchMock = vi.fn<typeof fetch>();
let now = 0;

/** Le serveur répond au bout de `ms` (horloge simulée). */
function answersAfter(ms: number, response: () => Response) {
  return async () => {
    now += ms;
    return response();
  };
}

beforeEach(() => {
  now = 1_000;
  __setWaitClock(() => now);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  track.mockReset();
  forgetShopsRequests();
  __setWaitClock(null);
  vi.unstubAllGlobals();
});

describe("règle « durée » du catalogue fermé", () => {
  it("des millisecondes arrondies à 100 ms, bornées entre 0 et 10 minutes", () => {
    const wait = (value: unknown) => sanitizeProps("text_search_completed", { wait_ms: value as number }).wait_ms;
    expect(wait(2_349)).toBe(2_300);
    expect(wait(2_350)).toBe(2_400);
    expect(wait(49)).toBe(0);
    expect(wait(0)).toBe(0);
    // Horloge qui recule ou attente démesurée : jamais hors des bornes.
    expect(wait(-1_500)).toBe(0);
    expect(Object.is(wait(-40), 0)).toBe(true);
    expect(wait(DURATION_MAX_MS + 12_345)).toBe(600_000);
    expect(wait(Number.MAX_SAFE_INTEGER)).toBe(600_000);
  });

  it("tout autre type est retiré : texte, oui/non, nombre non fini, null", () => {
    for (const value of ["2300", true, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, { ms: 3 }]) {
      expect(sanitizeProps("text_search_completed", { outcome: "shown", wait_ms: value as number })).toEqual({ outcome: "shown" });
    }
  });

  it("les temps d'attente sont des durées, ajoutées aux événements d'avant sans rien changer d'autre", () => {
    expect(ANALYTICS_EVENTS.spot_completed.wait_ms.kind).toBe("duration");
    expect(ANALYTICS_EVENTS.spot_completed.shops_wait_ms.kind).toBe("duration");
    expect(ANALYTICS_EVENTS.text_search_completed.wait_ms.kind).toBe("duration");
    expect(ANALYTICS_EVENTS.video_link_ai_result.wait_ms.kind).toBe("duration");
    expect(ANALYTICS_EVENTS.video_ai_result.wait_ms.kind).toBe("duration");
    // Les propriétés d'avant sont toujours là, avec leur règle.
    expect(Object.keys(ANALYTICS_EVENTS.spot_completed)).toEqual(["outcome", "results_count", "complement", "complement_count", "wait_ms", "shops_wait_ms"]);
    expect(ANALYTICS_EVENTS.spot_completed.results_count.kind).toBe("count");
    expect(sanitizeProps("spot_completed", { outcome: "results", results_count: 3, complement: "shown", complement_count: 1, wait_ms: 4_321.4, shops_wait_ms: 9_876 })).toEqual({
      outcome: "results",
      results_count: 3,
      complement: "shown",
      complement_count: 1,
      wait_ms: 4_300,
      shops_wait_ms: 9_900,
    });
  });
});

describe("spot_completed : attente des premiers résultats, puis des boutiques", () => {
  it("boutiques ensuite : du lancement à la réponse, puis du lancement à l'issue des boutiques ; une seule fois", async () => {
    fetchMock.mockImplementationOnce(answersAfter(2_340, () => json(LAUNCHED))).mockImplementationOnce(answersAfter(5_000, () => json(SHOPS)));
    await runSearch("s1", { crop: null, imageUri: null });
    await vi.waitFor(() => expect(eventsNamed("spot_completed")).toHaveLength(1));
    expect(eventsNamed("spot_completed")[0]).toEqual({ outcome: "results", results_count: 2, complement: "shown", complement_count: 1, wait_ms: 2_340, shops_wait_ms: 7_340 });
  });

  it("issue des boutiques inconnue (panne) : l'attente des résultats seulement, sans celle des boutiques", async () => {
    fetchMock.mockImplementationOnce(answersAfter(800, () => json(LAUNCHED))).mockImplementationOnce(answersAfter(30_000, () => json({ error: "internal_error", message: "x" }, 500)));
    await runSearch("s1", { crop: null, imageUri: null });
    await vi.waitFor(() => expect(eventsNamed("spot_completed")).toHaveLength(1));
    const [completed] = eventsNamed("spot_completed");
    expect(completed).toMatchObject({ complement: "unknown", wait_ms: 800 });
    expect(completed).not.toHaveProperty("shops_wait_ms");
  });

  it("serveur d'avant (tout en une fois) : les deux attentes sont la même", async () => {
    fetchMock.mockImplementationOnce(answersAfter(61_200, () => json(SHOPS)));
    await runSearch("s1", { crop: null, imageUri: null });
    expect(eventsNamed("spot_completed")).toEqual([expect.objectContaining({ wait_ms: 61_200, shops_wait_ms: 61_200 })]);
  });

  it("aucun texte, lien ni identifiant de recherche dans l'événement", async () => {
    fetchMock.mockImplementationOnce(answersAfter(100, () => json({ ...SHOPS, id: "recherche-4242" })));
    await runSearch("recherche-4242", { crop: null, imageUri: null, words: "veste en daim" });
    const sent = JSON.stringify(eventsNamed("spot_completed"));
    for (const forbidden of ["veste", "recherche-4242", "boutique.test", "Pièce"]) expect(sent).not.toContain(forbidden);
  });
});

describe("« Que cherchez-vous ? » : attente jusqu'à l'issue", () => {
  it("réponse : l'issue, le nombre et l'attente depuis le départ", async () => {
    fetchMock.mockImplementationOnce(answersAfter(3_210, () => json(WORDS_DONE)));
    await runTextSearch("s1", "veste en daim");
    expect(track.mock.calls).toEqual([["text_search_launched"], ["text_search_completed", { outcome: "shown", results_count: 1, wait_ms: 3_210 }]]);
  });

  it("panne du réseau : « failed », avec l'attente jusqu'à l'échec", async () => {
    fetchMock.mockImplementationOnce(async () => {
      now += 12_000;
      throw new TypeError("Network request failed");
    });
    await expect(runTextSearch("s1", "veste en daim")).rejects.toBeInstanceOf(TypeError);
    expect(eventsNamed("text_search_completed")).toEqual([{ outcome: "failed", results_count: 0, wait_ms: 12_000 }]);
  });
});
