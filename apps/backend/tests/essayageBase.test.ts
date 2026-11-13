import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { env } from "../src/env.js";
import { buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Essayage virtuel (migration 0042) : les fonctions de la base, sur
// spotto-dev-2 (lancé par le Mac du fondateur, et par « Tests serveur
// (spotto-dev-2) »). Aucun appel à FASHN, le drapeau n'est jamais touché :
// les fonctions sont appelées directement, à des instants fixés dans une
// année tirée au hasard entre 1980 et 2005 (jamais mêlés aux vrais essais).
// Sautés tant que 0042 n'est pas appliquée sur la base des tests.

const BASE_YEAR = 1980 + Math.floor(Math.random() * 26);
const ITEM = "11111111-1111-4111-8111-111111111111";
const CONSENT = "2026-11-v1";

const probe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).rpc("tryon_version");
const migrated = !probe.error && probe.data === 1;

const RESERVE_ROWS = z
  .array(z.object({ status: z.string(), event_id: z.guid().nullable(), free_remaining: z.number().nullable(), bonus_remaining: z.number().nullable() }))
  .length(1);
const COMPLETE_ROWS = z
  .array(
    z.object({
      status: z.string(),
      quota_source: z.enum(["free", "bonus"]).nullable(),
      free_remaining: z.number().nullable(),
      bonus_remaining: z.number().nullable(),
      new_alerts: z.array(z.string()),
    })
  )
  .length(1);

/** Un instant de l'année d'essai, heure de Paris en hiver (UTC + 1). */
const winter = (month: number, day: number, hour = 12, minute = 0) => new Date(Date.UTC(BASE_YEAR, month - 1, day, hour - 1, minute));
const pad = (value: number) => String(value).padStart(2, "0");
const monthKey = (month: number) => `${BASE_YEAR}-${pad(month)}`;

describe.skipIf(!migrated)("essayage virtuel : fonctions de la base (0042)", () => {
  let app: FastifyInstance;
  let alice: TestUser;
  let bruno: TestUser;
  let chloe: TestUser;

  async function reserve(user: TestUser, at: Date, settings: { budget?: number; max?: number } = {}) {
    const { data, error } = await app.supabaseAdmin.rpc("tryon_reserve", {
      p_user_id: user.id,
      p_item_id: ITEM,
      p_consent_version: CONSENT,
      p_free_per_month: 5,
      p_budget_usd: settings.budget ?? 1000,
      p_price_per_credit_usd: 0.075,
      p_credits_per_try: 1,
      p_max_in_flight: settings.max ?? 6,
      p_timezone: "Europe/Paris",
      p_at: at.toISOString(),
    });
    expect(error).toBeNull();
    return RESERVE_ROWS.parse(data)[0]!;
  }

  async function complete(user: TestUser, eventId: string, at: Date, budget = 1000) {
    const { data, error } = await app.supabaseAdmin.rpc("tryon_complete", {
      p_event_id: eventId,
      p_user_id: user.id,
      p_credits_used: 1,
      p_duration_ms: 8000,
      p_free_per_month: 5,
      p_budget_usd: budget,
      p_price_per_credit_usd: 0.075,
      p_alert_threshold: 0.8,
      p_timezone: "Europe/Paris",
      p_at: at.toISOString(),
    });
    expect(error).toBeNull();
    return COMPLETE_ROWS.parse(data)[0]!;
  }

  /** Un essai entier (réservé, réussi 10 s plus tard) : la source du quota, ou la raison du refus. */
  async function tryOn(user: TestUser, at: Date, budget = 1000): Promise<string> {
    const reserved = await reserve(user, at, { budget });
    if (reserved.status !== "reserved") return reserved.status;
    return (await complete(user, reserved.event_id!, new Date(at.getTime() + 10_000), budget)).quota_source ?? "aucune";
  }

  async function remaining(user: TestUser, at: Date): Promise<string> {
    const { data, error } = await app.supabaseAdmin.rpc("tryon_remaining", { p_user_id: user.id, p_free_per_month: 5, p_timezone: "Europe/Paris", p_at: at.toISOString() });
    expect(error).toBeNull();
    const [row] = z.array(z.object({ free_remaining: z.number(), bonus_remaining: z.number() })).length(1).parse(data);
    return `${row!.free_remaining}+${row!.bonus_remaining}`;
  }

  async function adultWithConsent(user: TestUser): Promise<void> {
    const { data, error } = await app.supabaseAdmin.rpc("tryon_set_age", { p_user_id: user.id, p_status: "adult" });
    expect(error).toBeNull();
    expect(data).toBe(true);
    const consent = await app.supabaseAdmin
      .from("tryon_profiles")
      .update({ consent_version: CONSENT, consent_accepted_at: new Date().toISOString() })
      .eq("user_id", user.id);
    expect(consent.error).toBeNull();
  }

  async function cleanTestYear(): Promise<void> {
    await app.supabaseAdmin.from("tryon_usage_months").delete().like("month", `${BASE_YEAR}-%`);
    await app.supabaseAdmin.from("tryon_alerts").delete().like("period", `${BASE_YEAR}-%`);
  }

  beforeAll(async () => {
    app = await buildTestApp();
    [alice, bruno, chloe] = await Promise.all([createTestUser(app, "tya"), createTestUser(app, "tyb"), createTestUser(app, "tyc")]);
    await cleanTestYear();
  });

  afterAll(async () => {
    await cleanTestYear();
    await deleteTestUser(app, alice.id);
    await deleteTestUser(app, bruno.id);
    await deleteTestUser(app, chloe.id);
    await app.close();
  });

  it("porte d'âge : le statut se pose une seule fois ; seule la remise à zéro (script) le libère", async () => {
    const set = (status: string) => app.supabaseAdmin.rpc("tryon_set_age", { p_user_id: chloe.id, p_status: status });
    expect((await set("minor")).data).toBe(true);
    expect((await set("adult")).data).toBe(false);
    const { data: row } = await app.supabaseAdmin.from("tryon_profiles").select("age_status, age_checked_at").eq("user_id", chloe.id).single();
    expect(row).toMatchObject({ age_status: "minor", age_checked_at: expect.any(String) });
    expect((await reserve(chloe, winter(2, 1))).status).toBe("not_allowed");
    expect((await app.supabaseAdmin.rpc("tryon_reset_age", { p_user_id: chloe.id })).data).toBe(true);
    expect((await set("adult")).data).toBe(true);
    // Majeure, mais sans consentement : toujours refusée.
    expect((await reserve(chloe, winter(2, 1))).status).toBe("not_allowed");

    await adultWithConsent(alice);
    await adultWithConsent(bruno);
  });

  it("deux essais simultanés du même membre : un seul passe", async () => {
    const at = winter(2, 10);
    const results = await Promise.all([reserve(alice, at), reserve(alice, at)]);
    expect(results.map((result) => result.status).sort()).toEqual(["in_progress", "reserved"]);
    const reserved = results.find((result) => result.status === "reserved")!;
    expect((await app.supabaseAdmin.rpc("tryon_fail", { p_event_id: reserved.event_id, p_user_id: alice.id, p_error_code: "test_cleanup", p_duration_ms: 0 })).data).toBe(true);
  });

  it("quota : 5 gratuits par mois civil à Paris ; minuit de Paris, pas minuit UTC", async () => {
    for (let index = 0; index < 5; index += 1) expect(await tryOn(alice, winter(1, 10, 10 + index))).toBe("free");
    expect(await tryOn(alice, winter(1, 20))).toBe("quota_exhausted");
    // 31 janvier, 23 h 30 à Paris : encore janvier ; 0 h 30 le 1er février à Paris : 5 de nouveau.
    expect(await remaining(alice, winter(1, 31, 23, 30))).toBe("0+0");
    expect(await remaining(alice, winter(1, 31, 24, 30))).toBe("5+0");
    expect(await tryOn(alice, winter(1, 31, 24, 30))).toBe("free");
    const { data } = await app.supabaseAdmin.from("tryon_events").select("month").eq("user_id", alice.id).eq("status", "succeeded");
    expect((data ?? []).map((row) => row.month).sort()).toEqual([...Array(5).fill(monthKey(1)), monthKey(2)]);
  });

  it("essais offerts : après les gratuits, celui qui expire le plus tôt d'abord ; un offert expiré ne sert jamais", async () => {
    const grant = (orderRef: string, quantity: number, expiresAt: Date) => ({ user_id: bruno.id, order_ref: `${orderRef}-${bruno.id}`, quantity, remaining: quantity, expires_at: expiresAt.toISOString() });
    const inserted = await app.supabaseAdmin
      .from("tryon_bonus_grants")
      .insert([grant("tard", 2, winter(9, 1)), grant("tot", 1, winter(5, 1)), grant("expire", 5, winter(4, 1))]);
    expect(inserted.error).toBeNull();
    expect(await remaining(bruno, winter(4, 10))).toBe("5+3");
    for (let index = 0; index < 5; index += 1) expect(await tryOn(bruno, winter(4, 10, 10 + index))).toBe("free");
    expect([await tryOn(bruno, winter(4, 11, 10)), await tryOn(bruno, winter(4, 11, 11)), await tryOn(bruno, winter(4, 11, 12))]).toEqual(["bonus", "bonus", "bonus"]);
    expect(await tryOn(bruno, winter(4, 12))).toBe("quota_exhausted");
    const { data } = await app.supabaseAdmin.from("tryon_bonus_grants").select("order_ref, remaining").eq("user_id", bruno.id).order("expires_at");
    expect(data).toEqual([
      { order_ref: `expire-${bruno.id}`, remaining: 5 },
      { order_ref: `tot-${bruno.id}`, remaining: 0 },
      { order_ref: `tard-${bruno.id}`, remaining: 0 },
    ]);
  });

  it("budget du mois : alerte à 80 % une seule fois, puis à 100 % ; ensuite, plus aucun essai", async () => {
    // Budget de 0,60 $ à 0,075 $ l'essai : 8 essais. Alice et Bruno, mars.
    const budget = 0.6;
    const outcomes: string[] = [];
    for (let index = 0; index < 5; index += 1) outcomes.push(await tryOn(alice, winter(3, 5, 10 + index), budget));
    outcomes.push(await tryOn(bruno, winter(3, 6, 10), budget));
    expect(outcomes.every((outcome) => outcome === "free")).toBe(true);
    // 7e essai : 0,525 $ ≥ 80 % de 0,60 $.
    const seventh = await reserve(bruno, winter(3, 6, 11), { budget });
    expect((await complete(bruno, seventh.event_id!, winter(3, 6, 11, 1), budget)).new_alerts).toEqual(["budget_80"]);
    // 8e essai : 0,60 $ ; plus de quoi payer un essai de plus.
    const eighth = await reserve(bruno, winter(3, 6, 12), { budget });
    expect(eighth.status).toBe("reserved");
    expect((await complete(bruno, eighth.event_id!, winter(3, 6, 12, 1), budget)).new_alerts).toEqual(["budget_100"]);
    expect((await reserve(bruno, winter(3, 7), { budget })).status).toBe("budget_reached");
    const { data: alerts } = await app.supabaseAdmin.from("tryon_alerts").select("kind").eq("period", monthKey(3)).order("kind");
    expect(alerts).toEqual([{ kind: "budget_100" }, { kind: "budget_80" }]);
    const { data: usage } = await app.supabaseAdmin.from("tryon_usage_months").select("credits_used, tries_succeeded").eq("month", monthKey(3)).single();
    expect(usage).toEqual({ credits_used: 8, tries_succeeded: 8 });
  });

  it("un essai bloqué plus de 3 minutes est libéré ; un échec n'est jamais décompté", async () => {
    const first = await reserve(alice, winter(6, 10, 12, 0));
    expect(first.status).toBe("reserved");
    expect((await reserve(alice, winter(6, 10, 12, 2))).status).toBe("in_progress");
    const second = await reserve(alice, winter(6, 10, 12, 4));
    expect(second.status).toBe("reserved");
    const { data: released } = await app.supabaseAdmin.from("tryon_events").select("status, error_code").eq("id", first.event_id!).single();
    expect(released).toEqual({ status: "failed", error_code: "expired" });
    expect((await app.supabaseAdmin.rpc("tryon_fail", { p_event_id: second.event_id, p_user_id: alice.id, p_error_code: "pose_not_detected", p_duration_ms: 9000 })).data).toBe(true);
    expect(await remaining(alice, winter(6, 20))).toBe("5+0");
  });

  it("essais offerts par commande : une seule fois par commande, jamais pour un autre membre", async () => {
    const order = `test-commande-${alice.id}`;
    const first = await app.supabaseAdmin.rpc("tryon_grant_bonus", { p_user_id: alice.id, p_order_ref: order });
    const again = await app.supabaseAdmin.rpc("tryon_grant_bonus", { p_user_id: alice.id, p_order_ref: order });
    const other = await app.supabaseAdmin.rpc("tryon_grant_bonus", { p_user_id: bruno.id, p_order_ref: order });
    const rows = z.array(z.object({ granted: z.boolean(), expires_at: z.string().nullable() })).length(1);
    const [granted] = rows.parse(first.data);
    expect(granted!.granted).toBe(true);
    expect(rows.parse(again.data)[0]).toEqual({ granted: false, expires_at: granted!.expires_at });
    expect(rows.parse(other.data)[0]).toEqual({ granted: false, expires_at: null });
    const { data } = await app.supabaseAdmin.from("tryon_bonus_grants").select("quantity, remaining").eq("order_ref", order);
    expect(data).toEqual([{ quantity: 5, remaining: 5 }]);
  });

  it("ni les visiteurs ni les comptes connectés ne lisent ces tables ni n'appellent ces fonctions", async () => {
    const visitor = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    for (const table of ["feature_flags", "tryon_profiles", "tryon_events", "tryon_bonus_grants", "tryon_reports", "tryon_alerts", "tryon_usage_months"]) {
      const read = await visitor.from(table).select("*").limit(1);
      expect(read.data ?? [], table).toEqual([]);
    }
    const call = await visitor.rpc("tryon_set_age", { p_user_id: chloe.id, p_status: "adult" });
    expect(call.error).not.toBeNull();
    const flag = await visitor.from("feature_flags").update({ enabled: true }).eq("key", "tryon").select("key");
    expect(flag.data ?? []).toEqual([]);
  });

  it("suppression d'un compte : tout ce qui concerne l'essayage part avec lui (aucune erreur de droits)", async () => {
    await app.supabaseAdmin.from("tryon_reports").insert({ user_id: chloe.id, item_id: ITEM, reason: "other" });
    await app.supabaseAdmin.rpc("tryon_grant_bonus", { p_user_id: chloe.id, p_order_ref: `test-commande-${chloe.id}` });
    const { error } = await app.supabaseAdmin.auth.admin.deleteUser(chloe.id);
    expect(error).toBeNull();
    for (const table of ["tryon_profiles", "tryon_events", "tryon_bonus_grants", "tryon_reports"]) {
      const { count, error: readError } = await app.supabaseAdmin.from(table).select("*", { count: "exact", head: true }).eq("user_id", chloe.id);
      expect(readError, table).toBeNull();
      expect(count, table).toBe(0);
    }
  });

  // En dernier : la purge efface aussi les essais d'essai (années passées).
  it("purge : plus de 12 mois effacés ; le reste demeure", async () => {
    const old = new Date(Date.now() - 400 * 24 * 3_600_000).toISOString();
    const recent = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const reports = await app.supabaseAdmin.from("tryon_reports").insert([
      { user_id: bruno.id, item_id: ITEM, reason: "other", created_at: old },
      { user_id: bruno.id, item_id: ITEM, reason: "poor_quality", created_at: recent },
    ]);
    expect(reports.error).toBeNull();
    const { data, error } = await app.supabaseAdmin.rpc("tryon_purge", { p_months: 12 });
    expect(error).toBeNull();
    const [counts] = z.array(z.object({ events: z.number(), reports: z.number(), alerts: z.number(), grants: z.number() })).length(1).parse(data);
    expect(counts!.reports).toBeGreaterThanOrEqual(1);
    const { data: left } = await app.supabaseAdmin.from("tryon_reports").select("reason").eq("user_id", bruno.id);
    expect(left).toEqual([{ reason: "poor_quality" }]);
    const { count } = await app.supabaseAdmin.from("tryon_events").select("*", { count: "exact", head: true }).eq("user_id", alice.id);
    expect(count).toBe(0);
  });
});
