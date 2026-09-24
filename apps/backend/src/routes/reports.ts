import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ReportReason, ReportTargetType } from "@monapp/shared-types";
import { parseInput } from "../lib/validation.js";

const TARGET_TYPES: [ReportTargetType, ...ReportTargetType[]] = ["user", "post", "comment"];
const REASONS: [ReportReason, ...ReportReason[]] = ["spam", "inappropriate", "harassment", "other"];

const createReportSchema = z.object({
  targetType: z.enum(TARGET_TYPES),
  targetId: z.string().uuid(),
  reason: z.enum(REASONS),
  note: z.string().max(2000).optional(),
});

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
      // Un corps absent faisait planter la route (500) : tout passe
      // désormais par le schéma (audit Lot Q, SEC-03).
      const body = parseInput(createReportSchema, request.body, reply, {
        error: "invalid_body",
        message: "Signalement invalide.",
      });
      if (!body) return;

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
