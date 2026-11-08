import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductMatch, ProductSearch } from "@monapp/shared-types";

// Boutiques ensuite (2026-11-08) : le lancement demande « complement:
// deferred » ; quand le serveur annonce les boutiques en attente, leur
// demande part aussitôt (POST /api/searches/:id/complement) et spot_completed
// n'est compté qu'une fois leur issue connue. api.ts importe le client
// Supabase réel et lit l'adresse du serveur au chargement : tout est remplacé
// ici, et `fetch` est simulé — jamais un vrai appel réseau.
const { track } = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.exemple.test";
  return { track: vi.fn() };
});
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jeton-factice" } } }) } } }));
vi.mock("../src/lib/analytics", () => ({ track, setAnalyticsConsent: vi.fn() }));
vi.mock("../src/lib/image-file", () => ({ imageFileFromUri: vi.fn() }));

import { runSearch } from "../src/lib/api";
import { forgetShopsRequests, requestShops } from "../src/lib/spot-shops";

const match = (id: string, rank: number, origin?: "shopping"): ProductMatch => ({
  id,
  rank,
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
  thumbnailUrl: null,
  status: "completed",
  errorMessage: null,
  query: null,
  createdAt: "2026-11-08T10:00:00.000Z",
  matches: [match("l1", 1), match("l2", 2)],
  complement: { status: null, suggestText: false, textStatus: null, pending: true },
};
const SHOPS: ProductSearch = { ...LAUNCHED, matches: [...LAUNCHED.matches, match("s1", 3, "shopping")], complement: { status: "shown", query: "Exemplor veste", suggestText: false, textStatus: null } };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const completedEvents = () => track.mock.calls.filter(([name]) => name === "spot_completed").map(([, props]) => props);

describe("boutiques ensuite : le lancement, puis la demande des boutiques", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    track.mockReset();
    forgetShopsRequests();
    vi.unstubAllGlobals();
  });

  it("la demande « complement: deferred » part avec le lancement ; les boutiques sont demandées aussitôt, une fois", async () => {
    let answerShops: (response: Response) => void = () => {};
    fetchMock.mockResolvedValueOnce(json(LAUNCHED)).mockImplementationOnce(() => new Promise<Response>((resolve) => (answerShops = resolve)));
    const search = await runSearch("s1", { crop: null, imageUri: null });
    expect(search.complement?.pending).toBe(true);
    const body = fetchMock.mock.calls[0]![1]?.body as FormData;
    expect(body.get("complement")).toBe("deferred");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]![0]).toBe("https://api.exemple.test/api/searches/s1/complement");
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: "POST" });
    // Pas de spot_completed tant que l'issue des boutiques n'est pas connue.
    expect(completedEvents()).toEqual([]);
    answerShops(json(SHOPS));
    // L'écran Résultat retrouve la même demande : aucun second appel.
    expect(await requestShops("s1", () => Promise.reject(new Error("jamais appelé")))).toMatchObject({ kind: "added" });
    await vi.waitFor(() => expect(completedEvents()).toHaveLength(1));
    expect(completedEvents()[0]).toEqual({ outcome: "results", results_count: 2, complement: "shown", complement_count: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("boutiques en panne : spot_completed compté une fois, issue « unknown »", async () => {
    fetchMock.mockResolvedValueOnce(json(LAUNCHED)).mockResolvedValueOnce(json({ error: "internal_error", message: "Erreur" }, 500));
    await runSearch("s1", { crop: null, imageUri: null });
    expect(await requestShops("s1", () => Promise.reject(new Error("jamais appelé")))).toEqual({ kind: "none" });
    await vi.waitFor(() => expect(completedEvents()).toHaveLength(1));
    expect(completedEvents()[0]).toEqual({ outcome: "results", results_count: 2, complement: "unknown", complement_count: 0 });
  });

  it("serveur d'avant (ou voie C coupée) : tout arrive en une fois, spot_completed tout de suite, aucune seconde demande", async () => {
    fetchMock.mockResolvedValueOnce(json(SHOPS));
    await runSearch("s1", { crop: null, imageUri: null });
    expect(completedEvents()).toEqual([{ outcome: "results", results_count: 2, complement: "shown", complement_count: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
