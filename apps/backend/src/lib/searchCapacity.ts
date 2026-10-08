// Plafond GLOBAL des recherches SerpApi et PART DE CHAQUE PERSONNE (lot 4
// quater, décisions du fondateur, 2026-10-08) : par jour (heure de Paris) et
// par cycle mensuel aligné sur le renouvellement du quota chez SerpApi (il se
// libère quand ce quota revient) pour tout le service, par jour pour chaque
// personne, EN PLUS des limites par personne existantes (lib/rateLimits.ts). Tout est
// compté dans la base (fonction serpapi_quota, migration 0022) : en mémoire,
// les compteurs repartiraient de zéro à chaque redémarrage du serveur (mise
// en veille de l'offre gratuite de Render, déploiements).
// Plafond atteint : aucun appel SerpApi, aucun crédit, un message honnête.
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { SEARCH_CAPACITY_ERRORS, type ApiErrorBody, type SearchCapacityLimit } from "@monapp/shared-types";
import { env } from "../env.js";

export const SEARCH_CAPACITY_MESSAGES = {
  day: "Le service de recherche est très sollicité aujourd'hui. Réessayez demain.",
  month: "Le service de recherche a atteint sa limite mensuelle. Réessayez dans quelques jours.",
  user: "Vous avez atteint votre limite de recherches pour aujourd'hui. Réessayez demain.",
} as const satisfies Record<SearchCapacityLimit, string>;

const COUNTS = {
  day_count: z.number().int().nonnegative(),
  month_count: z.number().int().nonnegative(),
  user_day_count: z.number().int().nonnegative(),
};
/** Réponse de serpapi_quota, lue sans lui faire confiance (une seule ligne). */
export const QUOTA_ROWS = z
  .array(
    z.union([
      z.object({ allowed: z.literal(true), refused_by: z.null(), ...COUNTS }),
      z.object({ allowed: z.literal(false), refused_by: z.enum(["day", "month", "user"]), ...COUNTS }),
    ])
  )
  .length(1);
type QuotaRow = z.infer<typeof QUOTA_ROWS>[number];

export type SearchCapacity = { allowed: true } | { allowed: false; limit: SearchCapacityLimit };

/** Plafond illisible (base injoignable…) : la recherche échoue proprement, sans appel. */
export class SearchCapacityError extends Error {}

export interface SearchCaps {
  daily: number;
  /** Par cycle mensuel de SerpApi, depuis le dernier jour de renouvellement. */
  monthly: number;
  userDaily: number;
  /** Jour du mois où SerpApi renouvelle le quota (le dernier jour du mois s'il est plus court). */
  renewalDay: number;
}

export function searchCaps(): SearchCaps {
  return {
    daily: env.SERPAPI_DAILY_CAP,
    monthly: env.SERPAPI_MONTHLY_CAP,
    userDaily: env.SERPAPI_USER_DAILY_CAP,
    renewalDay: env.SERPAPI_RENEWAL_DAY,
  };
}

export const CAPACITY_LOG_MESSAGE = "Plafond SerpApi";

/** Champs de la ligne de journal « Plafond SerpApi », lue par compteurs-ia :
 * des nombres et des états, jamais de compte, d'adresse ni de contenu. */
export function capacityLogFields(step: "search" | "video_ai", row: QuotaRow, caps: SearchCaps) {
  return {
    step,
    outcome: row.allowed ? ("reserved" as const) : ("refused" as const),
    limit: row.refused_by,
    day: row.day_count,
    month: row.month_count,
    user: row.user_day_count,
    dayCap: caps.daily,
    monthCap: caps.monthly,
    userCap: caps.userDaily,
    renewalDay: caps.renewalDay,
  };
}

interface QuotaRequest {
  /** « search » : réserve un appel, juste avant de l'envoyer. « video_ai » :
   * simple lecture, avant d'envoyer des images à l'IA — inutile (et payante)
   * si aucune recherche ne peut suivre. */
  step: "search" | "video_ai";
  userId: string;
  /** Recherche en cours de lancement (déjà « en cours ») : hors du compte de la personne. */
  searchId?: string;
}

async function readQuota(fastify: FastifyInstance, log: FastifyBaseLogger, request: QuotaRequest): Promise<SearchCapacity> {
  const caps = searchCaps();
  const reserve = request.step === "search";
  const { data, error } = await fastify.supabaseAdmin.rpc("serpapi_quota", {
    p_daily_cap: caps.daily,
    p_monthly_cap: caps.monthly,
    p_user_daily_cap: caps.userDaily,
    p_renewal_day: caps.renewalDay,
    p_user_id: request.userId,
    p_reserve: reserve,
    p_exclude_search: request.searchId ?? null,
  });
  const rows = QUOTA_ROWS.safeParse(data);
  if (error || !rows.success) {
    log.error({ error }, "Plafond SerpApi illisible");
    throw new SearchCapacityError("Plafond SerpApi illisible");
  }
  const row = rows.data[0]!;
  if (reserve || !row.allowed) log.info(capacityLogFields(request.step, row, caps), CAPACITY_LOG_MESSAGE);
  return row.allowed ? { allowed: true } : { allowed: false, limit: row.refused_by };
}

/** Juste avant un appel SerpApi : un appel réservé, ou le refus (plafond atteint). */
export function reserveSearch(fastify: FastifyInstance, log: FastifyBaseLogger, userId: string, searchId: string): Promise<SearchCapacity> {
  return readQuota(fastify, log, { step: "search", userId, searchId });
}

/** Avant l'analyse automatique d'une vidéo : lecture seule, rien n'est réservé. */
export function searchCapacityForVideoAi(fastify: FastifyInstance, log: FastifyBaseLogger, userId: string): Promise<SearchCapacity> {
  return readQuota(fastify, log, { step: "video_ai", userId });
}

/** Réponse 429 « plafond atteint » : le plafond en cause et son message, sans date. */
export function sendCapacityReached(reply: FastifyReply, limit: SearchCapacityLimit): FastifyReply {
  const body: ApiErrorBody = { error: SEARCH_CAPACITY_ERRORS[limit], message: SEARCH_CAPACITY_MESSAGES[limit] };
  return reply.code(429).send(body);
}
