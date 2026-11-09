import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { REPORT_REASONS, REPORT_TARGET_TYPES } from "@monapp/shared-types";
import { parseInput } from "../lib/validation.js";
import { autoHideIfReported } from "../lib/autoHide.js";
import { captureModerationEvent } from "../lib/sentry.js";
import { MESSAGES_UNAVAILABLE, messagesReady } from "../lib/messaging.js";

// Lot 5 : une pièce reçue (« piece ») se signale aussi ; lot messages : un
// message reçu (« message »).
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

      // Un message ne se signale que dans sa propre conversation, et pas le
      // sien : la modération ne lit jamais un message qu'on n'a pas reçu.
      if (body.targetType === "message") {
        if (!(await messagesReady(fastify))) return reply.code(404).send(MESSAGES_UNAVAILABLE);
        if (!(await canReportMessage(fastify, reporterId, body.targetId))) {
          return reply.code(404).send({ error: "target_not_found", message: "Contenu introuvable." });
        }
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

/** Le message existe, a été envoyé par l'autre membre, dans une conversation
 * de `reporterId` (même une invitation refusée). */
async function canReportMessage(fastify: FastifyInstance, reporterId: string, messageId: string): Promise<boolean> {
  const { data: message, error } = await fastify.supabaseAdmin.from("messages").select("conversation_id, sender_id").eq("id", messageId).maybeSingle();
  if (error || !message) return false;
  const row = message as { conversation_id: string; sender_id: string };
  if (row.sender_id === reporterId) return false;
  const { data: side, error: sideError } = await fastify.supabaseAdmin
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", row.conversation_id)
    .eq("user_id", reporterId)
    .maybeSingle();
  return !sideError && side !== null;
}
