import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../src/env.js";
import { QUOTA_ROWS } from "../src/lib/searchCapacity.js";
import { nextParisMidnight, parisMidnight } from "../src/lib/searchCapacityStatus.js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Lot limites annoncées : GET /api/searches/capacity contre la vraie base de
// développement (serpapi_quota de 0028), sans aucun appel à SerpApi. À lancer
// sur le Mac. Les plafonds sont lus à l'heure réelle (les fichiers de tests
// passent un par un) ; une seule ligne d'appel est inscrite, datée d'avant la
// lecture, puis effacée.

const HIGH = 1_000_000;

describe("compteur des recherches lu par l'app (lot limites annoncées)", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let other: TestUser;
  const saved = {
    SERPAPI_DAILY_CAP: env.SERPAPI_DAILY_CAP,
    SERPAPI_MONTHLY_CAP: env.SERPAPI_MONTHLY_CAP,
    SERPAPI_USER_DAILY_CAP: env.SERPAPI_USER_DAILY_CAP,
  };
  const start = new Date(Date.now() - 60_000);

  function read(token: string, language?: string) {
    return app.inject({
      method: "GET",
      url: "/api/searches/capacity",
      headers: { ...authHeaders(token), ...(language ? { "accept-language": language } : {}) },
    });
  }

  /** Une recherche aboutie de la personne, créée maintenant (aucun appel réel). */
  async function searchNow(owner: TestUser): Promise<void> {
    const { error } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: owner.id, source_platform: "photo", method: "manual_screenshot", status: "completed" });
    expect(error).toBeNull();
  }

  async function searchCount(owner: TestUser): Promise<number> {
    const { count, error } = await app.supabaseAdmin.from("product_searches").select("id", { count: "exact", head: true }).eq("user_id", owner.id);
    expect(error).toBeNull();
    return count ?? 0;
  }

  /** Un appel inscrit quelques secondes avant la lecture (un plafond très bas l'atteint) ; effacé ensuite. */
  async function callJustBefore(): Promise<number> {
    const { data, error } = await app.supabaseAdmin
      .from("serpapi_calls")
      .insert({ called_at: new Date(Date.now() - 5_000).toISOString() })
      .select("id")
      .single();
    expect(error).toBeNull();
    return z.object({ id: z.number() }).parse(data).id;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    [user, other] = await Promise.all([createTestUser(app, "capa"), createTestUser(app, "capb")]);
  });

  afterEach(() => {
    Object.assign(env, saved);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    Object.assign(env, saved);
    await app.supabaseAdmin.from("serpapi_calls").delete().gte("called_at", start.toISOString());
    await app.supabaseAdmin.from("product_searches").delete().in("user_id", [user.id, other.id]);
    await Promise.all([deleteTestUser(app, user.id), deleteTestUser(app, other.id)]);
    await app.close();
  });

  it("sans connexion : 401, rien n'est lu", async () => {
    const response = await app.inject({ method: "GET", url: "/api/searches/capacity" });
    expect(response.statusCode).toBe(401);
  });

  it("lecture seule : serpapi_quota appelée sans réservation, aucune recherche créée ; la part compte les recherches du jour de la personne, pas celles des autres", async () => {
    Object.assign(env, { SERPAPI_DAILY_CAP: HIGH, SERPAPI_MONTHLY_CAP: HIGH, SERPAPI_USER_DAILY_CAP: 3 });
    const rpc = vi.spyOn(app.supabaseAdmin, "rpc");
    await searchNow(user);
    await searchNow(user);
    await Promise.all([searchNow(other), searchNow(other), searchNow(other)]);
    const before = await searchCount(user);

    const first = await read(user.token);
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.json()).toEqual({
      user: { used: 2, limit: 3, remaining: 1, resetsAt: nextParisMidnight(new Date()).toISOString() },
      service: { status: "open" },
      remainingToday: 1,
    });
    // Relire ne change rien : aucune place prise.
    expect((await read(user.token)).json()).toMatchObject({ user: { used: 2, remaining: 1 }, remainingToday: 1 });
    expect(await searchCount(user)).toBe(before);
    expect(rpc.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [name, params] of rpc.mock.calls) {
      expect(name).toBe("serpapi_quota");
      expect(params).toMatchObject({ p_reserve: false, p_exclude_search: null, p_user_id: user.id });
    }

    await searchNow(user);
    expect((await read(user.token)).json()).toMatchObject({ user: { used: 3, remaining: 0 }, service: { status: "open" }, remainingToday: 0 });
    // L'autre personne ne voit que sa propre part.
    expect((await read(other.token)).json()).toMatchObject({ user: { used: 3, limit: 3, remaining: 0 } });
  });

  it("plafond du jour atteint : en pause jusqu'à minuit, heure de Paris ; rien ne reste à lancer", async () => {
    const id = await callJustBefore();
    try {
      Object.assign(env, { SERPAPI_DAILY_CAP: 1, SERPAPI_MONTHLY_CAP: HIGH, SERPAPI_USER_DAILY_CAP: HIGH });
      const response = await read(user.token);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        service: { status: "paused", reason: "day", reopensAt: nextParisMidnight(new Date()).toISOString() },
        remainingToday: 0,
      });
    } finally {
      await app.supabaseAdmin.from("serpapi_calls").delete().eq("id", id);
    }
  });

  it("plafond du mois atteint : en pause jusqu'à minuit (heure de Paris) du jour du renouvellement lu par la base", async () => {
    const id = await callJustBefore();
    try {
      Object.assign(env, { SERPAPI_DAILY_CAP: HIGH, SERPAPI_MONTHLY_CAP: 1, SERPAPI_USER_DAILY_CAP: HIGH });
      const { data, error } = await app.supabaseAdmin.rpc("serpapi_quota", {
        p_daily_cap: HIGH,
        p_monthly_cap: 1,
        p_user_daily_cap: HIGH,
        p_renewal_day: env.SERPAPI_RENEWAL_DAY,
        p_user_id: user.id,
        p_reserve: false,
      });
      expect(error).toBeNull();
      const { next_renewal } = QUOTA_ROWS.parse(data)[0]!;
      expect((await read(user.token)).json()).toMatchObject({
        service: { status: "paused", reason: "month", reopensAt: parisMidnight(next_renewal).toISOString() },
        remainingToday: 0,
      });
    } finally {
      await app.supabaseAdmin.from("serpapi_calls").delete().eq("id", id);
    }
  });

  it("base illisible : 503 et un message clair, dans la langue de la personne", async () => {
    vi.spyOn(app.supabaseAdmin, "rpc").mockResolvedValue({ data: null, error: { message: "base injoignable" } } as never);
    const french = await read(user.token);
    expect(french.statusCode).toBe(503);
    expect(french.json()).toEqual({ error: "search_capacity_unreadable", message: "Le compteur de recherches est momentanément illisible." });
    expect((await read(user.token, "en-GB")).json()).toEqual({ error: "search_capacity_unreadable", message: "The search counter can't be read right now." });
  });
});
