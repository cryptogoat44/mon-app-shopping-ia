import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { REPORT_REASONS, REPORT_TARGET_TYPES, type ReportTargetType } from "@monapp/shared-types";
import { parseInput } from "../lib/validation.js";
import { raiseAlert } from "../lib/alerts.js";

// Lot 5 : une pièce reçue (« piece ») se signale aussi.
const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  note: z.string().max(2000).optional(),
});

// Les signalements sont enregistrés pour l'écran « Modération » (réservé aux
// administrateurs, lot 5). Chaque nouveau signalement envoie aussi une alerte
// (lib/alerts.ts, lot garde-fous) : Apple attend un traitement rapide. Le
// type de contenu et le motif seulement, jamais un compte ni la note.
/** Le type de contenu signalé, en clair dans l'alerte. */
const REPORT_TARGET_LABELS: Record<ReportTargetType, string> = {
  user: "un compte",
  post: "une publication",
  comment: "un commentaire",
  piece: "une pièce reçue",
};

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

      raiseAlert(request.log, {
        kind: "signalement",
        message: `Nouveau signalement à traiter (${REPORT_TARGET_LABELS[body.targetType]}, motif : ${body.reason})`,
        tags: { cible: body.targetType, motif: body.reason },
      });

      return reply.code(204).send();
    }
  );
}
