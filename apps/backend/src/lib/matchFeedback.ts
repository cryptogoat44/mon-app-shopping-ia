// Bouton « Résultat incohérent » (fiabilité des résultats, décisions du
// fondateur du 2026-10-15) : un signalement par proposition et par personne,
// un motif parmi cinq, 30 par jour au plus (jour de Paris), comptés dans la
// base (le serveur gratuit redémarre souvent : jamais en mémoire).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MATCH_FEEDBACK_DAILY_LIMIT, MATCH_FEEDBACK_REASONS, type MatchFeedbackReason } from "@monapp/shared-types";

const FEEDBACK_ROWS = z.array(z.object({ match_id: z.string(), reason: z.enum(MATCH_FEEDBACK_REASONS) }));

/** Motifs déjà choisis par la personne, par proposition. Lecture impossible :
 * journalisée, et l'app montre les propositions comme non signalées. */
export async function fetchFeedbackReasons(fastify: FastifyInstance, userId: string, matchIds: string[]): Promise<Map<string, MatchFeedbackReason>> {
  if (matchIds.length === 0) return new Map();
  const { data, error } = await fastify.supabaseAdmin.from("match_feedback").select("match_id, reason").eq("user_id", userId).in("match_id", matchIds);
  const rows = FEEDBACK_ROWS.safeParse(data);
  if (error || !rows.success) {
    fastify.log.error({ error }, "Échec de lecture des signalements de résultats");
    return new Map();
  }
  return new Map(rows.data.map((row) => [row.match_id, row.reason]));
}

const PARIS_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const PARIS_HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" });

/** Minuit du jour en cours à Paris, en heure universelle. À minuit UTC, Paris
 * a une ou deux heures d'avance (heure d'hiver ou d'été) : minuit à Paris
 * tombe donc ce nombre d'heures plus tôt. */
export function parisDayStart(now: Date = new Date()): Date {
  const midnightUtc = new Date(`${PARIS_DAY.format(now)}T00:00:00Z`);
  const parisHourAtMidnightUtc = Number(PARIS_HOUR.format(midnightUtc));
  return new Date(midnightUtc.getTime() - parisHourAtMidnightUtc * 3_600_000);
}

/** Signalements faits aujourd'hui (jour de Paris) ; null : lecture impossible. */
export async function countTodaysFeedback(fastify: FastifyInstance, userId: string): Promise<number | null> {
  const { count, error } = await fastify.supabaseAdmin
    .from("match_feedback")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", parisDayStart().toISOString());
  if (error || count === null) {
    fastify.log.error({ error }, "Échec du compte des signalements du jour");
    return null;
  }
  return count;
}

export function dailyLimitReached(count: number): boolean {
  return count >= MATCH_FEEDBACK_DAILY_LIMIT;
}
