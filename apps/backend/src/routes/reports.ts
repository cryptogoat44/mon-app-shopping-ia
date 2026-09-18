import type { FastifyInstance } from "fastify";
import type { ReportReason, ReportTargetType } from "@monapp/shared-types";

const TARGET_TYPES: ReportTargetType[] = ["user", "post"];
const REASONS: ReportReason[] = ["spam", "inappropriate", "harassment", "other"];

// Pas d'interface de modération pour l'instant — les signalements sont
// simplement enregistrés pour une revue manuelle. Voir la table `reports`.
export default async function reportsRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/api/reports",
    {
      preHandler: [fastify.requireAuth, fastify.rateLimit("report")],
      config: { rateLimitName: "report" },
    },
    async (request, reply) => {
      const reporterId = request.user!.id;
      const body = request.body as { targetType?: string; targetId?: string; reason?: string; note?: string };

      if (!body.targetType || !TARGET_TYPES.includes(body.targetType as ReportTargetType)) {
        return reply.code(400).send({ error: "invalid_body", message: "Type de signalement invalide." });
      }
      if (!body.targetId) {
        return reply.code(400).send({ error: "invalid_body", message: "Cible du signalement manquante." });
      }
      if (!body.reason || !REASONS.includes(body.reason as ReportReason)) {
        return reply.code(400).send({ error: "invalid_body", message: "Motif de signalement invalide." });
      }

      const note = body.note?.trim().slice(0, 500) || null;

      const { error } = await fastify.supabaseAdmin.from("reports").insert({
        reporter_id: reporterId,
        target_type: body.targetType,
        target_id: body.targetId,
        reason: body.reason,
        note,
      });

      if (error) {
        request.log.error({ error }, "Échec de l'enregistrement du signalement");
        return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
      }

      return reply.code(204).send();
    }
  );
}
