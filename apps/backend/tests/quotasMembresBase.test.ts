import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { env } from "../src/env.js";
import { resetMemberQuotasProbe } from "../src/lib/memberQuotas.js";
import { QUOTA_ROWS } from "../src/lib/searchCapacity.js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Quotas par membre (migration 0053) contre la vraie base de développement
// (spotto-dev-2), sans aucun appel à SerpApi. À lancer sur le Mac, une fois
// 0053 appliquée (sans elle, tout est sauté). Les appels et les recherches
// inscrits sont datés d'une année fictive tirée au hasard entre 1980 et 2005
// (p_at) : jamais mêlés aux vrais appels, ni aux autres fichiers de tests ;
// ils sont effacés à la fin, avec les comptes de test.

const probe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).rpc("member_quotas_version");
const MIGRATED = !probe.error && probe.data === 1;
const YEAR = 1980 + Math.floor(Math.random() * 26);
const HOUR = 3_600_000;

/** Un instant de l'année fictive, en heure de Paris (« MM-JJThh:mm », décalage donné). */
const at = (monthDay: string, offset = "+01:00", year = YEAR) => new Date(`${year}-${monthDay}:00${offset}`);

describe.skipIf(!MIGRATED)("quotas par membre : serpapi_quota_v2 et member_entitlements (base de développement, 0053)", () => {
  let app: FastifyInstance;
  let free: TestUser;
  let subscriber: TestUser;

  interface Call {
    user: TestUser;
    at: Date;
    daily?: number;
    monthly?: number;
    userDaily?: number;
    monthlyCap: number | null;
    reserve: number;
    reserveCall?: boolean;
  }

  async function quota(call: Call) {
    const { data, error } = await app.supabaseAdmin.rpc("serpapi_quota_v2", {
      p_daily_cap: call.daily ?? 1000,
      p_monthly_cap: call.monthly ?? 100_000,
      p_user_daily_cap: call.userDaily ?? 1000,
      p_renewal_day: 1,
      p_user_id: call.user.id,
      p_reserve: call.reserveCall ?? false,
      p_user_monthly_cap: call.monthlyCap,
      p_reserve_percent: call.reserve,
      p_at: call.at.toISOString(),
    });
    expect(error).toBeNull();
    // Le schéma du serveur lit la vraie réponse de la base.
    return QUOTA_ROWS.parse(data)[0]!;
  }

  async function search(owner: TestUser, createdAt: Date, fields: Record<string, unknown> = {}) {
    const { error } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: owner.id, source_platform: "photo", method: "manual_screenshot", status: "completed", created_at: createdAt.toISOString(), ...fields });
    expect(error).toBeNull();
  }

  async function seedCalls(count: number, calledAt: Date) {
    const { error } = await app.supabaseAdmin.from("serpapi_calls").insert(Array.from({ length: count }, () => ({ called_at: calledAt.toISOString() })));
    expect(error).toBeNull();
  }

  beforeAll(async () => {
    app = await buildTestApp();
    [free, subscriber] = await Promise.all([createTestUser(app, "quota"), createTestUser(app, "quotab")]);
  });

  afterAll(async () => {
    await app.supabaseAdmin
      .from("serpapi_calls")
      .delete()
      .gte("called_at", new Date(Date.UTC(YEAR - 1, 0, 1)).toISOString())
      .lte("called_at", new Date(Date.UTC(YEAR + 2, 0, 1)).toISOString());
    await app.supabaseAdmin.from("product_searches").delete().in("user_id", [free.id, subscriber.id]);
    await Promise.all([deleteTestUser(app, free.id), deleteTestUser(app, subscriber.id)]);
    await app.close();
  });

  it("deux réservations simultanées pour la dernière place d'un compte gratuit (réserve de 30 %) : une seule passe", async () => {
    const when = at("02-10T12:00");
    // Plafond du jour 10, réserve 30 % : 7 pour un compte gratuit ; 6 déjà pris.
    await seedCalls(6, at("02-10T08:00"));
    const calls = await Promise.all([1, 2].map(() => quota({ user: free, at: when, daily: 10, monthlyCap: 100, reserve: 30, reserveCall: true })));
    expect(calls.map((row) => row.allowed).sort()).toEqual([false, true]);
    expect(calls.find((row) => !row.allowed)).toMatchObject({ refused_by: "day", day_count: 7 });
  });

  it("réserve : un compte gratuit s'arrête à 70 %, un abonné va jusqu'au plafond ; réserve à 0 (abonnements coupés), le gratuit aussi", async () => {
    const when = at("03-12T12:00");
    await seedCalls(7, at("03-12T08:00"));
    expect(await quota({ user: free, at: when, daily: 10, monthlyCap: 100, reserve: 30 })).toMatchObject({ allowed: false, refused_by: "day" });
    expect(await quota({ user: subscriber, at: when, daily: 10, monthlyCap: null, reserve: 0 })).toMatchObject({ allowed: true });
    expect(await quota({ user: free, at: when, daily: 10, monthlyCap: 100, reserve: 0 })).toMatchObject({ allowed: true });
    // Le mois de SerpApi : 70 appels sur 100.
    await seedCalls(63, at("03-05T08:00"));
    expect(await quota({ user: free, at: when, monthly: 100, monthlyCap: 100, reserve: 30 })).toMatchObject({ allowed: false, refused_by: "month" });
    expect(await quota({ user: subscriber, at: when, monthly: 100, monthlyCap: null, reserve: 0 })).toMatchObject({ allowed: true });
  });

  it("part du mois : la 4e refusée sur 3, reprise le 1er ; jamais une recherche servie par le cache ni en panne ; un abonné sans part passe", async () => {
    for (const day of ["05-03T10:00", "05-04T10:00", "05-05T10:00"]) await search(free, at(day, "+02:00"));
    await search(free, at("05-06T10:00", "+02:00"), { served_from_cache: true, lens_from_cache: true });
    await search(free, at("05-06T11:00", "+02:00"), { status: "failed", failure_kind: "provider_error" });
    const refused = await quota({ user: free, at: at("05-07T12:00", "+02:00"), monthlyCap: 3, reserve: 0 });
    expect(refused).toMatchObject({ allowed: false, refused_by: "user_month", user_month_count: 3, month_resets_on: `${YEAR}-06-01` });
    expect(await quota({ user: free, at: at("05-07T12:00", "+02:00"), monthlyCap: 4, reserve: 0 })).toMatchObject({ allowed: true, user_month_count: 3 });
    expect(await quota({ user: free, at: at("05-07T12:00", "+02:00"), monthlyCap: null, reserve: 0 })).toMatchObject({ allowed: true });
    expect(await quota({ user: free, at: at("06-01T00:01", "+02:00"), monthlyCap: 3, reserve: 0 })).toMatchObject({ allowed: true, user_month_count: 0 });
  });

  it("le mois change à minuit, heure de Paris, y compris aux changements d'heure (fin octobre et fin mars)", async () => {
    // Le dernier dimanche d'octobre est toujours passé le 31 : heure d'hiver (+01:00).
    await search(subscriber, at("10-31T23:30"));
    expect(await quota({ user: subscriber, at: at("10-31T23:45"), monthlyCap: 5, reserve: 0 })).toMatchObject({ user_month_count: 1, month_resets_on: `${YEAR}-11-01` });
    expect(await quota({ user: subscriber, at: at("11-01T00:01"), monthlyCap: 5, reserve: 0 })).toMatchObject({ user_month_count: 0, month_resets_on: `${YEAR}-12-01` });
    // Le dernier dimanche de mars est toujours passé le 31 : heure d'été (+02:00).
    await search(subscriber, at("03-31T23:30", "+02:00", YEAR + 1));
    expect(await quota({ user: subscriber, at: at("03-31T23:45", "+02:00", YEAR + 1), monthlyCap: 5, reserve: 0 })).toMatchObject({ user_month_count: 1 });
    expect(await quota({ user: subscriber, at: at("04-01T00:01", "+02:00", YEAR + 1), monthlyCap: 5, reserve: 0 })).toMatchObject({ user_month_count: 0 });
  });

  it("paramètres invalides refusés ; serpapi_quota (0029) répond toujours comme avant", async () => {
    const base = { p_daily_cap: 10, p_monthly_cap: 100, p_user_daily_cap: 8, p_renewal_day: 3, p_user_id: free.id, p_reserve: false, p_at: at("07-01T12:00").toISOString() };
    for (const extra of [
      { p_user_monthly_cap: 0, p_reserve_percent: 30 },
      { p_user_monthly_cap: 100, p_reserve_percent: 91 },
      { p_user_monthly_cap: 100, p_reserve_percent: -1 },
      { p_user_monthly_cap: 100, p_reserve_percent: null },
    ]) {
      expect((await app.supabaseAdmin.rpc("serpapi_quota_v2", { ...base, ...extra })).error, JSON.stringify(extra)).not.toBeNull();
    }
    const old = await app.supabaseAdmin.rpc("serpapi_quota", base);
    expect(old.error).toBeNull();
    expect(QUOTA_ROWS.parse(old.data)[0]).not.toHaveProperty("user_month_count");
  });

  it("member_entitlements : ni un visiteur ni un membre connecté ne la lisent ni n'y écrivent ; les fonctions sont réservées au serveur", async () => {
    const { error } = await app.supabaseAdmin.from("member_entitlements").insert({ user_id: subscriber.id, entitlement: "video", expires_at: null, source: "revenuecat" });
    expect(error).toBeNull();
    const visitor = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const member = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${subscriber.token}` } },
    });
    for (const client of [visitor, member]) {
      const read = await client.from("member_entitlements").select("*");
      expect(read.data ?? []).toEqual([]);
      expect((await client.from("member_entitlements").insert({ user_id: subscriber.id, entitlement: "miroir", source: "revenuecat" })).error).not.toBeNull();
      expect((await client.rpc("member_quotas_version")).error).not.toBeNull();
      expect((await client.rpc("serpapi_quota_v2", { p_daily_cap: 10, p_monthly_cap: 100, p_user_daily_cap: 8, p_renewal_day: 3, p_user_id: subscriber.id, p_reserve: true, p_user_monthly_cap: null, p_reserve_percent: 0 })).error).not.toBeNull();
    }
    const { data } = await app.supabaseAdmin.from("member_entitlements").select("entitlement").eq("user_id", subscriber.id);
    expect(z.array(z.object({ entitlement: z.string() })).parse(data)).toEqual([{ entitlement: "video" }]);
  });

  it("GET /api/searches/capacity : la part du mois d'un compte gratuit (100), lue sans rien réserver", async () => {
    resetMemberQuotasProbe();
    const response = await app.inject({ method: "GET", url: "/api/searches/capacity", headers: authHeaders(free.token) });
    expect(response.statusCode).toBe(200);
    expect(response.json().monthlyQuota).toMatchObject({ limit: 100, used: expect.any(Number), resetsOn: expect.stringMatching(/^\d{4}-\d{2}-01$/) });
  });

  it("suppression du compte : ses droits partent avec lui", async () => {
    const extra = await createTestUser(app, "quotac");
    const { error } = await app.supabaseAdmin.from("member_entitlements").insert({ user_id: extra.id, entitlement: "miroir", expires_at: new Date(Date.now() + 30 * 24 * HOUR).toISOString(), source: "revenuecat" });
    expect(error).toBeNull();
    await deleteTestUser(app, extra.id);
    const { data } = await app.supabaseAdmin.from("member_entitlements").select("user_id").eq("user_id", extra.id);
    expect(data ?? []).toEqual([]);
  });
});
