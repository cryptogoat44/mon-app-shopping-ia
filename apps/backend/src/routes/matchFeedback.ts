import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MATCH_FEEDBACK_REASONS } from "@monapp/shared-types";
import { INVALID_ID, idParamsSchema, parseInput } from "../lib/validation.js";
import { countTodaysFeedback, dailyLimitReached } from "../lib/matchFeedback.js";

// Bouton « Résultat incohérent » (fiabilité des résultats, décisions du
// fondateur du 2026-10-15) : seuls l'identifiant de la proposition et le motif
// arrivent ici — ni texte libre, ni image. Une personne ne signale que les
// propositions de ses propres recherches.

// Strict : tout autre champ (un texte libre, par exemple) est refusé, jamais rangé.
const feedbackSchema = z.object({ reason: z.enum(MATCH_FEEDBACK_REASONS) }).strict();
const OWNED_MATCH = z.object({ id: z.string(), product_searches: z.object({ user_id: z.string() }) });
const CHANGED_ROWS = z.array(z.object({ id: z.string() }));

const MATCH_NOT_FOUND = { error: "match_not_found", message: "Proposition introuvable." } as const;
const FEEDBACK_LIMIT = {
  error: "feedback_limit",
  message: "Vous avez atteint la limite de signalements pour aujourd'hui. Merci de votre aide : vous pourrez en envoyer d'autres demain.",
} as const;
const FEEDBACK_FAILED = { error: "internal_error", message: "Le signalement n'a pas pu être enregistré. Réessayez." } as const;

/** La proposition vient-elle d'une recherche de la personne ? null : lecture impossible. */
async function ownsMatch(fastify: FastifyInstance, userId: string, matchId: string): Promise<boolean | null> {
  const { data, error } = await fastify.supabaseAdmin
    .from("product_matches")
    .select("id, product_searches!inner(user_id)")
    .eq("id", matchId)
    .maybeSingle();
  if (error) {
    fastify.log.error({ error }, "Échec de lecture d'une proposition à signaler");
    return null;
  }
  if (!data) return false;
  const row = OWNED_MATCH.safeParse(data);
  return row.success ? row.data.product_searches.user_id === userId : null;
}

/** Change le motif d'un signalement déjà fait ; null : écriture impossible. */
async function changeReason(fastify: FastifyInstance, userId: string, matchId: string, reason: string): Promise<boolean | null> {
  const { data, error } = await fastify.supabaseAdmin
    .from("match_feedback")
    .update({ reason, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("match_id", matchId)
    .select("id");
  const rows = CHANGED_ROWS.safeParse(data);
  if (error || !rows.success) {
    fastify.log.error({ error }, "Échec du changement de motif d'un signalement");
    return null;
  }
  return rows.data.length > 0;
}

export default async function matchFeedbackRoutes(fastify: FastifyInstance) {
  fastify.post("/api/product-matches/:id/feedback", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const body = parseInput(feedbackSchema, request.body ?? {}, reply, { error: "invalid_body", message: "Motif de signalement invalide." });
    if (!body) return;
    const userId = request.user!.id;

    const owned = await ownsMatch(fastify, userId, params.id);
    if (owned === null) return reply.code(500).send(FEEDBACK_FAILED);
    if (!owned) return reply.code(404).send(MATCH_NOT_FOUND);

    // Changer de motif ne compte jamais dans la limite du jour.
    const changed = await changeReason(fastify, userId, params.id, body.reason);
    if (changed === null) return reply.code(500).send(FEEDBACK_FAILED);
    if (changed) return reply.send({ reason: body.reason });

    const count = await countTodaysFeedback(fastify, userId);
    if (count === null) return reply.code(500).send(FEEDBACK_FAILED);
    if (dailyLimitReached(count)) return reply.code(429).send(FEEDBACK_LIMIT);

    const { error } = await fastify.supabaseAdmin.from("match_feedback").insert({ user_id: userId, match_id: params.id, reason: body.reason });
    // Deux envois simultanés : le second trouve le premier déjà rangé.
    if (error?.code === "23505" && (await changeReason(fastify, userId, params.id, body.reason))) return reply.send({ reason: body.reason });
    if (error) {
      request.log.error({ error }, "Échec d'enregistrement d'un signalement de résultat");
      return reply.code(500).send(FEEDBACK_FAILED);
    }
    return reply.send({ reason: body.reason });
  });

  // Retirer son signalement : seulement le sien, sans dire si la proposition existe.
  fastify.delete("/api/product-matches/:id/feedback", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const { error } = await fastify.supabaseAdmin.from("match_feedback").delete().eq("user_id", request.user!.id).eq("match_id", params.id);
    if (error) {
      request.log.error({ error }, "Échec du retrait d'un signalement de résultat");
      return reply.code(500).send({ error: "internal_error", message: "Le signalement n'a pas pu être retiré. Réessayez." });
    }
    return reply.code(204).send();
  });
}
