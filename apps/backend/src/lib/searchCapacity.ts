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
// Voie C (lot c, 2026-11-02) : chaque appel réel réserve sa place, Lens
// (étape « search ») comme Google Shopping (étape « shopping ») ; les
// plafonds du jour et du mois comptent des APPELS, la part de chaque personne
// compte des PHOTOS (lignes de recherche, hors recherches servies par le
// cache, migration 0028). Avant l'IA de la voie C, une simple lecture
// (étape « complement_ai »), jamais un 429.
// Quotas par membre (lot quotas, migration 0053, lib/memberQuotas.ts) : avec
// 0053, serpapi_quota_v2 ajoute la part du MOIS civil de la personne (100
// pour un compte gratuit) et la réserve des abonnés (un compte gratuit
// s'arrête à 70 % des plafonds globaux quand les abonnements sont allumés).
// Sans 0053, serpapi_quota, exactement comme avant.
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { SEARCH_CAPACITY_ERRORS, SEARCH_MONTHLY_QUOTA_ERROR, type SearchCapacityErrorBody, type SearchCapacityLimit } from "@monapp/shared-types";
import { env } from "../env.js";
import { raiseAlert } from "./alerts.js";
import { parisDayStart } from "./matchFeedback.js";
import { reducedCap, searchTierFor, type SearchTier } from "./memberQuotas.js";

/** Motifs d'un refus : ceux que toutes les apps connaissent, plus la part du
 * mois de la personne (« user_month », 0053). */
export type CapacityLimit = SearchCapacityLimit | "user_month";

export const SEARCH_CAPACITY_MESSAGES = {
  day: "Le service de recherche est très sollicité aujourd'hui. Réessayez demain.",
  // La date (« Réessayez à partir du 3 novembre. ») est ajoutée par l'app, dans
  // sa langue, à partir de resumesOn (décision du fondateur, 2026-10-11).
  month: "Le service de recherche a atteint sa limite mensuelle.",
  user: "Vous avez atteint votre limite de recherches pour aujourd'hui. Réessayez demain.",
  // Lot quotas : la date du retour (« Elles reviennent le 1er décembre. ») est
  // ajoutée par l'app, dans sa langue, à partir de resumesOn.
  user_month: "Vous avez utilisé toutes vos recherches de ce mois-ci.",
} as const satisfies Record<CapacityLimit, string>;

/** Code de chaque refus (champ « error »). */
const CAPACITY_ERROR_CODES: Record<CapacityLimit, string> = { ...SEARCH_CAPACITY_ERRORS, user_month: SEARCH_MONTHLY_QUOTA_ERROR };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COUNTS = {
  day_count: z.number().int().nonnegative(),
  month_count: z.number().int().nonnegative(),
  user_day_count: z.number().int().nonnegative(),
  next_renewal: z.string().regex(DAY),
  // serpapi_quota_v2 (0053) seulement : la part du mois prise, et le 1er du mois suivant.
  user_month_count: z.number().int().nonnegative().optional(),
  month_resets_on: z.string().regex(DAY).optional(),
};
/** Réponse de serpapi_quota (ou de serpapi_quota_v2), lue sans lui faire
 * confiance (une seule ligne). reservation_id : numéro de la place réservée
 * (0027), vide sans réservation. */
export const QUOTA_ROWS = z
  .array(
    z.union([
      z.object({ allowed: z.literal(true), refused_by: z.null(), reservation_id: z.number().int().positive().nullable(), ...COUNTS }),
      z.object({ allowed: z.literal(false), refused_by: z.enum(["day", "month", "user", "user_month"]), reservation_id: z.null(), ...COUNTS }),
    ])
  )
  .length(1);
export type QuotaRow = z.infer<typeof QUOTA_ROWS>[number];

/** Un plafond atteint : son motif et, pour le mois (du service ou de la
 * personne), le jour de la reprise (« AAAA-MM-JJ »). */
export interface CapacityRefusal {
  limit: CapacityLimit;
  resumesOn: string | null;
}
type CapacityReached = { allowed: false } & CapacityRefusal;
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

/** Étape qui consulte le plafond. « search » (Lens) et « shopping » (Google
 * Shopping, voie C) réservent une place juste avant l'appel ; « video_ai » et
 * « complement_ai » lisent seulement, avant une dépense d'IA inutile si
 * aucune recherche ne peut suivre. */
export type CapacityStep = "search" | "video_ai" | "complement_ai" | "shopping";
/** Étapes qui réservent une place (un appel réel au fournisseur). */
export type ReservingStep = Extract<CapacityStep, "search" | "shopping">;

/** Champs de la ligne de journal « Plafond recherches », lue par compteurs-ia :
 * des nombres et des états, jamais de compte, d'adresse ni de contenu. Avec
 * 0053 (`tier`), aussi la part du mois déjà prise ; jamais sa limite ni la
 * réserve appliquée, qui diraient si la personne est abonnée. */
export function capacityLogFields(step: CapacityStep, row: QuotaRow, caps: SearchCaps, tier: SearchTier | null = null) {
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
    ...(tier ? { userMonth: row.user_month_count ?? 0 } : {}),
  };
}

interface QuotaRequest {
  /** « search » et « shopping » : réserve un appel, juste avant de l'envoyer.
   * « video_ai » et « complement_ai » : simple lecture, avant d'envoyer des
   * images ou des titres à l'IA — inutile (et payante) si aucune recherche ne
   * peut suivre. */
  step: CapacityStep;
  userId: string;
  /** Recherche en cours de lancement (déjà « en cours ») : hors du compte de la personne. */
  searchId?: string;
}

/** Une lecture du plafond : la ligne de la base, et la formule de la
 * personne (null : base sans 0053, serpapi_quota comme avant). */
interface QuotaRead {
  row: QuotaRow;
  tier: SearchTier | null;
}

/** Un appel à serpapi_quota_v2 (avec 0053) ou à serpapi_quota (sans), sa
 * réponse lue sans lui faire confiance. */
async function callQuota(fastify: FastifyInstance, log: FastifyBaseLogger, caps: SearchCaps, userId: string, reserve: boolean, searchId?: string): Promise<QuotaRead> {
  const tier = await searchTierFor(fastify, log, userId);
  const params = {
    p_daily_cap: caps.daily,
    p_monthly_cap: caps.monthly,
    p_user_daily_cap: caps.userDaily,
    p_renewal_day: caps.renewalDay,
    p_user_id: userId,
    p_reserve: reserve,
    p_exclude_search: searchId ?? null,
  };
  const { data, error } = tier
    ? await fastify.supabaseAdmin.rpc("serpapi_quota_v2", { ...params, p_user_monthly_cap: tier.monthlyCap, p_reserve_percent: tier.reservePercent })
    : await fastify.supabaseAdmin.rpc("serpapi_quota", params);
  const rows = QUOTA_ROWS.safeParse(data);
  // La part du mois n'existe qu'avec serpapi_quota_v2 : un refus « user_month » de l'autre fonction est illisible.
  if (error || !rows.success || (!tier && rows.data[0]!.refused_by === "user_month")) {
    log.error({ error }, "Plafond des recherches illisible");
    throw new SearchCapacityError("Plafond des recherches illisible");
  }
  return { row: rows.data[0]!, tier };
}

async function readQuota(fastify: FastifyInstance, log: FastifyBaseLogger, request: QuotaRequest): Promise<QuotaRow> {
  const caps = searchCaps();
  const reserve = request.step === "search" || request.step === "shopping";
  const { row, tier } = await callQuota(fastify, log, caps, request.userId, reserve, request.searchId);
  if (reserve || !row.allowed) log.info(capacityLogFields(request.step, row, caps, tier), CAPACITY_LOG_MESSAGE);
  alertIfServiceClosed(log, row, caps, new Date(), tier);
  return row;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Plafond du jour ou du mois atteint : Spotter est fermé à tout le monde.
 * Une alerte (lib/alerts.ts) par jour, ou par cycle mensuel. La part d'une
 * personne (du jour ou du mois) n'en est pas une : c'est le fonctionnement
 * normal. Quotas par membre (`tier`, 0053) : un compte gratuit arrêté par la
 * réserve des abonnés (70 % atteints, le plafond total pas encore) donne sa
 * propre alerte (« reserve_day », « reserve_month »), une par jour ou par
 * cycle ; le plafond total, une autre. */
export function alertIfServiceClosed(log: Pick<FastifyBaseLogger, "warn">, row: QuotaRow, caps: SearchCaps, now = new Date(), tier: SearchTier | null = null): void {
  if (row.allowed || row.refused_by === "user" || row.refused_by === "user_month") return;
  const day = row.refused_by === "day";
  const reserve = tier?.reservePercent ?? 0;
  const reserveOnly = reserve > 0 && (day ? row.day_count < caps.daily : row.month_count < caps.monthly);
  const dayKey = parisDayStart(now).toISOString();
  if (reserveOnly) {
    const share = 100 - reserve;
    raiseAlert(log, {
      kind: "plafond_recherches",
      message: day
        ? `Comptes gratuits arrêtés : ${share} % du plafond du jour des recherches atteints (${reducedCap(caps.daily, reserve)} sur ${caps.daily}) ; seuls les abonnés cherchent encore jusqu'à minuit`
        : `Comptes gratuits arrêtés : ${share} % du plafond du mois des recherches atteints (${reducedCap(caps.monthly, reserve)} sur ${caps.monthly}) ; seuls les abonnés cherchent encore jusqu'au ${row.next_renewal}`,
      tags: { plafond: day ? "reserve_day" : "reserve_month" },
      onceKey: day ? `plafond_recherches:reserve_day:${dayKey}` : `plafond_recherches:reserve_month:${row.next_renewal}`,
      onceMs: day ? DAY_MS : 32 * DAY_MS,
    });
    return;
  }
  raiseAlert(log, {
    kind: "plafond_recherches",
    message: day
      ? `Plafond du jour des recherches atteint (${caps.daily}) : Spotter est fermé à tous jusqu'à minuit`
      : `Plafond du mois des recherches atteint (${caps.monthly}) : Spotter est fermé à tous jusqu'au ${row.next_renewal}`,
    tags: { plafond: row.refused_by },
    // Une alerte par jour de Paris pour le plafond du jour ; une par cycle pour le mois.
    onceKey: day ? `plafond_recherches:day:${dayKey}` : `plafond_recherches:month:${row.next_renewal}`,
    onceMs: day ? DAY_MS : 32 * DAY_MS,
  });
}

/** Compteur lu pour l'app (lot limites annoncées, GET /api/searches/capacity) :
 * rien n'est réservé, et aucune ligne « Plafond recherches » n'est écrite —
 * une visite de l'accueil n'est pas un refus : compteurs-ia ne doit pas la
 * compter. `tier` : la formule de la personne (null sans 0053). */
export async function readSearchCounts(fastify: FastifyInstance, log: FastifyBaseLogger, userId: string): Promise<{ row: QuotaRow; caps: SearchCaps; tier: SearchTier | null }> {
  const caps = searchCaps();
  return { ...(await callQuota(fastify, log, caps, userId, false)), caps };
}

function reachedBy(row: QuotaRow & { allowed: false }): CapacityReached {
  const resumesOn = row.refused_by === "month" ? row.next_renewal : row.refused_by === "user_month" ? (row.month_resets_on ?? null) : null;
  return { allowed: false, limit: row.refused_by, resumesOn };
}

/** Juste avant un appel au fournisseur : une place réservée (avec son numéro), ou le refus (plafond atteint).
 * `step` : « search » pour Lens (par défaut), « shopping » pour Google Shopping
 * (voie C) — la recherche en cours reste hors de la part de la personne : la
 * voie B n'est pas une nouvelle photo. */
export async function reserveSearch(
  fastify: FastifyInstance,
  log: FastifyBaseLogger,
  userId: string,
  searchId: string,
  step: ReservingStep = "search"
): Promise<SearchReservation> {
  const row = await readQuota(fastify, log, { step, userId, searchId });
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

/** Avant l'IA de la voie C : lecture seule, rien n'est réservé ; la recherche
 * en cours est hors de la part de la personne. Refusé : l'IA est sautée
 * (issue no_capacity), jamais de 429 : les résultats Lens sont montrés seuls. */
export async function searchCapacityBeforeComplementAi(fastify: FastifyInstance, log: FastifyBaseLogger, userId: string, searchId: string): Promise<SearchCapacity> {
  const row = await readQuota(fastify, log, { step: "complement_ai", userId, searchId });
  return row.allowed ? { allowed: true } : reachedBy(row);
}

/** Ligne « Place rendue » (0027), lue par compteurs-ia : le fournisseur et
 * l'issue du retour, jamais de compte ni de numéro de place. */
export const RELEASE_LOG_MESSAGE = "Place rendue";

/** Refus annoncé par le fournisseur (non facturé) : rend la place réservée
 * pour cette recherche, dans le plafond du jour et dans celui du mois. false :
 * non rendue (base injoignable, place inconnue ou déjà rendue) ; elle reste
 * alors comptée, par prudence. `step` : l'étape qui avait réservé (« search »
 * pour Lens, par défaut ; « shopping » pour Google Shopping). */
export async function releaseReservation(
  fastify: FastifyInstance,
  log: FastifyBaseLogger,
  reservationId: number,
  step: ReservingStep = "search"
): Promise<boolean> {
  const { data, error } = await fastify.supabaseAdmin.rpc("serpapi_release", { p_id: reservationId });
  const released = z.boolean().safeParse(data);
  const ok = !error && released.success && released.data;
  if (error || !released.success) log.error({ error }, "Place non rendue : retour illisible");
  fastify.log.info({ provider: CAPS_PROVIDER, step, released: ok }, RELEASE_LOG_MESSAGE);
  return ok;
}

/** Réponse 429 « plafond atteint » : le plafond en cause, son message, et pour
 * le mois le jour du prochain renouvellement (l'app en fait « Réessayez à
 * partir du … ») ; pour la part du mois de la personne, le 1er du mois suivant. */
export function sendCapacityReached(reply: FastifyReply, capacity: CapacityRefusal): FastifyReply {
  const body: SearchCapacityErrorBody = { error: CAPACITY_ERROR_CODES[capacity.limit], message: SEARCH_CAPACITY_MESSAGES[capacity.limit] };
  if (capacity.resumesOn) body.resumesOn = capacity.resumesOn;
  return reply.code(429).send(body);
}
