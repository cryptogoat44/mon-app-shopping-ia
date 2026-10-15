import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MATCH_FEEDBACK_DAILY_LIMIT } from "@monapp/shared-types";
import { parisDayStart } from "../src/lib/matchFeedback.js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Bouton « Résultat incohérent » (fiabilité des résultats, décisions du
// fondateur du 2026-10-15) : un motif parmi cinq, rien d'autre ; seulement sur
// ses propres propositions ; 30 par jour (jour de Paris), comptés dans la base.

async function createSearchWithMatches(app: FastifyInstance, userId: string, count: number): Promise<{ searchId: string; matchIds: string[] }> {
  const { data: search, error } = await app.supabaseAdmin
    .from("product_searches")
    .insert({ user_id: userId, source_url: null, source_platform: "photo", method: "manual_screenshot", status: "completed" })
    .select("id")
    .single();
  if (error || !search) throw error ?? new Error("recherche non créée");
  const rows = Array.from({ length: count }, (_, i) => ({
    search_id: search.id,
    rank: i + 1,
    product_name: `Veste ${i + 1}`,
    image_url: "https://example.com/vignette.jpg",
    merchant_url: `https://marchand.example/veste-${i + 1}`,
  }));
  const { data: matches, error: matchesError } = await app.supabaseAdmin.from("product_matches").insert(rows).select("id, rank");
  if (matchesError || !matches) throw matchesError ?? new Error("propositions non créées");
  return { searchId: search.id, matchIds: [...matches].sort((a, b) => a.rank - b.rank).map((m) => m.id) };
}

describe("bouton « Résultat incohérent »", () => {
  let app: FastifyInstance;
  let owner: TestUser;
  let other: TestUser;
  let searchId = "";
  let matchIds: string[] = [];
  let otherMatchId = "";

  const send = (matchId: string, payload: unknown, who: TestUser = owner, language?: string) =>
    app.inject({
      method: "POST",
      url: `/api/product-matches/${matchId}/feedback`,
      headers: { ...authHeaders(who.token), ...(language ? { "accept-language": language } : {}) },
      payload: payload as Record<string, unknown>,
    });
  const withdraw = (matchId: string, who: TestUser = owner) =>
    app.inject({ method: "DELETE", url: `/api/product-matches/${matchId}/feedback`, headers: authHeaders(who.token) });
  const rowsOf = async (userId: string) => {
    const { data, error } = await app.supabaseAdmin.from("match_feedback").select("*").eq("user_id", userId);
    if (error) throw error;
    return data ?? [];
  };

  beforeAll(async () => {
    app = await buildTestApp();
    [owner, other] = await Promise.all([createTestUser(app, "rfa"), createTestUser(app, "rfb")]);
    ({ searchId, matchIds } = await createSearchWithMatches(app, owner.id, MATCH_FEEDBACK_DAILY_LIMIT + 1));
    otherMatchId = (await createSearchWithMatches(app, other.id, 1)).matchIds[0]!;
  });

  afterAll(async () => {
    await deleteTestUser(app, owner.id);
    await deleteTestUser(app, other.id);
    await app.close();
  });

  it("signaler, changer de motif, retirer : la proposition porte le motif choisi, et rien d'autre n'est rangé", async () => {
    const first = await send(matchIds[0]!, { reason: "wrong_item" });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ reason: "wrong_item" });

    const search = (await app.inject({ method: "GET", url: `/api/searches/${searchId}`, headers: authHeaders(owner.token) })).json();
    expect(search.matches[0].feedbackReason).toBe("wrong_item");
    expect(search.matches[1].feedbackReason).toBeNull();

    const rows = await rowsOf(owner.id);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["created_at", "id", "match_id", "reason", "updated_at", "user_id"]);

    expect((await send(matchIds[0]!, { reason: "not_for_sale" })).json()).toEqual({ reason: "not_for_sale" });
    expect((await rowsOf(owner.id)).map((row) => row.reason)).toEqual(["not_for_sale"]);

    expect((await withdraw(matchIds[0]!)).statusCode).toBe(204);
    expect(await rowsOf(owner.id)).toEqual([]);
    const after = (await app.inject({ method: "GET", url: `/api/searches/${searchId}`, headers: authHeaders(owner.token) })).json();
    expect(after.matches[0].feedbackReason).toBeNull();
  });

  it("entrée invalide : motif inconnu, texte libre ajouté, identifiant mal formé — rien n'est rangé", async () => {
    expect((await send(matchIds[0]!, { reason: "autre" })).statusCode).toBe(400);
    expect((await send(matchIds[0]!, { reason: "wrong_price", note: "le prix est faux" })).statusCode).toBe(400);
    expect((await send(matchIds[0]!, {})).statusCode).toBe(400);
    expect((await send("pas-un-identifiant", { reason: "wrong_price" })).statusCode).toBe(400);
    expect((await withdraw("pas-un-identifiant")).statusCode).toBe(400);
    expect(await rowsOf(owner.id)).toEqual([]);
  });

  it("accès refusé : la proposition d'un autre compte, ou introuvable, sans dire laquelle des deux", async () => {
    const foreign = await send(otherMatchId, { reason: "duplicate" });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().message).toBe("Proposition introuvable.");
    expect((await send("00000000-0000-4000-8000-000000000000", { reason: "duplicate" })).statusCode).toBe(404);
    expect(await rowsOf(owner.id)).toEqual([]);
    // Retirer le signalement d'un autre n'a aucun effet.
    const { error } = await app.supabaseAdmin.from("match_feedback").insert({ user_id: other.id, match_id: otherMatchId, reason: "duplicate" });
    expect(error).toBeNull();
    expect((await withdraw(otherMatchId)).statusCode).toBe(204);
    expect(await rowsOf(other.id)).toHaveLength(1);
    await app.supabaseAdmin.from("match_feedback").delete().eq("user_id", other.id);
  });

  it("30 par jour : le 31ᵉ est refusé (message en français et en anglais) ; changer de motif reste permis ; ceux d'hier ne comptent pas", async () => {
    const thirty = matchIds.slice(0, MATCH_FEEDBACK_DAILY_LIMIT).map((match_id) => ({ user_id: owner.id, match_id, reason: "wrong_item" }));
    const { error } = await app.supabaseAdmin.from("match_feedback").insert(thirty);
    expect(error).toBeNull();

    const refused = await send(matchIds[MATCH_FEEDBACK_DAILY_LIMIT]!, { reason: "wrong_price" });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({
      error: "feedback_limit",
      message: "Vous avez atteint la limite de signalements pour aujourd'hui. Merci de votre aide : vous pourrez en envoyer d'autres demain.",
    });
    const english = await send(matchIds[MATCH_FEEDBACK_DAILY_LIMIT]!, { reason: "wrong_price" }, owner, "en");
    expect(english.json().message).toBe("You've reached today's limit of reports. Thank you for your help: you can send more tomorrow.");

    expect((await send(matchIds[0]!, { reason: "duplicate" })).statusCode).toBe(200);

    const yesterday = new Date(parisDayStart().getTime() - 3_600_000).toISOString();
    await app.supabaseAdmin.from("match_feedback").update({ created_at: yesterday }).eq("user_id", owner.id);
    expect((await send(matchIds[MATCH_FEEDBACK_DAILY_LIMIT]!, { reason: "wrong_price" })).statusCode).toBe(200);
    expect(await rowsOf(owner.id)).toHaveLength(MATCH_FEEDBACK_DAILY_LIMIT + 1);
    await app.supabaseAdmin.from("match_feedback").delete().eq("user_id", owner.id);
  });

  it("suppression du compte : ses signalements disparaissent avec lui", async () => {
    const leaving = await createTestUser(app, "rfc");
    const { matchIds: ids } = await createSearchWithMatches(app, leaving.id, 1);
    expect((await send(ids[0]!, { reason: "image_title_mismatch" }, leaving)).statusCode).toBe(200);
    expect(await rowsOf(leaving.id)).toHaveLength(1);
    await deleteTestUser(app, leaving.id);
    expect(await rowsOf(leaving.id)).toEqual([]);
  });
});

describe("jour de Paris (limite des signalements)", () => {
  it("commence à minuit heure de Paris, en été comme en hiver, et juste après minuit", () => {
    expect(parisDayStart(new Date("2026-10-15T20:30:00Z")).toISOString()).toBe("2026-10-14T22:00:00.000Z");
    expect(parisDayStart(new Date("2026-10-15T22:30:00Z")).toISOString()).toBe("2026-10-15T22:00:00.000Z");
    expect(parisDayStart(new Date("2026-12-01T10:00:00Z")).toISOString()).toBe("2026-11-30T23:00:00.000Z");
    expect(parisDayStart(new Date("2026-10-25T12:00:00Z")).toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(parisDayStart(new Date("2026-03-29T12:00:00Z")).toISOString()).toBe("2026-03-28T23:00:00.000Z");
  });
});
