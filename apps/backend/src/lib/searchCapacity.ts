// Plafond GLOBAL des recherches SerpApi (lot 4 quater, décision du fondateur,
// 2026-10-08) : par jour (heure de Paris) et sur 31 jours glissants, EN PLUS
// des limites par personne (lib/rateLimits.ts). Le compteur est dans la base
// (table serpapi_calls, fonction serpapi_quota, migration 0022) : en mémoire,
// il repartirait de zéro à chaque redémarrage du serveur (mise en veille de
// l'offre gratuite de Render, déploiements) et ne plafonnerait rien.
// Plafond atteint : aucun appel SerpApi, aucun crédit, un message honnête.
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { SEARCH_CAPACITY_ERRORS, type SearchCapacityErrorBody, type SearchCapacityReached } from "@monapp/shared-types";
import { env } from "../env.js";

export const SEARCH_CAPACITY_MESSAGES = {
  day: "Le service de recherche est très sollicité aujourd'hui. Réessayez demain.",
  month: "Le service de recherche a atteint sa limite mensuelle. Réessayez plus tard.",
} as const;

const COUNTS = { day_count: z.number().int().nonnegative(), window_count: z.number().int().nonnegative() };
/** Réponse de serpapi_quota, lue sans lui faire confiance (une seule ligne). */
export const QUOTA_ROWS = z
  .array(
    z.union([
      z.object({ allowed: z.literal(true), cap_period: z.null(), retry_at: z.null(), ...COUNTS }),
      z.object({ allowed: z.literal(false), cap_period: z.enum(["day", "month"]), retry_at: z.string().datetime({ offset: true }).nullable(), ...COUNTS }),
    ])
  )
  .length(1);

export type SearchCapacity = { allowed: true } | ({ allowed: false } & SearchCapacityReached);

/** Plafond illisible (base injoignable…) : la recherche échoue proprement, sans appel. */
export class SearchCapacityError extends Error {}

export function searchCaps(): { daily: number; monthly: number } {
  return { daily: env.SERPAPI_DAILY_CAP, monthly: env.SERPAPI_MONTHLY_CAP };
}

export const CAPACITY_LOG_MESSAGE = "Plafond SerpApi";
type QuotaRow = z.infer<typeof QUOTA_ROWS>[number];

/** Champs de la ligne de journal « Plafond SerpApi », lue par compteurs-ia :
 * des nombres et des états, jamais de compte, d'adresse ni de contenu. */
export function capacityLogFields(step: "search" | "video_ai", row: QuotaRow, caps: { daily: number; monthly: number }) {
  return {
    step,
    outcome: row.allowed ? ("reserved" as const) : ("refused" as const),
    period: row.cap_period,
    day: row.day_count,
    window: row.window_count,
    dayCap: caps.daily,
    monthCap: caps.monthly,
  };
}

/** « search » : réserve un appel, juste avant de l'envoyer. « video_ai » :
 * simple lecture, avant d'envoyer des images à l'IA — inutile (et payante)
 * si aucune recherche ne peut suivre. */
async function readQuota(fastify: FastifyInstance, log: FastifyBaseLogger, step: "search" | "video_ai"): Promise<SearchCapacity> {
  const caps = searchCaps();
  const reserve = step === "search";
  const { data, error } = await fastify.supabaseAdmin.rpc("serpapi_quota", { p_daily_cap: caps.daily, p_monthly_cap: caps.monthly, p_reserve: reserve });
  const rows = QUOTA_ROWS.safeParse(data);
  if (error || !rows.success) {
    log.error({ error }, "Plafond SerpApi illisible");
    throw new SearchCapacityError("Plafond SerpApi illisible");
  }
  const row = rows.data[0]!;
  if (reserve || !row.allowed) log.info(capacityLogFields(step, row, caps), CAPACITY_LOG_MESSAGE);
  if (row.allowed) return { allowed: true };
  return { allowed: false, period: row.cap_period, retryAt: row.retry_at ? new Date(row.retry_at).toISOString() : null };
}

/** Juste avant un appel SerpApi : un appel réservé, ou le refus (plafond atteint). */
export function reserveSearch(fastify: FastifyInstance, log: FastifyBaseLogger): Promise<SearchCapacity> {
  return readQuota(fastify, log, "search");
}

/** Avant l'analyse automatique d'une vidéo : lecture seule, rien n'est réservé. */
export function searchCapacityForVideoAi(fastify: FastifyInstance, log: FastifyBaseLogger): Promise<SearchCapacity> {
  return readQuota(fastify, log, "video_ai");
}

/** Réponse 429 « plafond atteint » ; Retry-After en secondes quand la date est connue. */
export function sendCapacityReached(reply: FastifyReply, capacity: SearchCapacityReached): FastifyReply {
  const body: SearchCapacityErrorBody = {
    error: SEARCH_CAPACITY_ERRORS[capacity.period],
    message: SEARCH_CAPACITY_MESSAGES[capacity.period],
    retryAt: capacity.retryAt,
  };
  if (capacity.retryAt) reply.header("Retry-After", String(Math.max(1, Math.ceil((Date.parse(capacity.retryAt) - Date.now()) / 1000))));
  return reply.code(429).send(body);
}
