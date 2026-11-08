import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

// Boutiques ensuite (2026-11-08, migration 0031) : le verrou de l'étape des
// boutiques sur la VRAIE base. Test de base de données : à lancer sur le Mac,
// contre spotto-dev-2, APRÈS la migration 0031 (sans elle, chaque test est
// sauté). Aucun appel réel : Google Lens, l'IA et Google Shopping sont
// simulés, le plafond des recherches, la limite de l'IA et le cache aussi
// (leurs fonctions réelles ont leurs propres tests). Le reste du parcours,
// sur une fausse base en mémoire : boutiquesEnsuiteRoute.test.ts.
// Interrupteurs forcés pour tout le fichier : un .env du Mac qui les
// allumerait ne change rien. Marques, boutiques et mots fictifs.
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, VOIE_C_ENABLED: false, VOIE_C_AI_ENABLED: false, ANTHROPIC_API_KEY: "faux-anthropic", ANTHROPIC_PHOTO_ENABLED: false } };
});
vi.mock("../src/services/visualSearch.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/visualSearch.js")>();
  return { ...original, searchProductsByImageUrl: vi.fn() };
});
vi.mock("../src/services/serpapi.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/serpapi.js")>();
  return { ...original, serpApiTextProvider: { name: "serpapi", searchByText: vi.fn() } };
});
vi.mock("../src/services/shoppingQueryAi.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/shoppingQueryAi.js")>();
  return { ...original, askShoppingQuery: vi.fn() };
});
vi.mock("../src/lib/searchCapacity.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/searchCapacity.js")>();
  return { ...original, reserveSearch: vi.fn(), releaseReservation: vi.fn(), searchCapacityBeforeComplementAi: vi.fn() };
});
vi.mock("../src/lib/aiQuota.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/aiQuota.js")>();
  return { ...original, aiQuotaFor: vi.fn() };
});
vi.mock("../src/lib/searchCache.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/searchCache.js")>();
  return { ...original, readCache: vi.fn(async () => null), writeCache: vi.fn(async () => undefined) };
});

import { env } from "../src/env.js";
import { searchProductsByImageUrl, type VisualMatch } from "../src/services/visualSearch.js";
import { serpApiTextProvider } from "../src/services/serpapi.js";
import { askShoppingQuery } from "../src/services/shoppingQueryAi.js";
import { releaseReservation, reserveSearch, searchCapacityBeforeComplementAi } from "../src/lib/searchCapacity.js";
import { aiQuotaFor } from "../src/lib/aiQuota.js";
import { COMPLEMENT_PENDING_MAX_MS } from "../src/lib/deferredComplement.js";
import type { TextSearchResponse } from "../src/services/searchProvider.js";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

const lensMock = vi.mocked(searchProductsByImageUrl);
const shoppingMock = vi.mocked(serpApiTextProvider.searchByText);
const aiMock = vi.mocked(askShoppingQuery);
const reserveMock = vi.mocked(reserveSearch);
const QUERY = "Exemplor veste Nuage 07";

const lensMatch = (rank: number, productName: string): VisualMatch => ({
  rank,
  productName,
  imageUrl: `https://images.lens.example/ensuite-${rank}.jpg`,
  imageHdUrl: null,
  merchantName: "Marchand Exemple",
  merchantUrl: `https://marchand.example/ensuite-${rank}`,
  priceValue: 60 + rank,
  currency: "€",
});
/** Ordre de Google ; « rouge » (vos mots) met la 3ᵉ en tête. */
const LENS = [lensMatch(1, "Exemplor veste Nuage 07 bleue"), lensMatch(2, "Veste Exemplor Nuage 07"), lensMatch(3, "Veste rouge brodée")];

function shopping(): TextSearchResponse {
  const item = (position: number, title: string) => ({
    position,
    title,
    link: `https://boutique.example/ensuite-${position}`,
    source: "Boutique Exemple",
    price: "49,99 €",
    extracted_price: 49.99,
    thumbnail: `https://images.boutique.example/ensuite-${position}.jpg`,
  });
  return { items: [item(1, "Exemplor veste Nuage 07"), item(2, "Veste bleue")], received: 2, statusCode: 200 };
}

describe("boutiques ensuite : le verrou de l'étape des boutiques, sur la base", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let other: TestUser;
  let photo: Buffer;
  let has0031 = false;
  const switches = { VOIE_C_ENABLED: env.VOIE_C_ENABLED, VOIE_C_AI_ENABLED: env.VOIE_C_AI_ENABLED };

  beforeAll(async () => {
    app = await buildTestApp();
    [user, other] = await Promise.all([createTestUser(app, "bea"), createTestUser(app, "beb")]);
    photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#806040" } }).jpeg().toBuffer();
    const probe = await app.supabaseAdmin.from("product_matches").select("lens_rank").limit(0);
    has0031 = !probe.error;
  });

  afterAll(async () => {
    Object.assign(env, switches);
    await deleteTestUser(app, user.id);
    await deleteTestUser(app, other.id);
    await app.close();
  });

  beforeEach(() => {
    Object.assign(env, { VOIE_C_ENABLED: true, VOIE_C_AI_ENABLED: true });
    lensMock.mockReset();
    lensMock.mockResolvedValue({
      matches: structuredClone(LENS),
      measure: { removedIncomplete: 0, removedSocial: 0, removedProfessional: 0, removedDuplicates: 0, received: 3, kept: 3, keptWithPrice: 3, keptOtherCurrency: 0, distinctSites: 3, sections: ["visual_matches"], googleState: null },
      addedRanks: [],
      statusCode: 200,
    });
    shoppingMock.mockReset();
    shoppingMock.mockResolvedValue(shopping());
    aiMock.mockReset();
    // L'IA met un peu de temps : les demandes simultanées arrivent pendant l'étape.
    aiMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { kind: "query", value: { query: QUERY, brand: "Exemplor", model: "Nuage 07" }, usage: { inputTokens: 900, outputTokens: 40 } };
    });
    let reservation = 7_000;
    reserveMock.mockReset();
    reserveMock.mockImplementation(async () => ({ allowed: true, reservationId: (reservation += 1) }));
    vi.mocked(releaseReservation).mockReset();
    vi.mocked(releaseReservation).mockResolvedValue(true);
    vi.mocked(searchCapacityBeforeComplementAi).mockReset();
    vi.mocked(searchCapacityBeforeComplementAi).mockResolvedValue({ allowed: true });
    vi.mocked(aiQuotaFor).mockReset();
    vi.mocked(aiQuotaFor).mockResolvedValue({ allowed: true });
  });

  /** Une recherche préparée (temps 1), puis lancée par la nouvelle app (boutiques ensuite). */
  async function deferredLaunch(fields: Record<string, string> = {}): Promise<string> {
    const prepared = await app.inject({ method: "POST", url: "/api/searches/prepare", headers: authHeaders(user.token), payload: {} });
    expect(prepared.statusCode).toBe(200);
    const id = z.object({ id: z.string() }).parse(prepared.json()).id;
    const mp = buildMultipart({ complement: "deferred", ...fields }, { fieldname: "file", filename: "photo.jpg", contentType: "image/jpeg", data: photo });
    const res = await app.inject({ method: "POST", url: `/api/searches/${id}/run`, headers: { ...authHeaders(user.token), ...mp.headers, "accept-language": "fr-FR" }, payload: mp.payload });
    expect(res.statusCode).toBe(200);
    expect(res.json().complement).toEqual({ status: null, suggestText: false, textStatus: null, pending: true });
    return id;
  }

  function complement(id: string, token = user.token) {
    return app.inject({ method: "POST", url: `/api/searches/${id}/complement`, headers: { ...authHeaders(token), "accept-language": "fr-FR" } });
  }

  async function row(id: string) {
    const { data, error } = await app.supabaseAdmin
      .from("product_searches")
      .select("status, complement_deferred, complement_deferred_at, complement_status, shopping_calls, text_suggested")
      .eq("id", id)
      .single();
    expect(error).toBeNull();
    return data as Record<string, unknown>;
  }

  async function matchRows(id: string) {
    const { data, error } = await app.supabaseAdmin.from("product_matches").select("rank, origin, lens_rank").eq("search_id", id).order("rank");
    expect(error).toBeNull();
    return data as { rank: number; origin: string; lens_rank: number | null }[];
  }

  it("le lancement note l'étape « pending », et l'ordre de Google seulement quand vos mots l'ont changé", async (context) => {
    if (!has0031) context.skip();
    const plain = await deferredLaunch();
    expect(await row(plain)).toMatchObject({ status: "completed", complement_deferred: "pending", complement_status: null, shopping_calls: 0, text_suggested: false });
    expect((await matchRows(plain)).map((match) => match.lens_rank)).toEqual([null, null, null]);
    const sorted = await deferredLaunch({ query: "rouge" });
    expect((await matchRows(sorted)).map((match) => [match.rank, match.lens_rank])).toEqual([
      [1, 3],
      [2, 1],
      [3, 2],
    ]);
    expect(aiMock).not.toHaveBeenCalled();
    expect(shoppingMock).not.toHaveBeenCalled();
  });

  it("cinq demandes simultanées : le verrou de la base ne laisse passer qu'une étape payante", async (context) => {
    if (!has0031) context.skip();
    const id = await deferredLaunch({ query: "rouge" });
    const replies = await Promise.all(Array.from({ length: 5 }, () => complement(id)));
    expect(replies.map((res) => res.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(aiMock).toHaveBeenCalledTimes(1);
    expect(shoppingMock).toHaveBeenCalledTimes(1);
    expect(reserveMock.mock.calls.filter((call) => call[4] === "shopping")).toHaveLength(1);
    for (const res of replies) expect(res.json().complement.status).toBe("shown");
    expect(replies.filter((res) => res.json().complement.query === QUERY)).toHaveLength(1);
    // L'ordre de Google a été envoyé à l'IA, puis effacé ; les boutiques une seule fois, après Lens.
    expect(aiMock.mock.calls[0]![0].map((item) => item.title)).toEqual(LENS.map((match) => match.productName));
    const matches = await matchRows(id);
    expect(matches.every((match) => match.lens_rank === null)).toBe(true);
    expect(matches.filter((match) => match.origin === "shopping").map((match) => match.rank)).toEqual([4, 5]);
    expect(await row(id)).toMatchObject({ complement_deferred: "done", complement_status: "shown", shopping_calls: 1 });
    // Plus tard : l'issue enregistrée, sans appel.
    const later = await complement(id);
    expect(later.statusCode).toBe(200);
    expect(aiMock).toHaveBeenCalledTimes(1);
  });

  it("la recherche d'une autre personne : 404, et l'étape reste à faire pour sa titulaire", async (context) => {
    if (!has0031) context.skip();
    const id = await deferredLaunch();
    const res = await complement(id, other.token);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "search_not_found", message: "Recherche introuvable." });
    expect(aiMock).not.toHaveBeenCalled();
    expect(await row(id)).toMatchObject({ complement_deferred: "pending" });
    expect((await complement(randomUUID())).statusCode).toBe(404);
  });

  it("étape en attente depuis plus de 5 minutes : close sans appel payant, ordre de Google effacé", async (context) => {
    if (!has0031) context.skip();
    const id = await deferredLaunch({ query: "rouge" });
    const { error } = await app.supabaseAdmin
      .from("product_searches")
      .update({ complement_deferred_at: new Date(Date.now() - COMPLEMENT_PENDING_MAX_MS - 5_000).toISOString() })
      .eq("id", id);
    expect(error).toBeNull();
    const res = await complement(id);
    expect(res.statusCode).toBe(200);
    expect(res.json().complement).toEqual({ status: "no_time", suggestText: false, textStatus: null });
    expect(aiMock).not.toHaveBeenCalled();
    expect(shoppingMock).not.toHaveBeenCalled();
    expect(await row(id)).toMatchObject({ complement_deferred: "done", complement_status: "no_time" });
    expect((await matchRows(id)).every((match) => match.lens_rank === null)).toBe(true);
  });

  it("une recherche lancée sans boutiques ensuite (app déjà installée) : refusée (409), sans appel", async (context) => {
    if (!has0031) context.skip();
    const prepared = await app.inject({ method: "POST", url: "/api/searches/prepare", headers: authHeaders(user.token), payload: {} });
    const id = z.object({ id: z.string() }).parse(prepared.json()).id;
    const mp = buildMultipart({}, { fieldname: "file", filename: "photo.jpg", contentType: "image/jpeg", data: photo });
    const launched = await app.inject({ method: "POST", url: `/api/searches/${id}/run`, headers: { ...authHeaders(user.token), ...mp.headers, "accept-language": "fr-FR" }, payload: mp.payload });
    expect(launched.statusCode).toBe(200);
    expect(launched.json().complement).toMatchObject({ status: "shown", query: QUERY });
    expect(launched.json().complement.pending).toBeUndefined();
    expect(aiMock).toHaveBeenCalledTimes(1);
    const res = await complement(id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "complement_not_deferred" });
    expect(aiMock).toHaveBeenCalledTimes(1);
  });
});
