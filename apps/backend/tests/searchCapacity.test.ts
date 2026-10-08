import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { env } from "../src/env.js";
import { capacityLogFields, QUOTA_ROWS, reserveSearch, searchCapacityForVideoAi } from "../src/lib/searchCapacity.js";
import { buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Lot 4 quater : la fonction serpapi_quota de spotto-dev (migration 0022),
// sans aucun appel à SerpApi. Chaque cas fixe son « maintenant » à un jour tiré
// au hasard entre 1980 et 2019 : jamais mêlé aux vrais appels (2026) ni aux
// autres cas. Les lignes créées sont effacées à la fin (les recherches de test
// avec leurs comptes).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ranges: Array<{ from: string; to: string }> = [];

/** Midi UTC d'un jour pris au hasard entre 1980 et 2019 (même jour à Paris). */
function fictiveNow(): Date {
  const at = new Date(Date.UTC(1980, 0, 1, 12) + Math.floor(Math.random() * 14_600) * DAY);
  ranges.push({ from: new Date(at.getTime() - 40 * DAY).toISOString(), to: new Date(at.getTime() + 40 * DAY).toISOString() });
  return at;
}

/** Minuit suivant, heure de Paris, pour un instant fixé à midi UTC. */
function nextParisMidnight(at: Date): Date {
  const parisHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(at));
  const offset = parisHour - at.getUTCHours();
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) + (24 - offset) * HOUR);
}

const after = (at: Date, ms: number) => new Date(at.getTime() + ms);

interface Caps {
  daily: number;
  monthly: number;
  user?: number;
}

describe("plafond des recherches SerpApi (fonction de la base, lot 4 quater)", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let other: TestUser;

  async function quota(at: Date | null, caps: Caps, options: { reserve?: boolean; userId?: string; exclude?: string } = {}) {
    const { data, error } = await app.supabaseAdmin.rpc("serpapi_quota", {
      p_daily_cap: caps.daily,
      p_monthly_cap: caps.monthly,
      p_user_daily_cap: caps.user ?? 1_000_000,
      p_user_id: options.userId ?? user.id,
      p_reserve: options.reserve ?? true,
      p_exclude_search: options.exclude ?? null,
      ...(at ? { p_at: at.toISOString() } : {}),
    });
    expect(error).toBeNull();
    // Le schéma du serveur lit la vraie réponse de la base.
    return QUOTA_ROWS.parse(data)[0]!;
  }

  async function rowsBetween(from: Date, to: Date) {
    const { data, error } = await app.supabaseAdmin
      .from("serpapi_calls")
      .select("*")
      .gte("called_at", from.toISOString())
      .lte("called_at", to.toISOString());
    expect(error).toBeNull();
    return data ?? [];
  }

  /** Une recherche de la personne, datée et dans l'état voulu (aucun appel réel). */
  async function searchAt(at: Date, status: "pending" | "processing" | "completed" | "failed", owner: TestUser = user): Promise<string> {
    const { data, error } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: owner.id, source_platform: "photo", method: "manual_screenshot", status, created_at: at.toISOString() })
      .select("id")
      .single();
    expect(error).toBeNull();
    return z.object({ id: z.string() }).parse(data).id;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    [user, other] = await Promise.all([createTestUser(app, "cap"), createTestUser(app, "cap2")]);
  });

  afterAll(async () => {
    for (const range of ranges) await app.supabaseAdmin.from("serpapi_calls").delete().gte("called_at", range.from).lte("called_at", range.to);
    await deleteTestUser(app, user.id);
    await deleteTestUser(app, other.id);
    await app.close();
  });

  it("réserve jusqu'au plafond du jour, puis refuse jusqu'à minuit (heure de Paris), sans rien réserver de plus", async () => {
    const at = fictiveNow();
    const caps = { daily: 3, monthly: 100 };
    for (const n of [1, 2, 3]) {
      expect(await quota(after(at, n * MINUTE), caps)).toMatchObject({ allowed: true, day_count: n, window_count: n });
    }
    expect(await quota(after(at, 4 * MINUTE), caps)).toMatchObject({ allowed: false, refused_by: "day", day_count: 3, window_count: 3 });
    expect(await rowsBetween(at, after(at, DAY))).toHaveLength(3);

    const midnight = nextParisMidnight(at);
    expect(midnight.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" })).toBe("00:00:00");
    expect(await quota(after(midnight, -MINUTE), caps)).toMatchObject({ allowed: false, refused_by: "day" });
    expect(await quota(after(midnight, MINUTE), caps)).toMatchObject({ allowed: true, day_count: 1, window_count: 4 });
  });

  it("31 jours glissants : plafond atteint, de nouveau possible quand le plus ancien appel sort de la fenêtre", async () => {
    const at = fictiveNow();
    const caps = { daily: 10, monthly: 3 };
    for (const days of [0, 2, 5]) expect((await quota(after(at, days * DAY), caps)).allowed).toBe(true);
    expect(await quota(after(at, 10 * DAY), caps)).toMatchObject({ allowed: false, refused_by: "month", day_count: 0, window_count: 3 });
    expect(await quota(after(at, 31 * DAY - 1000), caps)).toMatchObject({ allowed: false, refused_by: "month" });
    expect(await quota(after(at, 31 * DAY), caps)).toMatchObject({ allowed: true, window_count: 3 });
  });

  it("part de la personne : seules ses recherches du jour qui ont atteint SerpApi comptent (pas les préparées, ni celles d'hier, ni celles des autres)", async () => {
    const at = fictiveNow();
    for (const status of ["completed", "completed", "failed", "processing", "pending", "pending"] as const) await searchAt(after(at, -HOUR), status);
    await searchAt(after(at, -DAY), "completed");
    await searchAt(after(at, -HOUR), "completed", other);

    expect(await quota(at, { daily: 100, monthly: 100, user: 5 }, { reserve: false })).toMatchObject({ allowed: true, user_day_count: 4 });
    expect(await quota(at, { daily: 100, monthly: 100, user: 4 }, { reserve: false })).toMatchObject({ allowed: false, refused_by: "user", user_day_count: 4 });
    expect(await quota(at, { daily: 100, monthly: 100, user: 1 }, { reserve: false, userId: other.id })).toMatchObject({ allowed: false, refused_by: "user" });
    expect(await quota(at, { daily: 100, monthly: 100, user: 2 }, { reserve: false, userId: other.id })).toMatchObject({ allowed: true, user_day_count: 1 });
  });

  it("part de la personne : la recherche en cours de lancement ne se compte pas elle-même ; un refus ne réserve rien", async () => {
    const at = fictiveNow();
    for (const status of ["completed", "completed", "completed"] as const) await searchAt(after(at, -HOUR), status);
    const current = await searchAt(after(at, -MINUTE), "processing");

    expect(await quota(at, { daily: 100, monthly: 100, user: 3 })).toMatchObject({ allowed: false, refused_by: "user", user_day_count: 4 });
    expect(await rowsBetween(after(at, -DAY), after(at, DAY))).toHaveLength(0);
    expect(await quota(at, { daily: 100, monthly: 100, user: 4 }, { exclude: current })).toMatchObject({ allowed: true, user_day_count: 4, day_count: 1 });
    expect(await rowsBetween(after(at, -DAY), after(at, DAY))).toHaveLength(1);
  });

  it("ordre des refus : 31 jours d'abord (tout le service), puis la part de la personne, puis le jour", async () => {
    const at = fictiveNow();
    await quota(at, { daily: 10, monthly: 10 });
    await searchAt(after(at, -HOUR), "completed");
    expect(await quota(after(at, MINUTE), { daily: 1, monthly: 1, user: 1 }, { reserve: false })).toMatchObject({ refused_by: "month" });
    expect(await quota(after(at, MINUTE), { daily: 1, monthly: 10, user: 1 }, { reserve: false })).toMatchObject({ refused_by: "user" });
    expect(await quota(after(at, MINUTE), { daily: 1, monthly: 10, user: 2 }, { reserve: false })).toMatchObject({ refused_by: "day" });
  });

  it("lecture seule : rien n'est réservé", async () => {
    const at = fictiveNow();
    for (let i = 0; i < 4; i++) expect(await quota(after(at, i * MINUTE), { daily: 2, monthly: 2 }, { reserve: false })).toMatchObject({ allowed: true, day_count: 0 });
    expect(await rowsBetween(after(at, -DAY), after(at, DAY))).toHaveLength(0);
  });

  it("demandes simultanées : jamais au-delà du plafond", async () => {
    const at = fictiveNow();
    const results = await Promise.all(Array.from({ length: 12 }, () => quota(at, { daily: 5, monthly: 100 })));
    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(await rowsBetween(after(at, -MINUTE), after(at, MINUTE))).toHaveLength(5);
  });

  it("demandes simultanées à l'heure réelle (chemin du serveur) : jamais au-delà du plafond", async () => {
    // Une première écriture du cas précédent (heures fixées dans le désordre) a
    // trouvé un défaut de la première version de la fonction : l'heure lue
    // AVANT le verrou. Ce cas-ci ne reproduit pas ce désordre à coup sûr
    // (l'ordre des demandes dépend de Supabase ; contre-preuve du 2026-10-08 :
    // il passe aussi avec l'ancienne version) : il vérifie le chemin réel.
    const start = new Date(Date.now() - MINUTE);
    try {
      const state = await quota(null, { daily: 1_000_000, monthly: 1_000_000 }, { reserve: false });
      const caps = { daily: state.day_count + 5, monthly: state.window_count + 5 };
      const results = await Promise.all(Array.from({ length: 12 }, () => quota(null, caps)));
      expect(results.filter((result) => result.allowed)).toHaveLength(5);
    } finally {
      await app.supabaseAdmin.from("serpapi_calls").delete().gte("called_at", start.toISOString());
    }
  });

  it("paramètres invalides (plafond nul, personne absente) : refus net, rien n'est réservé", async () => {
    const at = fictiveNow();
    const base = { p_monthly_cap: 10, p_user_daily_cap: 5, p_reserve: true, p_at: at.toISOString() };
    expect((await app.supabaseAdmin.rpc("serpapi_quota", { ...base, p_daily_cap: 0, p_user_id: user.id })).error).not.toBeNull();
    expect((await app.supabaseAdmin.rpc("serpapi_quota", { ...base, p_daily_cap: 10, p_user_id: null })).error).not.toBeNull();
    expect(await rowsBetween(after(at, -DAY), after(at, DAY))).toHaveLength(0);
  });

  it("réservée au serveur : ni un visiteur ni un compte connecté ne peut l'appeler ni lire les appels", async () => {
    const at = fictiveNow();
    const visitor = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const signedIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${user.token}` } },
    });
    for (const client of [visitor, signedIn]) {
      const call = await client.rpc("serpapi_quota", {
        p_daily_cap: 1000,
        p_monthly_cap: 1000,
        p_user_daily_cap: 1000,
        p_user_id: user.id,
        p_reserve: true,
        p_at: at.toISOString(),
      });
      expect(call.error).not.toBeNull();
      const read = await client.from("serpapi_calls").select("*").limit(1);
      expect(read.data ?? []).toEqual([]);
    }
    expect(await rowsBetween(after(at, -DAY), after(at, DAY))).toHaveLength(0);
  });

  it("aucune donnée personnelle dans les appels : une ligne ne garde que son numéro et sa date (rien à exporter ni à effacer avec un compte)", async () => {
    const at = fictiveNow();
    await quota(at, { daily: 5, monthly: 5 });
    const [row] = await rowsBetween(after(at, -MINUTE), after(at, MINUTE));
    expect(Object.keys(row ?? {}).sort()).toEqual(["called_at", "id"]);
  });

  it("le serveur réserve pour de vrai (maintenant) : la recherche en cours ne se compte pas, la suivante bute sur la part de la personne", async () => {
    const saved = { daily: env.SERPAPI_DAILY_CAP, monthly: env.SERPAPI_MONTHLY_CAP, user: env.SERPAPI_USER_DAILY_CAP };
    Object.assign(env, { SERPAPI_DAILY_CAP: 1_000_000, SERPAPI_MONTHLY_CAP: 1_000_000, SERPAPI_USER_DAILY_CAP: 1 });
    const start = new Date(Date.now() - MINUTE);
    try {
      const first = await searchAt(new Date(), "processing");
      expect(await reserveSearch(app, app.log, user.id, first)).toEqual({ allowed: true });
      const second = await searchAt(new Date(), "processing");
      expect(await reserveSearch(app, app.log, user.id, second)).toEqual({ allowed: false, limit: "user" });
      expect(await rowsBetween(start, new Date(Date.now() + MINUTE))).toHaveLength(1);
    } finally {
      Object.assign(env, { SERPAPI_DAILY_CAP: saved.daily, SERPAPI_MONTHLY_CAP: saved.monthly, SERPAPI_USER_DAILY_CAP: saved.user });
      await app.supabaseAdmin.from("serpapi_calls").delete().gte("called_at", start.toISOString());
    }
  });

  it("le serveur lit la réponse réelle (maintenant) sans rien réserver ; son journal ne contient que des nombres et des états", async () => {
    const before = new Date();
    const capacity = await searchCapacityForVideoAi(app, app.log, user.id);
    expect(typeof capacity.allowed).toBe("boolean");
    expect(await rowsBetween(before, new Date())).toHaveLength(0);

    const fields = capacityLogFields(
      "search",
      { allowed: false, refused_by: "user", day_count: 12, window_count: 40, user_day_count: 8 },
      { daily: 25, monthly: 225, userDaily: 8 }
    );
    expect(fields).toEqual({ step: "search", outcome: "refused", limit: "user", day: 12, window: 40, user: 8, dayCap: 25, monthCap: 225, userCap: 8 });
  });
});
