// Quotas par membre (lot quotas, décisions du fondateur du 19 novembre 2026,
// migration 0053) : qu'aucun mois ne finisse dans le négatif chez SerpApi,
// sans jamais bloquer un abonné à cause de l'usage des comptes gratuits.
// - Compte gratuit : 100 recherches par mois civil (du 1er à 0 h, heure de
//   Paris), comptées comme la part du jour (serpapi_quota_v2).
// - Tout le monde garde la part de 8 par jour (SERPAPI_USER_DAILY_CAP).
// - Abonné (droit « video » ou « miroir » en cours, abonnements allumés) :
//   aucune part du mois, sauf le garde-fou SUBSCRIBER_MONTHLY_SEARCH_CAP.
// - Réserve des abonnés : un compte gratuit s'arrête à 70 % des plafonds
//   globaux du jour et du mois (SUBSCRIBER_RESERVE_PERCENT, 30 par défaut),
//   un abonné va jusqu'à 100 %. Abonnements coupés : réserve à 0.
// Ici : les réglages (lecture tolérante), la sonde de 0053, la lecture des
// droits d'abonnement et la formule d'une personne. Le compte lui-même reste
// dans la base, en une transaction (lib/searchCapacity.ts).
// Sans 0053 : rien de tout cela (null), le serveur appelle serpapi_quota
// comme avant, et le journal le dit une fois.
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.js";

/** Recherches par mois civil d'un compte gratuit (décision 1 du fondateur). */
export const FREE_MONTHLY_SEARCH_CAP = 100;
/** Réserve des abonnés par défaut, en pourcentage des plafonds globaux. */
export const DEFAULT_SUBSCRIBER_RESERVE_PERCENT = 30;
/** Réserve la plus haute acceptée (comme la base, serpapi_quota_v2). */
export const MAX_SUBSCRIBER_RESERVE_PERCENT = 90;
/** Droits qui font un abonné (0053 : « video », « miroir »). */
export const SUBSCRIBER_ENTITLEMENTS = ["video", "miroir"] as const;
export type SubscriberEntitlement = (typeof SUBSCRIBER_ENTITLEMENTS)[number];

// ---- Réglages ----

export interface QuotaSettings {
  /** SUBSCRIPTIONS_ENABLED : seule la valeur exacte "true" allume les abonnements. */
  subscriptionsEnabled: boolean;
  /** SUBSCRIBER_MONTHLY_SEARCH_CAP : null, aucune limite du mois pour un abonné. */
  subscriberMonthlyCap: number | null;
  /** SUBSCRIBER_RESERVE_PERCENT, réglé ou par défaut (avant l'interrupteur). */
  reservePercent: number;
}

export type QuotaEnvSource = Pick<typeof env, "SUBSCRIPTIONS_ENABLED" | "SUBSCRIBER_MONTHLY_SEARCH_CAP" | "SUBSCRIBER_RESERVE_PERCENT">;

// Entiers écrits simplement : ni signe, ni exposant, ni décimale.
const MONTHLY_CAP = /^[1-9]\d{0,6}$/;
const PERCENT = /^(?:0|[1-9]\d?)$/;

/** Les réglages des quotas. Une valeur invalide ajoute une raison à
 * `problems` (le nom de la variable, jamais sa valeur) et prend la valeur
 * par défaut : absente pour le garde-fou des abonnés, 30 pour la réserve. */
export function readQuotaSettings(source: QuotaEnvSource, problems: string[]): QuotaSettings {
  const capText = source.SUBSCRIBER_MONTHLY_SEARCH_CAP?.trim();
  let subscriberMonthlyCap: number | null = null;
  if (capText) {
    if (MONTHLY_CAP.test(capText)) subscriberMonthlyCap = Number(capText);
    else problems.push("SUBSCRIBER_MONTHLY_SEARCH_CAP : entier de 1 ou plus attendu, réglage ignoré (aucune limite du mois pour les abonnés)");
  }
  const percentText = source.SUBSCRIBER_RESERVE_PERCENT?.trim();
  let reservePercent = DEFAULT_SUBSCRIBER_RESERVE_PERCENT;
  if (percentText) {
    if (PERCENT.test(percentText) && Number(percentText) <= MAX_SUBSCRIBER_RESERVE_PERCENT) reservePercent = Number(percentText);
    else problems.push(`SUBSCRIBER_RESERVE_PERCENT : entier de 0 à ${MAX_SUBSCRIBER_RESERVE_PERCENT} attendu, ${DEFAULT_SUBSCRIBER_RESERVE_PERCENT} retenu`);
  }
  return { subscriptionsEnabled: source.SUBSCRIPTIONS_ENABLED === true, subscriberMonthlyCap, reservePercent };
}

/** Les réglages en vigueur (lus à chaque appel : quelques comparaisons). */
export function quotaSettings(source: QuotaEnvSource = env): QuotaSettings {
  return readQuotaSettings(source, []);
}

interface WarnLog {
  warn(fields: Record<string, unknown>, message: string): void;
}

/** Une ligne d'avertissement, au démarrage, si un réglage est invalide. */
export function logQuotaSettings(log: WarnLog, source: QuotaEnvSource = env): void {
  const problems: string[] = [];
  readQuotaSettings(source, problems);
  if (problems.length > 0) log.warn({ problems }, "Quotas par membre : réglages invalides ignorés");
}

/** Un plafond global réduit de la réserve, arrondi à l'entier inférieur
 * (le même calcul que serpapi_quota_v2). */
export function reducedCap(cap: number, reservePercent: number): number {
  return Math.floor((cap * (100 - reservePercent)) / 100);
}

// ---- Sonde de la migration 0053 ----

const SCHEMA_RETRY_MS = 5 * 60_000;
const FUNCTION_MISSING_CODES = new Set(["PGRST202", "42883"]);
type Database = Pick<FastifyInstance, "supabaseAdmin" | "log">;

let readyAt: number | null = null;
let missingAt: number | null = null;
let absenceLogged = false;
let probe: Promise<boolean> | null = null;

async function probeSchema(fastify: Database): Promise<boolean> {
  try {
    const { data, error } = await fastify.supabaseAdmin.rpc("member_quotas_version");
    if (!error && typeof data === "number" && data >= 1) return true;
    const missing = error !== null && FUNCTION_MISSING_CODES.has(error.code ?? "");
    // Absente : dit une seule fois (le serveur fonctionne alors comme avant).
    if (!missing) fastify.log.warn({ code: error?.code ?? null }, "Quotas par membre : schéma inconnu, recherches comme avant");
    else if (!absenceLogged) {
      absenceLogged = true;
      fastify.log.warn({ code: error.code ?? null }, "Quotas par membre coupés : migration 0053 absente, recherches comme avant");
    }
  } catch {
    fastify.log.warn({ code: null }, "Quotas par membre : base injoignable, recherches comme avant");
  }
  return false;
}

/** La base a-t-elle la migration 0053 ? Mémorisé une fois vu ; sinon, la
 * sonde n'est refaite qu'au bout de 5 minutes. */
export async function memberQuotasReady(fastify: Database, now: () => number = Date.now): Promise<boolean> {
  if (readyAt !== null) return true;
  if (missingAt !== null && now() - missingAt < SCHEMA_RETRY_MS) return false;
  probe ??= probeSchema(fastify)
    .then((ready) => {
      if (ready) readyAt = now();
      else missingAt = now();
      return ready;
    })
    .finally(() => {
      probe = null;
    });
  return probe;
}

/** Tests seulement : oublie la sonde. */
export function resetMemberQuotasProbe(): void {
  readyAt = null;
  missingAt = null;
  absenceLogged = false;
  probe = null;
}

// ---- Droits d'abonnement ----

const ENTITLEMENT_ROWS = z.array(z.object({ entitlement: z.enum(SUBSCRIBER_ENTITLEMENTS), expires_at: z.string().nullable() }));

/** Un droit est en cours s'il n'a pas de fin, ou une fin encore à venir
 * (une date illisible : non, par prudence pour les coûts). */
export function entitlementActive(expiresAt: string | null, now: Date): boolean {
  return expiresAt === null || Date.parse(expiresAt) > now.getTime();
}

/** Abonné : abonnements allumés ET un droit « video » ou « miroir » en
 * cours. Rien n'est lu quand les abonnements sont coupés, ni sans 0053.
 * Lecture impossible : traité comme un compte gratuit (prudent pour les
 * coûts), écrit au journal, jamais une recherche refusée pour cette raison. */
export async function isSubscriber(fastify: Database, log: Pick<FastifyBaseLogger, "warn">, userId: string, now: Date = new Date()): Promise<boolean> {
  if (!quotaSettings().subscriptionsEnabled) return false;
  if (!(await memberQuotasReady(fastify))) return false;
  try {
    const { data, error } = await fastify.supabaseAdmin
      .from("member_entitlements")
      .select("entitlement, expires_at")
      .eq("user_id", userId)
      .in("entitlement", [...SUBSCRIBER_ENTITLEMENTS]);
    const rows = ENTITLEMENT_ROWS.safeParse(data);
    if (error || !rows.success) {
      log.warn({ code: error?.code ?? null }, "Droits d'abonnement illisibles : règles d'un compte gratuit");
      return false;
    }
    return rows.data.some((row) => entitlementActive(row.expires_at, now));
  } catch {
    log.warn({ code: null }, "Droits d'abonnement illisibles : règles d'un compte gratuit");
    return false;
  }
}

// ---- Formule d'une personne ----

/** Ce que serpapi_quota_v2 applique à une personne. */
export interface SearchTier {
  subscriber: boolean;
  /** Part du mois civil ; null : aucune. */
  monthlyCap: number | null;
  /** Part des plafonds globaux du jour et du mois tenue hors de sa portée (0 à 90). */
  reservePercent: number;
}

/** La formule, d'après les réglages : abonné, ou compte gratuit. */
export function tierFor(subscriber: boolean, settings: QuotaSettings): SearchTier {
  if (subscriber) return { subscriber: true, monthlyCap: settings.subscriberMonthlyCap, reservePercent: 0 };
  return { subscriber: false, monthlyCap: FREE_MONTHLY_SEARCH_CAP, reservePercent: settings.subscriptionsEnabled ? settings.reservePercent : 0 };
}

/** La formule d'une personne ; null sans la migration 0053 (comme avant :
 * ni part du mois, ni réserve). */
export async function searchTierFor(fastify: Database, log: Pick<FastifyBaseLogger, "warn">, userId: string, now: Date = new Date()): Promise<SearchTier | null> {
  if (!(await memberQuotasReady(fastify))) return null;
  return tierFor(await isSubscriber(fastify, log, userId, now), quotaSettings());
}
