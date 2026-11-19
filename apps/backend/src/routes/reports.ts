import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { REPORT_REASONS, REPORT_TARGET_TYPES } from "@monapp/shared-types";
import { DatabaseReadError, parseInput } from "../lib/validation.js";
import { findViewablePost, isBlockedEitherWay } from "../lib/visibility.js";
import { autoHideIfReported } from "../lib/autoHide.js";
import { captureModerationEvent } from "../lib/sentry.js";
import { MESSAGES_UNAVAILABLE, messagesReady } from "../lib/messaging.js";
import { COLLECTION_MODERATION_UNAVAILABLE, canReportCollection, collectionModerationReady } from "../lib/collectionModeration.js";
import { replyRootShownTo } from "../lib/comments.js";

// Lot 5 : une pièce reçue (« piece ») se signale aussi ; lot messages : un
// message reçu (« message ») ; lot modération des collections : une
// collection montrée par un ami (« collection », migration 0034).
const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.guid(),
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
const TARGET_NOT_FOUND = { error: "target_not_found", message: "Contenu introuvable." } as const;

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
          return reply.code(404).send(TARGET_NOT_FOUND);
        }
      }

      // Une réponse à un commentaire (migration 0046) ne se signale que si son
      // commentaire d'origine est montré à la personne, comme dans son fil
      // (lib/comments.ts) : sinon 404 « Contenu introuvable », sans rien
      // enregistrer ni masquer. Le commentaire lui-même relève de
      // canReportComment (lot « corrections en ligne », qui entre dans main
      // avant ce lot).
      if (body.targetType === "comment" && !(await replyRootShownTo(fastify, reporterId, body.targetId))) {
        return reply.code(404).send(TARGET_NOT_FOUND);
      }

      // Une collection ne se signale que si on la voit vraiment (ami de son
      // auteur, montrée aux amis, pas masquée), et pas la sienne ; sinon la
      // même réponse qu'une collection inexistante. Sans la migration 0034 :
      // « indisponible » (la base refuserait ce type de signalement).
      if (body.targetType === "collection") {
        if (!(await collectionModerationReady(fastify))) return reply.code(404).send(COLLECTION_MODERATION_UNAVAILABLE);
        if (!(await canReportCollection(fastify, reporterId, body.targetId))) return reply.code(404).send(TARGET_NOT_FOUND);
      }

      // Lot « corrections en ligne » : une publication, un commentaire ou un
      // compte ne se signale que si on le voit vraiment ; sinon la même
      // réponse qu'un contenu inexistant. Avant, n'importe quel identifiant
      // était accepté : quelques comptes connaissant l'identifiant d'une
      // publication « Moi seul » ou « Abonnés » pouvaient la faire masquer
      // (lib/autoHide.ts) sans jamais la voir.
      if (body.targetType === "post" && !(await canReportPost(fastify, reporterId, body.targetId))) {
        return reply.code(404).send(TARGET_NOT_FOUND);
      }
      if (body.targetType === "comment" && !(await canReportComment(fastify, reporterId, body.targetId))) {
        return reply.code(404).send(TARGET_NOT_FOUND);
      }
      if (body.targetType === "user" && !(await canReportUser(fastify, body.targetId))) {
        return reply.code(404).send(TARGET_NOT_FOUND);
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

/** La publication est visible par `reporterId` (masquage, blocages,
 * confidentialité : lib/visibility.ts) et n'est pas la sienne (l'app ne
 * propose pas de signaler sa propre publication). */
async function canReportPost(fastify: FastifyInstance, reporterId: string, postId: string): Promise<boolean> {
  const post = await findViewablePost(fastify, reporterId, postId);
  return post !== null && post.user_id !== reporterId;
}

/** Le commentaire est dans ce que `reporterId` lit sous la publication
 * (routes/comments.ts) : pas masqué, sur une publication qu'il voit, d'un
 * compte sans blocage avec lui (dans un sens ou dans l'autre) ; et ce n'est
 * pas le sien (l'app ne le propose pas). */
async function canReportComment(fastify: FastifyInstance, reporterId: string, commentId: string): Promise<boolean> {
  const { data, error } = await fastify.supabaseAdmin.from("comments").select("post_id, user_id").eq("id", commentId).is("hidden_at", null).maybeSingle();
  if (error) throw new DatabaseReadError("Lecture d'un commentaire impossible");
  if (!data) return false;
  const comment = data as { post_id: string; user_id: string };
  if (comment.user_id === reporterId) return false;
  if (!(await findViewablePost(fastify, reporterId, comment.post_id))) return false;
  return !(await isBlockedEitherWay(fastify, reporterId, comment.user_id));
}

/** Le compte existe (une ligne `profiles`), même sans nom d'utilisateur : le
 * serveur n'empêche pas un compte sans nom d'envoyer une invitation à écrire
 * (POST /api/messages ne vérifie que le destinataire), et la personne qui la
 * reçoit doit pouvoir signaler ce compte depuis « Bloquer » ou le menu de la
 * conversation. Un blocage, dans un sens ou dans l'autre, n'empêche PAS de le
 * signaler : l'app permet de bloquer puis de signaler, et une personne bloquée
 * par celui qui la harcèle doit pouvoir le signaler. Un profil ne se masque
 * jamais automatiquement (lib/autoHide.ts). */
async function canReportUser(fastify: FastifyInstance, userId: string): Promise<boolean> {
  const { data, error } = await fastify.supabaseAdmin.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (error) throw new DatabaseReadError("Lecture d'un profil impossible");
  return data !== null;
}
