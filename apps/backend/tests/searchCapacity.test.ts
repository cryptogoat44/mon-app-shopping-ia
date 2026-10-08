import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { env } from "../src/env.js";
import { capacityLogFields, QUOTA_ROWS, searchCapacityForVideoAi } from "../src/lib/searchCapacity.js";
import { buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Lot 4 quater : la fonction serpapi_quota de spotto-dev (migration 0022),
// sans aucun appel à SerpApi. Chaque cas fixe son « maintenant » à un jour tiré
// au hasard entre 1980 et 2019 : jamais mêlé aux vrais appels (2026) ni aux
// autres cas. Les lignes créées sont effacées à la fin.

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ranges: Array<{ from: string; to: string }> = [];

/** Midi UTC d'un jour pris au hasard entre 1980 et 2019 (même jour à Paris). */
function fictiveNow(): Date {
  const at = new Date(Date.UTC(1980, 0, 1, 12) + Math.floor(Math.random() * 14_600) * DAY);
  ranges.push({ from: new Date(at.getTime() - 40 * DAY).toISOString(), to: new Date(at.getTime() + 40 * DAY).toISOString() });
  return at;
}

const after = (at: Date, ms: number) => new Date(at.getTime() + ms);

describe("plafond global des recherches SerpApi (fonction de la base, lot 4 quater)", () => {
  let app: FastifyInstance;
  let user: TestUser;

  async function quota(at: Date, caps: { daily: number; monthly: number }, reserve = true) {
    const { data, error } = await app.supabaseAdmin.rpc("serpapi_quota", {
      p_daily_cap: caps.daily,
      p_monthly_cap: caps.monthly,
      p_reserve: reserve,
      p_at: at.toISOString(),
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

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "cap");
  });

  afterAll(async () => {
    for (const range of ranges) await app.supabaseAdmin.from("serpapi_calls").delete().gte("called_at", range.from).lte("called_at", range.to);
    await deleteTestUser(app, user.id);
    await app.close();
  });

  it("réserve jusqu'au plafond du jour, puis refuse jusqu'à minuit (heure de Paris), sans rien réserver de plus", async () => {
    const at = fictiveNow();
    const caps = { daily: 3, monthly: 100 };
    for (const n of [1, 2, 3]) {
      expect(await quota(after(at, n * MINUTE), caps)).toMatchObject({ allowed: true, day_count: n, window_count: n });
    }
    const refused = await quota(after(at, 4 * MINUTE), caps);
    expect(refused).toMatchObject({ allowed: false, cap_period: "day", day_count: 3, window_count: 3 });
    const midnight = new Date(refused.retry_at!);
    expect(midnight.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" })).toBe("00:00:00");
    expect(midnight.getTime() - at.getTime()).toBeGreaterThan(0);
    expect(midnight.getTime() - at.getTime()).toBeLessThanOrEqual(DAY);
    expect(await rowsBetween(at, after(at, DAY))).toHaveLength(3);

    // Juste avant minuit : toujours refusé ; juste après : un nouveau jour.
    expect(await quota(after(midnight, -MINUTE), caps)).toMatchObject({ allowed: false, cap_period: "day" });
    expect(await quota(after(midnight, MINUTE), caps)).toMatchObject({ allowed: true, day_count: 1, window_count: 4 });
  });

  it("31 jours glissants : plafond atteint, reprise quand le plus ancien appel sort de la fenêtre", async () => {
    const at = fictiveNow();
    const caps = { daily: 10, monthly: 3 };
    for (const days of [0, 2, 5]) expect((await quota(after(at, days * DAY), caps)).allowed).toBe(true);

    const refused = await quota(after(at, 10 * DAY), caps);
    expect(refused).toMatchObject({ allowed: false, cap_period: "month", day_count: 0, window_count: 3 });
    const reopening = new Date(refused.retry_at!);
    expect(reopening.getTime()).toBe(after(at, 31 * DAY).getTime());
    expect(await quota(after(reopening, -1000), caps)).toMatchObject({ allowed: false, cap_period: "month" });
    expect(await quota(reopening, caps)).toMatchObject({ allowed: true, window_count: 3 });
  });

  it("plafond abaissé : la date de reprise compte tous les appels qui doivent sortir de la fenêtre", async () => {
    const at = fictiveNow();
    for (const days of [0, 1, 2, 3, 4]) expect((await quota(after(at, days * DAY), { daily: 10, monthly: 5 })).allowed).toBe(true);
    const refused = await quota(after(at, 6 * DAY), { daily: 10, monthly: 3 });
    expect(refused).toMatchObject({ allowed: false, cap_period: "month", window_count: 5 });
    // 5 appels pour un plafond de 3 : il faut que les 3 plus anciens sortent.
    expect(new Date(refused.retry_at!).getTime()).toBe(after(at, 33 * DAY).getTime());
  });

  it("lecture seule : rien n'est réservé", async () => {
    const at = fictiveNow();
    for (let i = 0; i < 4; i++) expect(await quota(after(at, i * MINUTE), { daily: 2, monthly: 2 }, false)).toMatchObject({ allowed: true, day_count: 0 });
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
    const now = async (caps: { daily: number; monthly: number }, reserve: boolean) => {
      const { data, error } = await app.supabaseAdmin.rpc("serpapi_quota", { p_daily_cap: caps.daily, p_monthly_cap: caps.monthly, p_reserve: reserve });
      expect(error).toBeNull();
      return QUOTA_ROWS.parse(data)[0]!;
    };
    try {
      const state = await now({ daily: 1_000_000, monthly: 1_000_000 }, false);
      const caps = { daily: state.day_count + 5, monthly: state.window_count + 5 };
      const results = await Promise.all(Array.from({ length: 12 }, () => now(caps, true)));
      expect(results.filter((result) => result.allowed)).toHaveLength(5);
    } finally {
      await app.supabaseAdmin.from("serpapi_calls").delete().gte("called_at", start.toISOString());
    }
  });

  it("plafonds invalides : refus net, rien n'est réservé", async () => {
    const at = fictiveNow();
    const { error } = await app.supabaseAdmin.rpc("serpapi_quota", { p_daily_cap: 0, p_monthly_cap: 10, p_reserve: true, p_at: at.toISOString() });
    expect(error).not.toBeNull();
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
      const call = await client.rpc("serpapi_quota", { p_daily_cap: 1000, p_monthly_cap: 1000, p_reserve: true, p_at: at.toISOString() });
      expect(call.error).not.toBeNull();
      const read = await client.from("serpapi_calls").select("*").limit(1);
      expect(read.data ?? []).toEqual([]);
    }
    expect(await rowsBetween(after(at, -DAY), after(at, DAY))).toHaveLength(0);
  });

  it("aucune donnée personnelle : une ligne ne garde que son numéro et sa date (rien à exporter ni à effacer avec un compte)", async () => {
    const at = fictiveNow();
    await quota(at, { daily: 5, monthly: 5 });
    const [row] = await rowsBetween(after(at, -MINUTE), after(at, MINUTE));
    expect(Object.keys(row ?? {}).sort()).toEqual(["called_at", "id"]);
  });

  it("le serveur lit la réponse réelle (maintenant) sans rien réserver ; son journal ne contient que des nombres et des états", async () => {
    const before = new Date();
    const capacity = await searchCapacityForVideoAi(app, app.log);
    expect(typeof capacity.allowed).toBe("boolean");
    expect(await rowsBetween(before, new Date())).toHaveLength(0);

    const fields = capacityLogFields("search", { allowed: false, cap_period: "day", retry_at: null, day_count: 25, window_count: 40 }, { daily: 25, monthly: 225 });
    expect(fields).toEqual({ step: "search", outcome: "refused", period: "day", day: 25, window: 40, dayCap: 25, monthCap: 225 });
  });
});
