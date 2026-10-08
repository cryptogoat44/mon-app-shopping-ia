import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { env } from "../src/env.js";
import { capacityLogFields, QUOTA_ROWS, reserveSearch, searchCapacityForVideoAi } from "../src/lib/searchCapacity.js";
import { buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Lot 4 quater : les fonctions serpapi_cycle_start, serpapi_quota et
// serpapi_seed_cycle de spotto-dev (migration 0022), sans aucun appel à
// SerpApi. Chaque cas qui inscrit des appels a son propre trimestre fictif,
// à partir d'une année tirée au hasard entre 1980 et 2005 : jamais mêlé aux
// vrais appels (2026), ni aux autres cas (3 mois d'écart). Les lignes créées
// sont effacées à la fin (les recherches de test avec leurs comptes).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const BASE_YEAR = 1980 + Math.floor(Math.random() * 26);

/** Midi UTC (le même jour à Paris) du jour `day` du mois du créneau `slot` (+ `monthOffset`). */
function slotDate(slot: number, day: number, monthOffset = 0): Date {
  return new Date(Date.UTC(BASE_YEAR, slot * 3 + monthOffset, day, 12));
}

/** Minuit, heure de Paris, du même jour (jamais un jour de changement d'heure dans ces tests). */
function parisMidnight(slot: number, day: number, monthOffset = 0): Date {
  const noon = slotDate(slot, day, monthOffset);
  const parisHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(noon));
  return new Date(noon.getTime() - parisHour * HOUR);
}

/** « 2026-10-03 00:00 », heure de Paris. */
function parisTime(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

const after = (at: Date, ms: number) => new Date(at.getTime() + ms);

interface Caps {
  daily: number;
  monthly: number;
  user?: number;
  renewal?: number;
}

describe("plafond des recherches SerpApi (fonctions de la base, lot 4 quater)", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let other: TestUser;

  async function quota(at: Date | null, caps: Caps, options: { reserve?: boolean; userId?: string; exclude?: string } = {}) {
    const { data, error } = await app.supabaseAdmin.rpc("serpapi_quota", {
      p_daily_cap: caps.daily,
      p_monthly_cap: caps.monthly,
      p_user_daily_cap: caps.user ?? 1_000_000,
      p_renewal_day: caps.renewal ?? 3,
      p_user_id: options.userId ?? user.id,
      p_reserve: options.reserve ?? true,
      p_exclude_search: options.exclude ?? null,
      ...(at ? { p_at: at.toISOString() } : {}),
    });
    expect(error).toBeNull();
    // Le schéma du serveur lit la vraie réponse de la base.
    return QUOTA_ROWS.parse(data)[0]!;
  }

  async function cycleStart(renewalDay: number, at: string): Promise<string> {
    const { data, error } = await app.supabaseAdmin.rpc("serpapi_cycle_start", { p_renewal_day: renewalDay, p_at: at });
    expect(error).toBeNull();
    return parisTime(z.string().parse(data));
  }

  async function seed(renewalDay: number, count: number, at: Date): Promise<number> {
    const { data, error } = await app.supabaseAdmin.rpc("serpapi_seed_cycle", { p_renewal_day: renewalDay, p_count: count, p_at: at.toISOString() });
    expect(error).toBeNull();
    return z.number().int().parse(data);
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
    await app.supabaseAdmin
      .from("serpapi_calls")
      .delete()
      .gte("called_at", new Date(Date.UTC(BASE_YEAR - 1, 0, 1)).toISOString())
      .lte("called_at", new Date(Date.UTC(BASE_YEAR + 5, 0, 1)).toISOString());
    await deleteTestUser(app, user.id);
    await deleteTestUser(app, other.id);
    await app.close();
  });

  describe("début du cycle de SerpApi (jour de renouvellement, heure de Paris)", () => {
    it("le 2 à 23 h 59 : cycle commencé le 3 du mois précédent ; le 3 à 0 h 01 : nouveau cycle", async () => {
      expect(await cycleStart(3, "2026-10-02T21:59:00Z")).toBe("2026-09-03 00:00");
      expect(await cycleStart(3, "2026-10-02T22:01:00Z")).toBe("2026-10-03 00:00");
    });

    it("changement d'année : le 2 janvier, le cycle a commencé le 3 décembre", async () => {
      expect(await cycleStart(3, "2027-01-02T12:00:00Z")).toBe("2026-12-03 00:00");
      expect(await cycleStart(3, "2027-01-03T12:00:00Z")).toBe("2027-01-03 00:00");
    });

    it("mois plus courts que le jour de renouvellement : le dernier jour du mois (28 ou 29 février, 30 avril)", async () => {
      expect(await cycleStart(31, "2015-02-27T12:00:00Z")).toBe("2015-01-31 00:00");
      expect(await cycleStart(31, "2015-02-28T12:00:00Z")).toBe("2015-02-28 00:00");
      expect(await cycleStart(31, "2015-03-30T12:00:00Z")).toBe("2015-02-28 00:00");
      expect(await cycleStart(31, "2015-03-31T12:00:00Z")).toBe("2015-03-31 00:00");
      expect(await cycleStart(31, "2016-02-28T12:00:00Z")).toBe("2016-01-31 00:00");
      expect(await cycleStart(31, "2016-02-29T12:00:00Z")).toBe("2016-02-29 00:00");
      expect(await cycleStart(30, "2015-02-28T12:00:00Z")).toBe("2015-02-28 00:00");
      expect(await cycleStart(31, "2026-04-30T12:00:00Z")).toBe("2026-04-30 00:00");
    });

    it("jour de renouvellement réglable (le 15, le 1er), compté en jours de Paris", async () => {
      expect(await cycleStart(15, "2026-10-14T12:00:00Z")).toBe("2026-09-15 00:00");
      expect(await cycleStart(15, "2026-10-15T12:00:00Z")).toBe("2026-10-15 00:00");
      // 23 h 30 UTC le 30 septembre = 1 h 30 le 1er octobre à Paris.
      expect(await cycleStart(1, "2026-09-30T23:30:00Z")).toBe("2026-10-01 00:00");
    });

    it("jour de renouvellement invalide (0, 32) : refus net", async () => {
      for (const day of [0, 32]) {
        expect((await app.supabaseAdmin.rpc("serpapi_cycle_start", { p_renewal_day: day, p_at: "2026-10-08T12:00:00Z" })).error).not.toBeNull();
      }
    });
  });

  it("plafond du mois atteint le 2, libéré le 3 (jour de renouvellement), comme le quota de SerpApi", async () => {
    const caps = { daily: 10, monthly: 3 };
    for (const [n, at] of [slotDate(1, 4, -1), slotDate(1, 20, -1), slotDate(1, 1)].entries()) {
      expect(await quota(at, caps)).toMatchObject({ allowed: true, month_count: n + 1 });
    }
    expect(await quota(slotDate(1, 2), caps)).toMatchObject({ allowed: false, refused_by: "month", month_count: 3 });
    const third = parisMidnight(1, 3);
    expect(await quota(after(third, -MINUTE), caps)).toMatchObject({ allowed: false, refused_by: "month" });
    expect(await quota(after(third, MINUTE), caps)).toMatchObject({ allowed: true, month_count: 1, day_count: 1 });
  });

  it("changement de mois et d'année : du 3 décembre au 3 janvier, un seul cycle", async () => {
    const caps = { daily: 10, monthly: 2 };
    expect(await quota(slotDate(4, 20, -1), caps)).toMatchObject({ allowed: true, month_count: 1 });
    expect(await quota(slotDate(4, 1), caps)).toMatchObject({ allowed: true, month_count: 2 });
    expect(await quota(slotDate(4, 2), caps)).toMatchObject({ allowed: false, refused_by: "month" });
    expect(await quota(after(parisMidnight(4, 3), MINUTE), caps)).toMatchObject({ allowed: true, month_count: 1 });
  });

  it("plafond du jour : réserve jusqu'au plafond, puis refuse jusqu'à minuit (heure de Paris), sans rien réserver de plus", async () => {
    const caps = { daily: 3, monthly: 100 };
    const at = slotDate(0, 10);
    for (const n of [1, 2, 3]) {
      expect(await quota(after(at, n * MINUTE), caps)).toMatchObject({ allowed: true, day_count: n, month_count: n });
    }
    expect(await quota(after(at, 4 * MINUTE), caps)).toMatchObject({ allowed: false, refused_by: "day", day_count: 3 });
    expect(await rowsBetween(at, after(at, DAY))).toHaveLength(3);
    const midnight = parisMidnight(0, 11);
    expect(await quota(after(midnight, -MINUTE), caps)).toMatchObject({ allowed: false, refused_by: "day" });
    expect(await quota(after(midnight, MINUTE), caps)).toMatchObject({ allowed: true, day_count: 1, month_count: 4 });
  });

  it("premier démarrage : le compteur reprend le nombre lu chez SerpApi pour le cycle en cours, jamais en double", async () => {
    const at = slotDate(11, 20);
    expect(await seed(3, 5, at)).toBe(5);
    expect(await seed(3, 5, at)).toBe(5);
    expect(await seed(3, 0, at)).toBe(5);
    expect(await quota(at, { daily: 100, monthly: 6 })).toMatchObject({ allowed: true, month_count: 6, day_count: 1 });
    expect(await quota(after(at, MINUTE), { daily: 100, monthly: 6 })).toMatchObject({ allowed: false, refused_by: "month" });
    // Datés du début du cycle (le 3 à minuit, heure de Paris) : ils ne comptent pas dans la journée du 20.
    expect(await rowsBetween(parisMidnight(11, 3), after(parisMidnight(11, 3), MINUTE))).toHaveLength(5);
    expect((await app.supabaseAdmin.rpc("serpapi_seed_cycle", { p_renewal_day: 3, p_count: -1, p_at: at.toISOString() })).error).not.toBeNull();
  });

  it("part de la personne : seules ses recherches du jour qui ont atteint SerpApi comptent (pas les préparées, ni celles d'hier, ni celles des autres)", async () => {
    const at = slotDate(2, 10);
    for (const status of ["completed", "completed", "failed", "processing", "pending", "pending"] as const) await searchAt(after(at, -HOUR), status);
    await searchAt(after(at, -DAY), "completed");
    await searchAt(after(at, -HOUR), "completed", other);

    expect(await quota(at, { daily: 100, monthly: 100, user: 5 }, { reserve: false })).toMatchObject({ allowed: true, user_day_count: 4 });
    expect(await quota(at, { daily: 100, monthly: 100, user: 4 }, { reserve: false })).toMatchObject({ allowed: false, refused_by: "user", user_day_count: 4 });
    expect(await quota(at, { daily: 100, monthly: 100, user: 1 }, { reserve: false, userId: other.id })).toMatchObject({ allowed: false, refused_by: "user" });
    expect(await quota(at, { daily: 100, monthly: 100, user: 2 }, { reserve: false, userId: other.id })).toMatchObject({ allowed: true, user_day_count: 1 });
  });

  it("part de la personne : la recherche en cours de lancement ne se compte pas elle-même ; un refus ne réserve rien", async () => {
    const at = slotDate(3, 10);
    for (const status of ["completed", "completed", "completed"] as const) await searchAt(after(at, -HOUR), status);
    const current = await searchAt(after(at, -MINUTE), "processing");

    expect(await quota(at, { daily: 100, monthly: 100, user: 3 })).toMatchObject({ allowed: false, refused_by: "user", user_day_count: 4 });
    expect(await rowsBetween(after(at, -DAY), after(at, DAY))).toHaveLength(0);
    expect(await quota(at, { daily: 100, monthly: 100, user: 4 }, { exclude: current })).toMatchObject({ allowed: true, user_day_count: 4, day_count: 1 });
    expect(await rowsBetween(after(at, -DAY), after(at, DAY))).toHaveLength(1);
  });

  it("ordre des refus : le mois d'abord (tout le service), puis la part de la personne, puis le jour", async () => {
    const at = slotDate(5, 10);
    await quota(at, { daily: 10, monthly: 10 });
    await searchAt(after(at, -HOUR), "completed");
    expect(await quota(after(at, MINUTE), { daily: 1, monthly: 1, user: 1 }, { reserve: false })).toMatchObject({ refused_by: "month" });
    expect(await quota(after(at, MINUTE), { daily: 1, monthly: 10, user: 1 }, { reserve: false })).toMatchObject({ refused_by: "user" });
    expect(await quota(after(at, MINUTE), { daily: 1, monthly: 10, user: 2 }, { reserve: false })).toMatchObject({ refused_by: "day" });
  });

  it("lecture seule : rien n'est réservé", async () => {
    const at = slotDate(6, 10);
    for (let i = 0; i < 4; i++) expect(await quota(after(at, i * MINUTE), { daily: 2, monthly: 2 }, { reserve: false })).toMatchObject({ allowed: true, day_count: 0 });
    expect(await rowsBetween(after(at, -DAY), after(at, DAY))).toHaveLength(0);
  });

  it("demandes simultanées : jamais au-delà du plafond", async () => {
    const at = slotDate(7, 10);
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
      const caps = { daily: state.day_count + 5, monthly: state.month_count + 5 };
      const results = await Promise.all(Array.from({ length: 12 }, () => quota(null, caps)));
      expect(results.filter((result) => result.allowed)).toHaveLength(5);
    } finally {
      await app.supabaseAdmin.from("serpapi_calls").delete().gte("called_at", start.toISOString());
    }
  });

  it("paramètres invalides (plafond nul, personne absente, jour de renouvellement hors du mois) : refus net, rien n'est réservé", async () => {
    const at = slotDate(8, 10);
    const base = { p_monthly_cap: 10, p_user_daily_cap: 5, p_reserve: true, p_at: at.toISOString() };
    expect((await app.supabaseAdmin.rpc("serpapi_quota", { ...base, p_daily_cap: 0, p_renewal_day: 3, p_user_id: user.id })).error).not.toBeNull();
    expect((await app.supabaseAdmin.rpc("serpapi_quota", { ...base, p_daily_cap: 10, p_renewal_day: 3, p_user_id: null })).error).not.toBeNull();
    expect((await app.supabaseAdmin.rpc("serpapi_quota", { ...base, p_daily_cap: 10, p_renewal_day: 32, p_user_id: user.id })).error).not.toBeNull();
    expect(await rowsBetween(after(at, -DAY), after(at, DAY))).toHaveLength(0);
  });

  it("réservées au serveur : ni un visiteur ni un compte connecté ne peut appeler ces fonctions ni lire les appels", async () => {
    const at = slotDate(9, 10).toISOString();
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
        p_renewal_day: 3,
        p_user_id: user.id,
        p_reserve: true,
        p_at: at,
      });
      expect(call.error).not.toBeNull();
      expect((await client.rpc("serpapi_seed_cycle", { p_renewal_day: 3, p_count: 50, p_at: at })).error).not.toBeNull();
      expect((await client.rpc("serpapi_cycle_start", { p_renewal_day: 3, p_at: at })).error).not.toBeNull();
      const read = await client.from("serpapi_calls").select("*").limit(1);
      expect(read.data ?? []).toEqual([]);
    }
    expect(await rowsBetween(slotDate(9, 1, -1), slotDate(9, 1, 2))).toHaveLength(0);
  });

  it("aucune donnée personnelle dans les appels : une ligne ne garde que son numéro et sa date (rien à exporter ni à effacer avec un compte)", async () => {
    const at = slotDate(10, 10);
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
      { allowed: false, refused_by: "user", day_count: 12, month_count: 40, user_day_count: 8 },
      { daily: 25, monthly: 225, userDaily: 8, renewalDay: 3 }
    );
    expect(fields).toEqual({ step: "search", outcome: "refused", limit: "user", day: 12, month: 40, user: 8, dayCap: 25, monthCap: 225, userCap: 8, renewalDay: 3 });
  });
});
