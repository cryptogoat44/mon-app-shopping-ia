// Essayage virtuel : lectures et écritures dans la base (migration 0042),
// toujours avec la clé du serveur. Chaque réponse est vérifiée (zod). Une
// lecture ou une écriture impossible relève TryonStoreError, au message
// fixe : ni valeur, ni ligne de la base n'en sortent (le journal ne garde que
// son nom et le code de la base, lib/logPrivacy.ts).
// Les règles elles-mêmes (quota, un essai à la fois, budget, alertes) sont
// appliquées par les fonctions de la base, en une transaction : le serveur
// ne fait que les appeler.
import type { FastifyInstance } from "fastify";
import type { TryonReportReason } from "@monapp/shared-types";
import { z } from "zod";
import type { AgeStatus } from "./ageGate.js";
import type { TryonAlertKind } from "./alerts.js";
import type { BudgetAlertKind } from "./budget.js";
import { TRYON_CONSENT_VERSION, type TryonConfig } from "./config.js";
import { hasStandingConsent, TRYON_PROFILE_ROW, type TryonProfileRow } from "./consent.js";
import type { TryonFailureCode } from "./failures.js";

type Db = FastifyInstance["supabaseAdmin"];

/** Lecture ou écriture de l'essayage impossible (base injoignable, réponse illisible). */
export class TryonStoreError extends Error {
  readonly code: string | undefined;

  constructor(operation: string, code?: string) {
    super(`Essayage virtuel : ${operation} impossible`);
    this.name = "TryonStoreError";
    this.code = code;
  }
}

/** Crédits d'un essai tryon-v1.6 (une image), réservés sur le budget. */
export const CREDITS_PER_TRY = 1;
/** Essais en cours au plus sur tout le service : la limite de FASHN (6 à la fois). */
export const MAX_TRIES_IN_FLIGHT = 6;
/** Durée d'un essai gardée au plus (la base refuse au-delà de 10 minutes). */
const MAX_DURATION_MS = 600_000;
/** Codes d'une table absente (base sans 0042), selon Postgres ou PostgREST. */
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

export const TRYON_PROFILE_COLUMNS = "age_status, age_checked_at, consent_version, consent_accepted_at, consent_withdrawn_at";

/** Durée en millisecondes, bornée comme la base l'accepte. */
export function storedDuration(milliseconds: number): number {
  return Math.min(Math.max(Math.round(milliseconds), 0), MAX_DURATION_MS);
}

/** Le profil d'essayage du membre ; null s'il n'a pas encore passé la porte d'âge. */
export async function readTryonProfile(db: Db, userId: string): Promise<TryonProfileRow | null> {
  const { data, error } = await db.from("tryon_profiles").select(TRYON_PROFILE_COLUMNS).eq("user_id", userId).maybeSingle();
  if (error) throw new TryonStoreError("lecture du profil d'essayage", error.code);
  if (data === null) return null;
  const parsed = TRYON_PROFILE_ROW.safeParse(data);
  if (!parsed.success) throw new TryonStoreError("lecture du profil d'essayage");
  return parsed.data;
}

/** Un consentement est-il donné (accepté, jamais retiré depuis, quelle que
 * soit sa version) ? Lisible même fonction éteinte ; base sans 0042 : rien
 * n'a pu être accepté. */
export async function readConsentGiven(db: Db, userId: string): Promise<boolean> {
  try {
    return hasStandingConsent(await readTryonProfile(db, userId));
  } catch (error) {
    if (error instanceof TryonStoreError && MISSING_TABLE_CODES.has(error.code ?? "")) return false;
    throw error;
  }
}

/** Enregistre le statut d'âge, une seule fois : false s'il l'était déjà. */
export async function recordAgeStatus(db: Db, userId: string, status: AgeStatus): Promise<boolean> {
  const { data, error } = await db.rpc("tryon_set_age", { p_user_id: userId, p_status: status });
  if (error || typeof data !== "boolean") throw new TryonStoreError("enregistrement du statut d'âge", error?.code);
  return data;
}

/** Consentement accepté pour cette version (le profil existe : la porte d'âge est passée). */
export async function acceptConsent(db: Db, userId: string, version: string, at: Date): Promise<void> {
  const { data, error } = await db
    .from("tryon_profiles")
    .update({ consent_version: version, consent_accepted_at: at.toISOString(), consent_withdrawn_at: null })
    .eq("user_id", userId)
    .select("user_id");
  if (error || !Array.isArray(data) || data.length !== 1) throw new TryonStoreError("enregistrement du consentement", error?.code);
}

/** Retire le consentement en vigueur (la version et la date d'acceptation
 * restent, pour l'historique). Base sans 0042 : rien n'a pu être accepté. */
export async function withdrawConsent(db: Db, userId: string, at: Date): Promise<void> {
  const { error } = await db
    .from("tryon_profiles")
    .update({ consent_withdrawn_at: at.toISOString() })
    .eq("user_id", userId)
    .is("consent_withdrawn_at", null)
    .not("consent_accepted_at", "is", null);
  if (error && !MISSING_TABLE_CODES.has(error.code ?? "")) throw new TryonStoreError("retrait du consentement", error.code);
}

const REMAINING_ROWS = z.array(z.object({ free_remaining: z.number().int().min(0), bonus_remaining: z.number().int().min(0) })).length(1);

/** Essais restants : gratuits du mois civil, offerts encore valables. */
export async function readRemaining(db: Db, userId: string, config: TryonConfig): Promise<{ free: number; bonus: number }> {
  const { data, error } = await db.rpc("tryon_remaining", { p_user_id: userId, p_free_per_month: config.freePerMonth, p_timezone: config.timeZone });
  const parsed = REMAINING_ROWS.safeParse(data);
  if (error || !parsed.success) throw new TryonStoreError("lecture des essais restants", error?.code);
  return { free: parsed.data[0]!.free_remaining, bonus: parsed.data[0]!.bonus_remaining };
}

export const RESERVATION_STATUSES = ["reserved", "not_allowed", "in_progress", "quota_exhausted", "busy", "budget_reached"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
const RESERVE_ROWS = z
  .array(
    z.object({
      status: z.enum(RESERVATION_STATUSES),
      event_id: z.guid().nullable(),
      free_remaining: z.number().int().nullable(),
      bonus_remaining: z.number().int().nullable(),
    })
  )
  .length(1);

/** Réservé (avec les essais restants AVANT celui-ci), ou la raison du refus. */
export type Reservation = { status: "reserved"; eventId: string; free: number; bonus: number } | { status: Exclude<ReservationStatus, "reserved"> };

/** Réserve un essai (quota, un seul essai à la fois, essais en cours du
 * service, budget) : la décision de la base, en une transaction. */
export async function reserveTry(db: Db, userId: string, itemId: string, config: TryonConfig): Promise<Reservation> {
  const { data, error } = await db.rpc("tryon_reserve", {
    p_user_id: userId,
    p_item_id: itemId,
    p_consent_version: TRYON_CONSENT_VERSION,
    p_free_per_month: config.freePerMonth,
    p_budget_usd: config.monthlyBudgetUsd,
    p_price_per_credit_usd: config.pricePerCreditUsd,
    p_credits_per_try: CREDITS_PER_TRY,
    p_max_in_flight: MAX_TRIES_IN_FLIGHT,
    p_timezone: config.timeZone,
  });
  const parsed = RESERVE_ROWS.safeParse(data);
  if (error || !parsed.success) throw new TryonStoreError("réservation d'un essai", error?.code);
  const row = parsed.data[0]!;
  if (row.status !== "reserved") return { status: row.status };
  if (!row.event_id || row.free_remaining === null || row.bonus_remaining === null) throw new TryonStoreError("réservation d'un essai");
  return { status: "reserved", eventId: row.event_id, free: row.free_remaining, bonus: row.bonus_remaining };
}

const COMPLETE_ROWS = z
  .array(
    z.object({
      status: z.enum(["completed", "not_found"]),
      quota_source: z.enum(["free", "bonus"]).nullable(),
      free_remaining: z.number().int().nullable(),
      bonus_remaining: z.number().int().nullable(),
      new_alerts: z.array(z.enum(["budget_80", "budget_100"])),
    })
  )
  .length(1);

/** `quotaSource` null : essai réussi, mais jamais décompté du quota du membre
 * (libéré par la base après 3 minutes, puis rattrapé) ; ses crédits comptent
 * quand même dans la dépense du mois. */
export type Completion =
  | { status: "completed"; quotaSource: "free" | "bonus" | null; free: number; bonus: number; newAlerts: BudgetAlertKind[] }
  | { status: "not_found" };

/** Essai réussi : la base le décompte (gratuit, puis offert) et tient le budget. */
export async function completeTry(db: Db, eventId: string, userId: string, creditsUsed: number, durationMs: number, config: TryonConfig): Promise<Completion> {
  const { data, error } = await db.rpc("tryon_complete", {
    p_event_id: eventId,
    p_user_id: userId,
    p_credits_used: creditsUsed,
    p_duration_ms: storedDuration(durationMs),
    p_free_per_month: config.freePerMonth,
    p_budget_usd: config.monthlyBudgetUsd,
    p_price_per_credit_usd: config.pricePerCreditUsd,
    p_alert_threshold: config.alertThreshold,
    p_timezone: config.timeZone,
  });
  const parsed = COMPLETE_ROWS.safeParse(data);
  if (error || !parsed.success) throw new TryonStoreError("décompte d'un essai", error?.code);
  const row = parsed.data[0]!;
  if (row.status === "not_found" || row.free_remaining === null || row.bonus_remaining === null) return { status: "not_found" };
  return { status: "completed", quotaSource: row.quota_source, free: row.free_remaining, bonus: row.bonus_remaining, newAlerts: row.new_alerts };
}

const FAIL_ROWS = z
  .array(z.object({ recorded: z.boolean(), new_alerts: z.array(z.enum(["budget_80", "budget_100"])) }))
  .length(1);

/** Crédits qu'un essai échoué peut avoir coûtés, au plus (comme la base). */
const MAX_CREDITS_PER_TRY = 10;

/** Essai échoué : un code court, rien n'est décompté du quota du membre.
 * `creditsBilled` : les crédits que le fournisseur a pu facturer malgré
 * l'échec (0 le plus souvent) ; la base les ajoute à la dépense du mois
 * (compteurs sans membre) et dit les alertes du budget qui viennent
 * d'apparaître. `recorded` : l'essai en cours a bien été noté. */
export async function failTry(
  db: Db,
  eventId: string,
  userId: string,
  code: TryonFailureCode,
  durationMs: number,
  creditsBilled: number,
  config: TryonConfig
): Promise<{ recorded: boolean; newAlerts: BudgetAlertKind[] }> {
  const { data, error } = await db.rpc("tryon_fail", {
    p_event_id: eventId,
    p_user_id: userId,
    p_error_code: code,
    p_duration_ms: storedDuration(durationMs),
    p_credits_billed: Math.min(Math.max(Math.round(creditsBilled), 0), MAX_CREDITS_PER_TRY),
    p_budget_usd: config.monthlyBudgetUsd,
    p_price_per_credit_usd: config.pricePerCreditUsd,
    p_alert_threshold: config.alertThreshold,
  });
  const parsed = FAIL_ROWS.safeParse(data);
  if (error || !parsed.success) throw new TryonStoreError("échec d'un essai", error?.code);
  return { recorded: parsed.data[0]!.recorded, newAlerts: parsed.data[0]!.new_alerts };
}

/** Enregistre une alerte une seule fois par période : true si elle est nouvelle. */
export async function recordAlertOnce(db: Db, kind: TryonAlertKind, period: string, details: Record<string, string | number>): Promise<boolean> {
  const { data, error } = await db.rpc("tryon_alert_once", { p_kind: kind, p_period: period, p_details: details });
  if (error || typeof data !== "boolean") throw new TryonStoreError("enregistrement d'une alerte", error?.code);
  return data;
}

const ID_ROWS = z.array(z.object({ id: z.guid() }));

/** Le membre a-t-il essayé cette pièce ? (un signalement porte sur un essai). */
export async function hasTriedItem(db: Db, userId: string, itemId: string): Promise<boolean> {
  const { data, error } = await db.from("tryon_events").select("id").eq("user_id", userId).eq("item_id", itemId).limit(1);
  const parsed = ID_ROWS.safeParse(data ?? []);
  if (error || !parsed.success) throw new TryonStoreError("lecture des essais", error?.code);
  return parsed.data.length > 0;
}

/** Enregistre un signalement : la pièce, le motif, la précision ; jamais d'image. */
export async function insertReport(db: Db, userId: string, itemId: string, reason: TryonReportReason, comment: string | null): Promise<void> {
  const { error } = await db.from("tryon_reports").insert({ user_id: userId, item_id: itemId, reason, comment });
  if (error) throw new TryonStoreError("enregistrement d'un signalement", error.code);
}
