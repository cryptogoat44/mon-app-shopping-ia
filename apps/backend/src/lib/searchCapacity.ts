// Plafond GLOBAL des recherches SerpApi et PART DE CHAQUE PERSONNE (lot 4
// quater, décisions du fondateur, 2026-10-08) : par jour (heure de Paris) et
// par cycle mensuel aligné sur le renouvellement du quota chez SerpApi (il se
// libère quand ce quota revient) pour tout le service, par jour pour chaque
// personne, EN PLUS des limites par personne existantes (lib/rateLimits.ts). Tout est
// compté dans la base (fonction serpapi_quota, migration 0022) : en mémoire,
// les compteurs repartiraient de zéro à chaque redémarrage du serveur (mise
// en veille de l'offre gratuite de Render, déploiements).
// Plafond atteint : aucun appel SerpApi, aucun crédit, un message honnête.
// Depuis 0027 : la place d'un refus annoncé par le fournisseur (non facturé)
// est rendue (serpapi_release). La table, les fonctions et les variables
// gardent le nom de SerpApi : leurs valeurs ne valent que pour son offre.
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { SEARCH_CAPACITY_ERRORS, type SearchCapacityErrorBody, type SearchCapacityLimit, type SearchCapacityReached } from "@monapp/shared-types";
import { env } from "../env.js";

export const SEARCH_CAPACITY_MESSAGES = {
  day: "Le service de recherche est très sollicité aujourd'hui. Réessayez demain.",
  // La date (« Réessayez à partir du 3 novembre. ») est ajoutée par l'app, dans
  // sa langue, à partir de resumesOn (décision du fondateur, 2026-10-11).
  month: "Le service de recherche a atteint sa limite mensuelle.",
  user: "Vous avez atteint votre limite de recherches pour aujourd'hui. Réessayez demain.",
} as const satisfies Record<SearchCapacityLimit, string>;

const COUNTS = {
  day_count: z.number().int().nonnegative(),
  month_count: z.number().int().nonnegative(),
  user_day_count: z.number().int().nonnegative(),
  next_renewal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};
/** Réponse de serpapi_quota, lue sans lui faire confiance (une seule ligne).
 * reservation_id : numéro de la place réservée (0027), vide sans réservation. */
export const QUOTA_ROWS = z
  .array(
    z.union([
      z.object({ allowed: z.literal(true), refused_by: z.null(), reservation_id: z.number().int().positive().nullable(), ...COUNTS }),
      z.object({ allowed: z.literal(false), refused_by: z.enum(["day", "month", "user"]), reservation_id: z.null(), ...COUNTS }),
    ])
  )
  .length(1);
type QuotaRow = z.infer<typeof QUOTA_ROWS>[number];

type CapacityReached = { allowed: false } & SearchCapacityReached;
export type SearchCapacity = { allowed: true } | CapacityReached;
/** Place réservée juste avant un appel : son numéro sert à la rendre si le fournisseur refuse. */
export type SearchReservation = { allowed: true; reservationId: number } | CapacityReached;

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

/** Fournisseur dont l'offre fixe les plafonds (variables SERPAPI_*). */
const CAPS_PROVIDER = "serpapi";

/** « Plafond recherches » depuis 0027 (« Plafond SerpApi » avant) : compteurs-ia lit les deux. */
export const CAPACITY_LOG_MESSAGE = "Plafond recherches";

/** Champs de la ligne de journal « Plafond recherches », lue par compteurs-ia :
 * des nombres et des états, jamais de compte, d'adresse ni de contenu. */
export function capacityLogFields(step: "search" | "video_ai", row: QuotaRow, caps: SearchCaps) {
  return {
    provider: CAPS_PROVIDER,
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

async function readQuota(fastify: FastifyInstance, log: FastifyBaseLogger, request: QuotaRequest): Promise<QuotaRow> {
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
    log.error({ error }, "Plafond des recherches illisible");
    throw new SearchCapacityError("Plafond des recherches illisible");
  }
  const row = rows.data[0]!;
  if (reserve || !row.allowed) log.info(capacityLogFields(request.step, row, caps), CAPACITY_LOG_MESSAGE);
  return row;
}

function reachedBy(row: QuotaRow & { allowed: false }): CapacityReached {
  return { allowed: false, limit: row.refused_by, resumesOn: row.refused_by === "month" ? row.next_renewal : null };
}

/** Juste avant un appel au fournisseur : une place réservée (avec son numéro), ou le refus (plafond atteint). */
export async function reserveSearch(fastify: FastifyInstance, log: FastifyBaseLogger, userId: string, searchId: string): Promise<SearchReservation> {
  const row = await readQuota(fastify, log, { step: "search", userId, searchId });
  if (!row.allowed) return reachedBy(row);
  if (row.reservation_id === null) {
    log.error("Place réservée sans numéro");
    throw new SearchCapacityError("Place réservée sans numéro");
  }
  return { allowed: true, reservationId: row.reservation_id };
}

/** Avant l'analyse automatique d'une vidéo : lecture seule, rien n'est réservé. */
export async function searchCapacityForVideoAi(fastify: FastifyInstance, log: FastifyBaseLogger, userId: string): Promise<SearchCapacity> {
  const row = await readQuota(fastify, log, { step: "video_ai", userId });
  return row.allowed ? { allowed: true } : reachedBy(row);
}

/** Ligne « Place rendue » (0027), lue par compteurs-ia : le fournisseur et
 * l'issue du retour, jamais de compte ni de numéro de place. */
export const RELEASE_LOG_MESSAGE = "Place rendue";

/** Refus annoncé par le fournisseur (non facturé) : rend la place réservée
 * pour cette recherche, dans le plafond du jour et dans celui du mois. false :
 * non rendue (base injoignable, place inconnue ou déjà rendue) ; elle reste
 * alors comptée, par prudence. */
export async function releaseReservation(fastify: FastifyInstance, log: FastifyBaseLogger, reservationId: number): Promise<boolean> {
  const { data, error } = await fastify.supabaseAdmin.rpc("serpapi_release", { p_id: reservationId });
  const released = z.boolean().safeParse(data);
  const ok = !error && released.success && released.data;
  if (error || !released.success) log.error({ error }, "Place non rendue : retour illisible");
  fastify.log.info({ provider: CAPS_PROVIDER, step: "search", released: ok }, RELEASE_LOG_MESSAGE);
  return ok;
}

/** Réponse 429 « plafond atteint » : le plafond en cause, son message, et pour
 * le mois le jour du prochain renouvellement (l'app en fait « Réessayez à partir du … »). */
export function sendCapacityReached(reply: FastifyReply, capacity: SearchCapacityReached): FastifyReply {
  const body: SearchCapacityErrorBody = { error: SEARCH_CAPACITY_ERRORS[capacity.limit], message: SEARCH_CAPACITY_MESSAGES[capacity.limit] };
  if (capacity.resumesOn) body.resumesOn = capacity.resumesOn;
  return reply.code(429).send(body);
}
