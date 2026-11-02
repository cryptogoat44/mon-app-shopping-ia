import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

// « Que cherchez-vous ? » (voie B, lot c, 2026-11-02) : POST
// /api/searches/:id/text, sur la MÊME recherche, une seule fois, dans le
// budget de la photo (3 recherches au plus). Test de base de données : à
// lancer sur le Mac, contre spotto-dev-2, APRÈS la migration 0028.
// Aucun appel réel : Google Shopping est simulé, le plafond des recherches
// aussi (ses fonctions réelles sont testées dans searchCapacity.test.ts).
// Interrupteurs forcés pour tout le fichier : un .env du Mac qui les
// allumerait ne change rien. Marques et boutiques fictives.
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, VOIE_C_ENABLED: false, VOIE_C_AI_ENABLED: false, ANTHROPIC_PHOTO_ENABLED: false } };
});
vi.mock("../src/services/serpapi.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/serpapi.js")>();
  return { ...original, callShopping: vi.fn(), serpApiTextProvider: { name: "serpapi", searchByText: vi.fn() } };
});
vi.mock("../src/lib/searchCapacity.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/searchCapacity.js")>();
  return { ...original, reserveSearch: vi.fn(), releaseReservation: vi.fn(), searchCapacityBeforeComplementAi: vi.fn() };
});

import { env } from "../src/env.js";
import { serpApiTextProvider } from "../src/services/serpapi.js";
import { ProviderFailure, type TextSearchResponse } from "../src/services/searchProvider.js";
import { releaseReservation, reserveSearch } from "../src/lib/searchCapacity.js";
import { parisDayStart } from "../src/lib/matchFeedback.js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

const textMock = vi.mocked(serpApiTextProvider.searchByText);
const reserveMock = vi.mocked(reserveSearch);
const releaseMock = vi.mocked(releaseReservation);
const RESERVATION = 5151;
const NO_MATCH = "Aucun produit identifié sur cette image.";
const TECHNICAL = "La recherche visuelle a échoué.";
const WORDS = "veste en daim Exemplor";

/** Réponse fictive de Google Shopping ; `link` de la 2ᵉ : une page déjà proposée par Lens (retirée). */
function shopping(): TextSearchResponse {
  const item = (position: number, title: string, link: string) => ({
    position,
    title,
    link,
    source: "Boutique Exemple",
    price: "89,00 €",
    extracted_price: 89,
    thumbnail: `https://images.boutique.example/mots-${position}.jpg`,
  });
  return {
    items: [item(1, "Veste en daim Exemplor", "https://boutique.example/mots-1"), item(2, "Veste en daim", "https://marchand.example/lens-1"), item(3, "Blouson daim", "https://boutique.example/mots-3")],
    received: 3,
    statusCode: 200,
  };
}

describe("« Que cherchez-vous ? » : une recherche avec vos mots, sur la même recherche (voie B)", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let other: TestUser;
  const switches = { VOIE_C_ENABLED: env.VOIE_C_ENABLED };

  beforeAll(async () => {
    app = await buildTestApp();
    [user, other] = await Promise.all([createTestUser(app, "txa"), createTestUser(app, "txb")]);
  });

  afterAll(async () => {
    Object.assign(env, switches);
    await deleteTestUser(app, user.id);
    await deleteTestUser(app, other.id);
    await app.close();
  });

  beforeEach(() => {
    env.VOIE_C_ENABLED = true;
    textMock.mockReset();
    textMock.mockResolvedValue(shopping());
    reserveMock.mockReset();
    reserveMock.mockResolvedValue({ allowed: true, reservationId: RESERVATION });
    releaseMock.mockReset();
    releaseMock.mockResolvedValue(true);
  });

  /** Une recherche déjà lancée, dans l'état voulu (aucun appel réel). */
  async function searchRow(columns: Record<string, unknown>, owner: TestUser = user): Promise<string> {
    const { data, error } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: owner.id, source_platform: "photo", method: "manual_screenshot", ...columns })
      .select("id")
      .single();
    expect(error).toBeNull();
    return z.object({ id: z.string() }).parse(data).id;
  }

  /** Une proposition Lens rangée (avec son lien, comme saveMatches). */
  async function lensRow(searchId: string, rank: number): Promise<void> {
    const { data, error } = await app.supabaseAdmin
      .from("product_matches")
      .insert({ search_id: searchId, rank, product_name: `Pièce Lens ${rank}`, image_url: `https://images.lens.example/${rank}.jpg`, merchant_url: `https://marchand.example/lens-${rank}` })
      .select("id, merchant_url")
      .single();
    expect(error).toBeNull();
    const row = z.object({ id: z.string(), merchant_url: z.string() }).parse(data);
    await app.supabaseAdmin.from("affiliate_links").insert({ product_match_id: row.id, network: "direct", affiliate_url: row.merchant_url });
  }

  async function completedWithLens(): Promise<string> {
    const id = await searchRow({ status: "completed", outcome: "found", complement_status: "empty", text_suggested: true, shopping_calls: 1 });
    await lensRow(id, 1);
    await lensRow(id, 2);
    return id;
  }

  function text(searchId: string, words: unknown = WORDS, token = user.token) {
    return app.inject({ method: "POST", url: `/api/searches/${searchId}/text`, headers: authHeaders(token), payload: { words } });
  }

  async function columnsOf(searchId: string) {
    const { data } = await app.supabaseAdmin
      .from("product_searches")
      .select("status, error_message, text_requested_at, text_status, text_suggested, shopping_calls, served_from_cache, query")
      .eq("id", searchId)
      .single();
    return data;
  }

  /** Lignes écrites par le serveur lui-même : sans « incoming request » ni
   * « request completed » de Fastify (avec logger: false, request.log est
   * app.log, et ces deux lignes portent la requête entière, corps compris). */
  function appLines(journal: { mock: { calls: unknown[][] } }): unknown[][] {
    return journal.mock.calls.filter((call) => call[1] !== "incoming request" && call[1] !== "request completed");
  }

  it("voie C coupée : 404 text_search_unavailable, sans réservation ni appel", async () => {
    env.VOIE_C_ENABLED = false;
    const id = await completedWithLens();
    const res = await text(id);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("text_search_unavailable");
    expect(reserveMock).not.toHaveBeenCalled();
    expect(textMock).not.toHaveBeenCalled();
    expect(await columnsOf(id)).toMatchObject({ text_requested_at: null, text_status: null });
  });

  it("une seule fois : vos mots donnent des propositions « words », rangées après les autres, avec leurs liens ; la seconde demande reçoit 409, sans appel", async () => {
    const id = await completedWithLens();
    const journal = vi.spyOn(app.log, "info");
    try {
      const res = await text(id, `  ${WORDS} site:exemple.fr -cuir  `);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("completed");
      expect(body.complement).toEqual({ status: "empty", suggestText: false, textStatus: "shown" });
      // Lens d'abord, inchangé ; vos mots ensuite (la page déjà proposée par Lens est retirée).
      expect(body.matches.map((m: { rank: number; productName: string; origin?: string }) => [m.rank, m.productName, m.origin ?? "lens"])).toEqual([
        [1, "Pièce Lens 1", "lens"],
        [2, "Pièce Lens 2", "lens"],
        [3, "Veste en daim Exemplor", "words"],
        [4, "Blouson daim", "words"],
      ]);
      expect(body.matches[2]).toMatchObject({ affiliateUrl: "https://boutique.example/mots-1", priceMin: 89, currency: "EUR" });
      // Opérateurs de Google retirés : vos mots, rien d'autre ; une place « shopping », la recherche hors de la part.
      expect(textMock).toHaveBeenCalledOnce();
      expect(textMock.mock.calls[0]!.slice(0, 2)).toEqual([WORDS, { hl: "fr", country: "fr" }]);
      expect(reserveMock.mock.calls.map((call) => call.slice(2))).toEqual([[user.id, id, "shopping"]]);

      const columns = await columnsOf(id);
      expect(columns).toMatchObject({ text_status: "shown", text_suggested: false, shopping_calls: 2, query: null });
      expect(columns?.text_requested_at).not.toBeNull();

      // Journal : la ligne « Mesure complément » (vos mots), jamais vos mots ni une adresse.
      const lignes = journal.mock.calls.filter((call) => call[1] === "Mesure complément");
      expect(lignes.map((call) => call[0])).toEqual([expect.objectContaining({ source: "words", status: "shown", calls: 1, kept: 2 })]);
      const texte = JSON.stringify(appLines(journal));
      for (const interdit of ["daim", "Exemplor", "http", id, user.id]) expect(texte).not.toContain(interdit);
    } finally {
      journal.mockRestore();
    }

    const again = await text(id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("text_search_already_used");
    expect(textMock).toHaveBeenCalledOnce();
    expect(reserveMock).toHaveBeenCalledOnce();
  });

  it("« rien trouvé » complété par vos mots : la recherche devient terminée, et apparaît dans « Récemment spottées »", async () => {
    const id = await searchRow({ status: "failed", error_message: NO_MATCH, outcome: "empty_lens", complement_status: "no_query", text_suggested: true });
    const res = await text(id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "completed", errorMessage: null, complement: { status: "no_query", suggestText: false, textStatus: "shown" } });
    expect(res.json().matches.map((m: { origin?: string }) => m.origin)).toEqual(["words", "words", "words"]);
    // La mesure de Lens reste celle du lancement.
    const { data } = await app.supabaseAdmin.from("product_searches").select("outcome").eq("id", id).single();
    expect(data).toEqual({ outcome: "empty_lens" });
    const recent = (await app.inject({ method: "GET", url: "/api/searches?limit=20", headers: authHeaders(user.token) })).json();
    const listed = recent.find((search: { id: string }) => search.id === id);
    expect(listed?.matches.map((m: { origin?: string }) => m.origin)).toEqual(["words"]);
  });

  it("plafond atteint : 429 avec le message du plafond, le verrou est remis — une nouvelle demande passe", async () => {
    const id = await completedWithLens();
    reserveMock.mockResolvedValueOnce({ allowed: false, limit: "day", resumesOn: null });
    const refused = await text(id);
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error).toBe("search_capacity_day");
    expect(textMock).not.toHaveBeenCalled();
    expect(await columnsOf(id)).toMatchObject({ text_requested_at: null, text_status: null, shopping_calls: 1 });

    // Plafond illisible : une panne, et le verrou est remis aussi.
    reserveMock.mockRejectedValueOnce(new Error("base injoignable"));
    expect((await text(id)).statusCode).toBe(500);
    expect(await columnsOf(id)).toMatchObject({ text_requested_at: null });

    expect((await text(id)).statusCode).toBe(200);
    expect(textMock).toHaveBeenCalledOnce();
  });

  it("budget de la photo épuisé (Lens + 2 recherches dans les boutiques) : 409 text_search_not_allowed, sans réservation ni appel", async () => {
    const id = await searchRow({ status: "completed", outcome: "found", complement_status: "empty", text_suggested: true, shopping_calls: 2 });
    await lensRow(id, 1);
    const res = await text(id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("text_search_not_allowed");
    expect(reserveMock).not.toHaveBeenCalled();
    expect(textMock).not.toHaveBeenCalled();
    expect(await columnsOf(id)).toMatchObject({ text_requested_at: null });

    // Lens venu du cache (aucun appel) + 1 recherche dans les boutiques : encore permise (0 + 1 + 1 ≤ 3).
    const cached = await searchRow({ status: "completed", outcome: "found", lens_from_cache: true, complement_status: "empty", text_suggested: true, shopping_calls: 1 });
    await lensRow(cached, 1);
    expect((await text(cached)).statusCode).toBe(200);
  });

  it("invitation jamais proposée (résultat fiable, ancienne recherche de l'historique) : 409 text_search_not_allowed, rien n'est verrouillé ni réservé", async () => {
    const reliable = await searchRow({ status: "completed", outcome: "found", complement_status: "shown", text_suggested: false, shopping_calls: 1 });
    await lensRow(reliable, 1);
    const old = await searchRow({ status: "completed", outcome: "found" });
    await lensRow(old, 1);
    for (const id of [reliable, old]) {
      const res = await text(id);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("text_search_not_allowed");
      expect(await columnsOf(id)).toMatchObject({ text_requested_at: null });
    }
    expect(reserveMock).not.toHaveBeenCalled();
    expect(textMock).not.toHaveBeenCalled();
  });

  it("recherche servie entièrement par le cache : après vos mots (un appel réel), elle compte dans la part de 8 par personne ; refusée par le plafond, elle reste hors de la part", async () => {
    const id = await searchRow({ status: "completed", outcome: "found", lens_from_cache: true, served_from_cache: true, complement_status: "empty", text_suggested: true });
    await lensRow(id, 1);
    reserveMock.mockResolvedValueOnce({ allowed: false, limit: "user", resumesOn: null });
    const refused = await text(id);
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error).toBe("search_capacity_user");
    expect(await columnsOf(id)).toMatchObject({ text_requested_at: null, served_from_cache: true, shopping_calls: 0 });

    expect((await text(id)).statusCode).toBe(200);
    expect(textMock).toHaveBeenCalledOnce();
    expect(await columnsOf(id)).toMatchObject({ served_from_cache: false, shopping_calls: 1, text_status: "shown" });
  });

  it("servie par le cache un jour précédent (jamais comptée dans une part de 8) : 409 text_search_not_allowed, rien n'est verrouillé ni réservé, l'invitation n'est plus annoncée ; une recherche ordinaire d'hier reste permise", async () => {
    const yesterday = new Date(parisDayStart().getTime() - 3_600_000).toISOString();
    const id = await searchRow({ status: "completed", outcome: "found", lens_from_cache: true, served_from_cache: true, complement_status: "empty", text_suggested: true, created_at: yesterday });
    await lensRow(id, 1);
    const res = await text(id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("text_search_not_allowed");
    expect(reserveMock).not.toHaveBeenCalled();
    expect(textMock).not.toHaveBeenCalled();
    expect(await columnsOf(id)).toMatchObject({ text_requested_at: null, served_from_cache: true, text_suggested: true, shopping_calls: 0 });
    const read = await app.inject({ method: "GET", url: `/api/searches/${id}`, headers: authHeaders(user.token) });
    expect(read.json().complement).toMatchObject({ status: "empty", suggestText: false });

    // Lancée hier avec un vrai appel à Lens : elle a compté hier, la voie B reste possible.
    const ordinary = await searchRow({ status: "completed", outcome: "found", complement_status: "empty", text_suggested: true, shopping_calls: 1, created_at: yesterday });
    await lensRow(ordinary, 1);
    expect((await text(ordinary)).statusCode).toBe(200);
    expect(textMock).toHaveBeenCalledOnce();
  });

  it("recherche non admissible (pas encore lancée, en panne technique) : 409 ; celle d'un autre : 404 ; rien n'est verrouillé", async () => {
    const pending = await searchRow({ status: "pending" });
    const broken = await searchRow({ status: "failed", error_message: TECHNICAL, outcome: "failure", failure_kind: "timeout" });
    for (const id of [pending, broken]) {
      const res = await text(id);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("text_search_not_allowed");
      expect(await columnsOf(id)).toMatchObject({ text_requested_at: null });
    }
    const theirs = await searchRow({ status: "completed", outcome: "found" }, other);
    expect((await text(theirs)).statusCode).toBe(404);
    expect(await columnsOf(theirs)).toMatchObject({ text_requested_at: null });
    expect(reserveMock).not.toHaveBeenCalled();
  });

  it("mots vides une fois les opérateurs retirés, trop longs ou absents : 400, rien n'est verrouillé ni appelé", async () => {
    const id = await completedWithLens();
    for (const words of ["site:exemple.fr -cuir OR '-daim", "x".repeat(61), "   "]) {
      const res = await text(id, words);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_body");
    }
    // Mots absents : un corps sans « words », envoyé sans l'outil text() (sa
    // valeur par défaut remplacerait un « undefined » par de vrais mots).
    const absent = await app.inject({ method: "POST", url: `/api/searches/${id}/text`, headers: authHeaders(user.token), payload: {} });
    expect(absent.statusCode).toBe(400);
    expect(absent.json().error).toBe("invalid_body");
    expect(await columnsOf(id)).toMatchObject({ text_requested_at: null });
    expect(reserveMock).not.toHaveBeenCalled();
    expect(textMock).not.toHaveBeenCalled();
  });

  it("Google Shopping en panne : « shopping_failed », la recherche reste telle quelle, la demande est consommée ; un refus non facturé rend sa place", async () => {
    const id = await searchRow({ status: "failed", error_message: NO_MATCH, outcome: "nothing_buyable", complement_status: "no_query", text_suggested: true });
    textMock.mockRejectedValueOnce(new ProviderFailure("timeout", null, "délai dépassé"));
    const res = await text(id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "failed", errorMessage: NO_MATCH, matches: [], complement: { textStatus: "shopping_failed", suggestText: false } });
    expect(releaseMock).not.toHaveBeenCalled();
    expect(await columnsOf(id)).toMatchObject({ status: "failed", text_status: "shopping_failed", shopping_calls: 1 });
    expect((await text(id)).json().error).toBe("text_search_already_used");

    const refused = await completedWithLens();
    textMock.mockRejectedValueOnce(new ProviderFailure("refused", 429, "refus"));
    expect((await text(refused)).json().complement.textStatus).toBe("shopping_failed");
    expect(releaseMock).toHaveBeenCalledOnce();
    expect(releaseMock.mock.calls[0]!.slice(2)).toEqual([RESERVATION, "shopping"]);
    // Place rendue : l'appel ne compte pas dans le budget de la photo (1 avant, 1 après).
    expect(await columnsOf(refused)).toMatchObject({ text_status: "shopping_failed", text_suggested: false, shopping_calls: 1 });
  });

  it("refus non facturé dont la place est rendue, sur une recherche servie par le cache : la demande est consommée, mais elle reste hors de la part de 8 ; place non rendue : l'appel compte", async () => {
    const cached = await searchRow({ status: "completed", outcome: "found", lens_from_cache: true, served_from_cache: true, complement_status: "empty", text_suggested: true });
    await lensRow(cached, 1);
    textMock.mockRejectedValueOnce(new ProviderFailure("refused", 503, "refus"));
    const res = await text(cached);
    expect(res.statusCode).toBe(200);
    expect(res.json().complement).toMatchObject({ textStatus: "shopping_failed", suggestText: false });
    expect(releaseMock).toHaveBeenCalledOnce();
    const columns = await columnsOf(cached);
    expect(columns).toMatchObject({ text_status: "shopping_failed", text_suggested: false, served_from_cache: true, shopping_calls: 0 });
    expect(columns?.text_requested_at).not.toBeNull();
    expect((await text(cached)).json().error).toBe("text_search_already_used");

    // Place non rendue (base injoignable) : l'appel reste compté, la recherche compte comme une photo.
    const kept = await searchRow({ status: "completed", outcome: "found", lens_from_cache: true, served_from_cache: true, complement_status: "empty", text_suggested: true });
    await lensRow(kept, 1);
    textMock.mockRejectedValueOnce(new ProviderFailure("refused", 429, "refus"));
    releaseMock.mockResolvedValueOnce(false);
    expect((await text(kept)).statusCode).toBe(200);
    expect(await columnsOf(kept)).toMatchObject({ text_status: "shopping_failed", served_from_cache: false, shopping_calls: 1 });
  });

  it("Google Shopping ne garde rien : « empty », aucune ligne ajoutée", async () => {
    const id = await completedWithLens();
    textMock.mockResolvedValueOnce({ items: [], received: 0, statusCode: 200 });
    const res = await text(id);
    expect(res.json().complement.textStatus).toBe("empty");
    expect(res.json().matches.map((m: { origin?: string }) => m.origin ?? "lens")).toEqual(["lens", "lens"]);
    expect(await columnsOf(id)).toMatchObject({ text_status: "empty", shopping_calls: 2 });
  });
});
