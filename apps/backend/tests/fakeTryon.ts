import { randomUUID } from "node:crypto";
import { budgetThresholdsReached, reservationFitsBudget } from "../src/lib/tryon/budget.js";
import { monthKeyAt } from "../src/lib/tryon/calendar.js";
import { bonusRemaining, freeRemaining, quotaSourceFor, type BonusGrant } from "../src/lib/tryon/quota.js";
import type { Row, fakeSupabase } from "./fakeSupabase.js";

// Les fonctions de la base de l'essayage virtuel (migration 0042), imitées en
// mémoire pour les tests des routes (fausse base, tests/fakeSupabase.ts) :
// mêmes règles, mêmes réponses, dans le même ordre que le SQL (vérifié, lui,
// sur une base Postgres jetable et par essayageBase.test.ts). Les règles de
// calcul viennent des mêmes fonctions pures que le serveur (calendrier,
// quota, budget). Une base sans 0042 : `missing` ; une panne : `failing`.

type Fake = ReturnType<typeof fakeSupabase>;
type RpcResult = { data: unknown; error: { code?: string; message: string } | null };

const STALE_MS = 3 * 60_000;
const LATE_COMPLETION_MS = 10 * 60_000;
const at = (value: unknown) => new Date(String(value)).getTime();

export interface FakeTryonOptions {
  /** Base sans 0042 : chaque fonction est « absente ». */
  missing?: boolean;
  /** Fonctions en panne (erreur de la base). */
  failing?: string[];
  /** Horloge quand la fonction n'en reçoit pas (p_at absent). */
  now?: () => Date;
}

/** Le gestionnaire `rpc` de la fausse base, qui imite les fonctions de 0042. */
export function tryonRpc(fake: () => Fake, options: FakeTryonOptions = {}) {
  const now = options.now ?? (() => new Date());
  const table = (name: string) => fake().table(name);
  const instant = (value: unknown) => (value ? new Date(String(value)) : now());

  const grantsOf = (userId: unknown): (BonusGrant & { row: Row })[] =>
    table("tryon_bonus_grants")
      .filter((row) => row.user_id === userId)
      .map((row) => ({ id: String(row.id), remaining: Number(row.remaining), expiresAt: new Date(String(row.expires_at)), createdAt: new Date(String(row.created_at)), row }));

  const freeUsed = (userId: unknown, month: string) =>
    table("tryon_events").filter((row) => row.user_id === userId && row.status === "succeeded" && row.quota_source === "free" && row.month === month).length;

  const pendingSince = (since: number, until: number) => table("tryon_events").filter((row) => row.status === "pending" && at(row.created_at) >= since && at(row.created_at) <= until);

  function alertOnce(kind: string, period: string, details: unknown): boolean {
    if (table("tryon_alerts").some((row) => row.kind === kind && row.period === period)) return false;
    table("tryon_alerts").push({ id: randomUUID(), kind, period, details, created_at: now().toISOString() });
    return true;
  }

  const functions: Record<string, (args: Record<string, unknown>) => unknown> = {
    tryon_version: () => 1,

    tryon_set_age: ({ p_user_id, p_status }) => {
      const profile = table("tryon_profiles").find((row) => row.user_id === p_user_id);
      if (profile?.age_status) return false;
      const values = { age_status: p_status, age_checked_at: now().toISOString() };
      if (profile) Object.assign(profile, values);
      else table("tryon_profiles").push({ user_id: p_user_id, consent_version: null, consent_accepted_at: null, consent_withdrawn_at: null, ...values });
      return true;
    },

    tryon_reset_age: ({ p_user_id }) => {
      const profile = table("tryon_profiles").find((row) => row.user_id === p_user_id && row.age_status);
      if (!profile) return false;
      Object.assign(profile, { age_status: null, age_checked_at: null });
      return true;
    },

    tryon_remaining: ({ p_user_id, p_free_per_month, p_timezone, p_at }) => {
      const moment = instant(p_at);
      return [
        {
          free_remaining: freeRemaining(freeUsed(p_user_id, monthKeyAt(moment, String(p_timezone))), Number(p_free_per_month)),
          bonus_remaining: bonusRemaining(grantsOf(p_user_id), moment),
        },
      ];
    },

    tryon_reserve: (args) => {
      const moment = instant(args.p_at);
      const time = moment.getTime();
      const month = monthKeyAt(moment, String(args.p_timezone));
      // Essais bloqués plus de 3 minutes : libérés.
      for (const row of table("tryon_events")) {
        if (row.status === "pending" && at(row.created_at) < time - STALE_MS) Object.assign(row, { status: "failed", error_code: "expired", finished_at: moment.toISOString() });
      }
      const refused = (status: string, free: number | null = null, bonus: number | null = null) => [{ status, event_id: null, free_remaining: free, bonus_remaining: bonus }];
      const profile = table("tryon_profiles").find((row) => row.user_id === args.p_user_id);
      if (!profile || profile.age_status !== "adult" || profile.consent_version !== args.p_consent_version || !profile.consent_accepted_at || profile.consent_withdrawn_at) {
        return refused("not_allowed");
      }
      const window = pendingSince(time - STALE_MS, time);
      if (window.some((row) => row.user_id === args.p_user_id)) return refused("in_progress");
      const free = freeRemaining(freeUsed(args.p_user_id, month), Number(args.p_free_per_month));
      const bonus = bonusRemaining(grantsOf(args.p_user_id), moment);
      if (free + bonus <= 0) return refused("quota_exhausted", free, bonus);
      if (window.length >= Number(args.p_max_in_flight)) return refused("busy", free, bonus);
      const credits = Number(table("tryon_usage_months").find((row) => row.month === month)?.credits_used ?? 0);
      const rule = { budgetUsd: Number(args.p_budget_usd), pricePerCreditUsd: Number(args.p_price_per_credit_usd), alertThreshold: 1 };
      if (!reservationFitsBudget(rule, credits, window.length, Number(args.p_credits_per_try))) return refused("budget_reached", free, bonus);
      const id = randomUUID();
      table("tryon_events").push({
        id,
        user_id: args.p_user_id,
        item_id: args.p_item_id,
        status: "pending",
        credits_used: 0,
        quota_source: null,
        bonus_grant_id: null,
        error_code: null,
        duration_ms: null,
        month,
        created_at: moment.toISOString(),
        finished_at: null,
      });
      return [{ status: "reserved", event_id: id, free_remaining: free, bonus_remaining: bonus }];
    },

    tryon_complete: (args) => {
      const moment = instant(args.p_at);
      const event = table("tryon_events").find((row) => row.id === args.p_event_id && row.user_id === args.p_user_id);
      const late = event?.status === "failed" && event.error_code === "expired" && at(event.finished_at) > moment.getTime() - LATE_COMPLETION_MS;
      if (!event || !(event.status === "pending" || late)) return [{ status: "not_found", quota_source: null, free_remaining: null, bonus_remaining: null, new_alerts: [] }];
      const month = String(event.month);
      const { source, grant } = quotaSourceFor(freeUsed(args.p_user_id, month), Number(args.p_free_per_month), grantsOf(args.p_user_id), new Date(String(event.created_at)));
      if (grant) (grant as BonusGrant & { row: Row }).row.remaining = grant.remaining - 1;
      const credits = Number(args.p_credits_used);
      Object.assign(event, {
        status: "succeeded",
        credits_used: credits,
        quota_source: source,
        bonus_grant_id: grant?.id ?? null,
        duration_ms: args.p_duration_ms,
        error_code: null,
        finished_at: moment.toISOString(),
      });
      let usage = table("tryon_usage_months").find((row) => row.month === month);
      if (!usage) {
        usage = { month, credits_used: 0, tries_succeeded: 0 };
        table("tryon_usage_months").push(usage);
      }
      usage.credits_used = Number(usage.credits_used) + credits;
      usage.tries_succeeded = Number(usage.tries_succeeded) + 1;
      const rule = { budgetUsd: Number(args.p_budget_usd), pricePerCreditUsd: Number(args.p_price_per_credit_usd), alertThreshold: Number(args.p_alert_threshold) };
      const details = { credits: usage.credits_used, budget_usd: rule.budgetUsd };
      const newAlerts = budgetThresholdsReached(rule, Number(usage.credits_used), credits).filter((kind) => alertOnce(kind, month, details));
      const nowMonth = monthKeyAt(moment, String(args.p_timezone));
      return [
        {
          status: "completed",
          quota_source: source,
          free_remaining: freeRemaining(freeUsed(args.p_user_id, nowMonth), Number(args.p_free_per_month)),
          bonus_remaining: bonusRemaining(grantsOf(args.p_user_id), moment),
          new_alerts: newAlerts,
        },
      ];
    },

    tryon_fail: ({ p_event_id, p_user_id, p_error_code, p_duration_ms }) => {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(String(p_error_code))) throw new Error("tryon_fail : paramètres invalides");
      const event = table("tryon_events").find(
        (row) => row.id === p_event_id && row.user_id === p_user_id && (row.status === "pending" || (row.status === "failed" && row.error_code === "expired"))
      );
      if (!event) return false;
      Object.assign(event, { status: "failed", error_code: p_error_code, duration_ms: p_duration_ms, finished_at: now().toISOString() });
      return true;
    },

    tryon_alert_once: ({ p_kind, p_period, p_details }) => alertOnce(String(p_kind), String(p_period), p_details),

    tryon_grant_bonus: ({ p_user_id, p_order_ref, p_quantity = 5, p_validity_days = 365 }) => {
      const existing = table("tryon_bonus_grants").find((row) => row.order_ref === p_order_ref);
      if (existing) return [{ granted: false, expires_at: existing.user_id === p_user_id ? existing.expires_at : null }];
      const expiresAt = new Date(now().getTime() + Number(p_validity_days) * 86_400_000).toISOString();
      table("tryon_bonus_grants").push({
        id: randomUUID(),
        user_id: p_user_id,
        order_ref: p_order_ref,
        quantity: p_quantity,
        remaining: p_quantity,
        expires_at: expiresAt,
        created_at: now().toISOString(),
      });
      return [{ granted: true, expires_at: expiresAt }];
    },
  };

  return async (fn: string, args: Record<string, unknown> = {}): Promise<RpcResult> => {
    const run = functions[fn];
    if (!run || options.missing) return { data: null, error: { code: "PGRST202", message: "fonction absente" } };
    if (options.failing?.includes(fn)) return { data: null, error: { code: "XX000", message: "panne simulée" } };
    try {
      return { data: run(args), error: null };
    } catch (error) {
      return { data: null, error: { code: "P0001", message: error instanceof Error ? error.message : "erreur" } };
    }
  };
}
