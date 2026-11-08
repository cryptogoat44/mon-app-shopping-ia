import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { env } from "../src/env.js";
import { buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Compteurs de l'IA dans la base (lot garde-fous, migration 0029, fonction
// ai_quota), sans aucun appel à Anthropic. Instants fixés dans une année
// tirée au hasard entre 1980 et 2005 : jamais mêlés aux vrais appels. Sautés
// tant que 0029 n'est pas appliquée sur la base des tests.

const HOUR = 3_600_000;
const BASE_YEAR = 1980 + Math.floor(Math.random() * 26);
const ROWS = z.array(z.object({ allowed: z.boolean(), refused_by: z.enum(["user", "global"]).nullable(), day_count: z.number(), user_day_count: z.number() })).length(1);

const probe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).from("ai_calls").select("id").limit(0);
const migrated = !probe.error;

/** Midi UTC (13 h ou 14 h à Paris) du jour `day` du mois `month` de l'année d'essai. */
const noon = (month: number, day: number) => new Date(Date.UTC(BASE_YEAR, month, day, 12));

describe.skipIf(!migrated)("compteurs de l'IA (fonction ai_quota de la base, 0029)", () => {
  let app: FastifyInstance;
  let alice: TestUser;
  let bruno: TestUser;

  async function quota(kind: "video" | "shopping_query", userId: string | null, caps: { user: number | null; daily: number }, reserve: boolean, at: Date | null) {
    const { data, error } = await app.supabaseAdmin.rpc("ai_quota", {
      p_kind: kind,
      p_user_id: userId,
      p_user_daily_cap: caps.user,
      p_daily_cap: caps.daily,
      p_reserve: reserve,
      ...(at ? { p_at: at.toISOString() } : {}),
    });
    expect(error).toBeNull();
    return ROWS.parse(data)[0]!;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    [alice, bruno] = await Promise.all([createTestUser(app, "iaa"), createTestUser(app, "iab")]);
  });

  afterAll(async () => {
    await app.supabaseAdmin
      .from("ai_calls")
      .delete()
      .gte("called_at", new Date(Date.UTC(BASE_YEAR - 1, 0, 1)).toISOString())
      .lte("called_at", new Date(Date.UTC(BASE_YEAR + 1, 0, 1)).toISOString());
    await deleteTestUser(app, alice.id);
    await deleteTestUser(app, bruno.id);
    await app.close();
  });

  it("analyse vidéo : la part de chaque personne, puis le plafond commun ; une simple lecture ne compte rien", async () => {
    const at = noon(1, 10);
    const caps = { user: 2, daily: 3 };
    expect(await quota("video", alice.id, caps, false, at)).toEqual({ allowed: true, refused_by: null, day_count: 0, user_day_count: 0 });
    expect(await quota("video", alice.id, caps, true, at)).toMatchObject({ allowed: true, day_count: 1, user_day_count: 1 });
    expect(await quota("video", alice.id, caps, true, at)).toMatchObject({ allowed: true, day_count: 2, user_day_count: 2 });
    expect(await quota("video", alice.id, caps, true, at)).toEqual({ allowed: false, refused_by: "user", day_count: 2, user_day_count: 2 });
    expect(await quota("video", bruno.id, caps, true, at)).toMatchObject({ allowed: true, day_count: 3, user_day_count: 1 });
    expect(await quota("video", bruno.id, caps, true, at)).toEqual({ allowed: false, refused_by: "global", day_count: 3, user_day_count: 1 });
  });

  it("le jour est celui de Paris : à minuit, tout repart de zéro", async () => {
    const caps = { user: 1, daily: 100 };
    // 23 h 30 à Paris (hiver : 22 h 30 UTC), 23 h 45 le même jour, puis 0 h 30
    // le lendemain. (23 h 30 + 30 min tombe pile à minuit : déjà le lendemain.)
    const evening = new Date(Date.UTC(BASE_YEAR, 1, 20, 22, 30));
    expect(await quota("video", alice.id, caps, true, evening)).toMatchObject({ allowed: true });
    expect(await quota("video", alice.id, caps, true, new Date(evening.getTime() + 15 * 60_000))).toMatchObject({ allowed: false, refused_by: "user" });
    expect(await quota("video", alice.id, caps, true, new Date(evening.getTime() + 2 * HOUR))).toMatchObject({ allowed: true, user_day_count: 1 });
  });

  it("IA de la voie C : plafond commun seulement, aucune ligne liée à un compte", async () => {
    const at = noon(2, 10);
    for (let call = 0; call < 2; call += 1) expect(await quota("shopping_query", null, { user: null, daily: 2 }, true, at)).toMatchObject({ allowed: true });
    expect(await quota("shopping_query", null, { user: null, daily: 2 }, true, at)).toMatchObject({ allowed: false, refused_by: "global", day_count: 2 });
    const { data } = await app.supabaseAdmin.from("ai_calls").select("user_id").eq("kind", "shopping_query").eq("called_at", at.toISOString());
    expect(data).toEqual([{ user_id: null }, { user_id: null }]);
  });

  it("paramètres invalides : refusés par la base", async () => {
    for (const params of [
      { p_kind: "autre", p_user_id: null, p_user_daily_cap: null, p_daily_cap: 1, p_reserve: true },
      { p_kind: "video", p_user_id: null, p_user_daily_cap: 1, p_daily_cap: 1, p_reserve: true },
      { p_kind: "shopping_query", p_user_id: alice.id, p_user_daily_cap: 1, p_daily_cap: 1, p_reserve: true },
      { p_kind: "video", p_user_id: alice.id, p_user_daily_cap: 1, p_daily_cap: 0, p_reserve: true },
    ]) {
      const { error } = await app.supabaseAdmin.rpc("ai_quota", { ...params, p_at: noon(3, 1).toISOString() });
      expect(error).not.toBeNull();
    }
  });

  it("ni les visiteurs ni les comptes connectés ne lisent la table ni n'appellent la fonction", async () => {
    const visitor = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const read = await visitor.from("ai_calls").select("*").limit(1);
    expect(read.data ?? []).toEqual([]);
    const call = await visitor.rpc("ai_quota", { p_kind: "shopping_query", p_user_id: null, p_user_daily_cap: null, p_daily_cap: 1, p_reserve: true });
    expect(call.error).not.toBeNull();
  });

  it("un compte supprimé emporte ses lignes ; un appel du serveur efface les lignes de plus de 2 jours", async () => {
    const carla = await createTestUser(app, "iac");
    await quota("video", carla.id, { user: 5, daily: 100 }, true, noon(4, 10));
    await deleteTestUser(app, carla.id);
    const { data: left } = await app.supabaseAdmin.from("ai_calls").select("id").eq("user_id", carla.id);
    expect(left).toEqual([]);

    // Dernier test : un appel « réel » (sans instant fixé, simple lecture) efface les lignes d'essai, vieilles de plusieurs années.
    await quota("shopping_query", null, { user: null, daily: 1_000_000 }, false, null);
    const { data: old } = await app.supabaseAdmin.from("ai_calls").select("id").lt("called_at", new Date(Date.now() - 3 * 24 * HOUR).toISOString());
    expect(old).toEqual([]);
  });
});
