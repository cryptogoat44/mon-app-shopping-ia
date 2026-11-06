import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { REPORT_REASONS, REPORT_TARGET_TYPES } from "@monapp/shared-types";
import { parseInput } from "../lib/validation.js";
import { autoHideIfReported } from "../lib/autoHide.js";
import { captureModerationEvent } from "../lib/sentry.js";

// Lot 5 : une pièce reçue (« piece ») se signale aussi.
const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  note: z.string().max(2000).optional(),
});

// Signalements : enregistrés pour la file de modération (lot 5). Chantier 3
// (point 6 de la feuille de route V1, règle 1.2 d'Apple) : chaque
// signalement prévient le fondateur (UNE alerte Sentry, tag « alerte » :
// le type de contenu et le motif, jamais la personne qui signale ni sa
// note), et un contenu signalé par plusieurs personnes différentes est
// masqué aussitôt, en attendant la décision d'un administrateur
// (lib/autoHide.ts, migration 0030). La personne qui signale ne voit plus
// ce contenu (lib/reportedByViewer.ts).
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

      captureModerationEvent({ kind: "report", targetType: body.targetType, targetId: body.targetId, reason: body.reason });
      const autoHide = await autoHideIfReported(
        (fn, args) => fastify.supabaseAdmin.rpc(fn, args),
        request.log,
        body.targetType,
        body.targetId
      );
      if (autoHide === "hidden") {
        request.log.info({ targetType: body.targetType }, "Contenu masqué automatiquement après plusieurs signalements");
        captureModerationEvent({ kind: "auto_hide", targetType: body.targetType, targetId: body.targetId });
      }

      return reply.code(204).send();
    }
  );
}
