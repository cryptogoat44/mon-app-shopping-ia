// Compteurs de l'IA d'Anthropic dans la base (lot garde-fous, point 9 de la
// feuille de route V1 ; migration 0029, fonction ai_quota). Avant, ils
// étaient en mémoire et repartaient de zéro à chaque redémarrage du serveur
// (veille de l'offre gratuite de Render, mise en ligne, plantage) : après
// chaque réveil, quelqu'un pouvait refaire les 300 analyses du jour.
// - video : analyse automatique d'une vidéo, 10 par personne et 300 en tout
//   par jour (heure de Paris) ;
// - shopping_query : requête des boutiques écrite par l'IA (voie C), 300 en
//   tout par jour, sans compte.
// Les plafonds restent dans lib/rateLimits.ts (videoAiUser, videoAiGlobal,
// shoppingQueryAiGlobal) : une seule liste à relire.
// Sans la migration 0029 (fonction absente) : les compteurs en mémoire
// d'avant, tels quels, et une ligne de journal ; la fonction est recherchée
// de nouveau au bout de 5 minutes. Base injoignable : aucun appel payant
// (l'appelant refuse ou saute l'IA). Plafond du jour atteint : une alerte
// (lib/alerts.ts), une fois par jour.
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { RATE_LIMITS, type RateLimitName } from "./rateLimits.js";
import { limitReached, registerHit } from "../plugins/rateLimit.js";
import { raiseAlert } from "./alerts.js";
import { parisDayStart } from "./matchFeedback.js";

export type AiKind = "video" | "shopping_query";

/** refusedBy : la part de la personne (« user ») ou tout le service (« global »). */
export type AiQuotaDecision = { allowed: true } | { allowed: false; refusedBy: "user" | "global" };

/** Compteur illisible (base injoignable…) : aucun appel payant. */
export class AiQuotaError extends Error {}

interface AiRule {
  /** Part de chaque personne par jour ; null : aucune (IA de la voie C). */
  userLimit: RateLimitName | null;
  globalLimit: RateLimitName;
  /** Nom lisible, pour l'alerte du plafond. */
  label: string;
}

export const AI_RULES: Record<AiKind, AiRule> = {
  video: { userLimit: "videoAiUser", globalLimit: "videoAiGlobal", label: "analyse automatique des vidéos" },
  shopping_query: { userLimit: null, globalLimit: "shoppingQueryAiGlobal", label: "requête des boutiques par l'IA (voie C)" },
};

const QUOTA_ROWS = z
  .array(
    z.object({
      allowed: z.boolean(),
      refused_by: z.enum(["user", "global"]).nullable(),
      day_count: z.number().int().nonnegative(),
      user_day_count: z.number().int().nonnegative(),
    })
  )
  .length(1);

/** Fonction absente (0029 pas encore appliquée) : code de Postgres, puis de PostgREST. */
const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202"]);
/** Fonction recherchée de nouveau au bout de 5 minutes tant qu'elle manque. */
const MISSING_RETRY_MS = 5 * 60_000;

export interface AiQuotaRpc {
  rpc(
    name: "ai_quota",
    params: { p_kind: AiKind; p_user_id: string | null; p_user_daily_cap: number | null; p_daily_cap: number; p_reserve: boolean }
  ): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
}

export interface AiQuotaRequest {
  kind: AiKind;
  /** Compte de la personne (analyse vidéo) ; null pour l'IA de la voie C. */
  userId: string | null;
  /** true : juste avant l'appel, réserve une place ; false : simple lecture. */
  reserve: boolean;
}

type AiQuotaLog = Pick<FastifyBaseLogger, "info" | "warn" | "error">;

let missingSince: number | null = null;

/** Compteurs en mémoire d'avant 0029 (mêmes clés que plugins/rateLimit.ts). */
function memoryDecision(rule: AiRule, request: AiQuotaRequest): AiQuotaDecision {
  const keys: { name: RateLimitName; key: string; refusedBy: "user" | "global" }[] = [];
  if (rule.userLimit && request.userId) keys.push({ name: rule.userLimit, key: `${rule.userLimit}:${request.userId}`, refusedBy: "user" });
  keys.push({ name: rule.globalLimit, key: `${rule.globalLimit}:global`, refusedBy: "global" });
  for (const entry of keys) {
    if (limitReached(entry.key, RATE_LIMITS[entry.name]).reached) return { allowed: false, refusedBy: entry.refusedBy };
  }
  if (request.reserve) for (const entry of keys) registerHit(entry.key, RATE_LIMITS[entry.name]);
  return { allowed: true };
}

function alertIfGlobal(log: AiQuotaLog, rule: AiRule, kind: AiKind, decision: AiQuotaDecision, now: Date): void {
  if (decision.allowed || decision.refusedBy !== "global") return;
  raiseAlert(log, {
    kind: "plafond_ia",
    message: `Plafond du jour de l'IA atteint : ${rule.label} (${RATE_LIMITS[rule.globalLimit].max} par jour)`,
    tags: { ia: kind },
    onceKey: `plafond_ia:${kind}:${parisDayStart(now).toISOString()}`,
  });
}

/** Le plafond de l'IA pour `request` : permis (et réservé si demandé) ou refusé.
 * Lève AiQuotaError si le compteur est illisible. Sous Vitest (NODE_ENV
 * « test »), toujours permis, comme les autres limites (plugins/rateLimit.ts). */
export async function aiQuota(db: AiQuotaRpc, log: AiQuotaLog, request: AiQuotaRequest, now: () => number = Date.now): Promise<AiQuotaDecision> {
  if (process.env.NODE_ENV === "test") return { allowed: true };
  const rule = AI_RULES[request.kind];
  let decision: AiQuotaDecision;
  if (missingSince !== null && now() - missingSince < MISSING_RETRY_MS) {
    decision = memoryDecision(rule, request);
  } else {
    const userCap = rule.userLimit ? RATE_LIMITS[rule.userLimit].max : null;
    if (userCap !== null && !request.userId) throw new AiQuotaError("Compte manquant pour le plafond de l'IA");
    const { data, error } = await db.rpc("ai_quota", {
      p_kind: request.kind,
      p_user_id: userCap === null ? null : request.userId,
      p_user_daily_cap: userCap,
      p_daily_cap: RATE_LIMITS[rule.globalLimit].max,
      p_reserve: request.reserve,
    });
    if (error && error.code && MISSING_FUNCTION_CODES.has(error.code)) {
      if (missingSince === null) log.warn({ code: error.code }, "Compteurs IA en mémoire : migration 0029 absente");
      missingSince = now();
      decision = memoryDecision(rule, request);
    } else {
      const rows = QUOTA_ROWS.safeParse(data);
      if (error || !rows.success) {
        log.error({ code: error?.code ?? null }, "Compteur de l'IA illisible");
        throw new AiQuotaError("Compteur de l'IA illisible");
      }
      missingSince = null;
      const row = rows.data[0]!;
      decision = row.allowed ? { allowed: true } : { allowed: false, refusedBy: row.refused_by ?? "global" };
      if (!row.allowed) log.info({ kind: request.kind, limit: decision.allowed ? null : decision.refusedBy, day: row.day_count }, "Plafond IA atteint");
    }
  }
  alertIfGlobal(log, rule, request.kind, decision, new Date(now()));
  return decision;
}

/** Raccourci pour une route : la base du serveur. */
export function aiQuotaFor(fastify: Pick<FastifyInstance, "supabaseAdmin">, log: AiQuotaLog, request: AiQuotaRequest): Promise<AiQuotaDecision> {
  return aiQuota(fastify.supabaseAdmin as unknown as AiQuotaRpc, log, request);
}

/** Tests seulement : oublie que la fonction manquait. */
export function resetAiQuotaForTests(): void {
  missingSince = null;
}
