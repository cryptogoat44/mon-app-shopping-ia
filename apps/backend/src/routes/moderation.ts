// Modération minimaliste (lot 5, section 5.B) : file des signalements
// regroupés par contenu, décisions (classer sans suite, masquer, suspendre) et
// leur annulation. Réservé aux administrateurs (`requireAdmin`, revérifié par
// les fonctions de la base) ; chaque décision est journalisée et appliquée en
// une seule transaction (migration 0023). Lot 5, partie B : retirer l'image
// copiée d'une envie partagée (lib/imageRemoval.ts, migration 0026).
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  IMAGE_REMOVAL_TARGET_TYPES,
  MODERATION_DECISIONS,
  MODERATION_NOTE_MAX_LENGTH,
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  type ModerationItem,
  type ModerationPage,
} from "@monapp/shared-types";
import { DatabaseReadError, INVALID_ID, idParamsSchema, parseInput } from "../lib/validation.js";
import { GENERIC_SERVER_ERROR } from "../lib/messages.js";
import { buildModerationItems, QUEUE_ROWS } from "../lib/moderationQueue.js";
import { eraseCopiedImage } from "../lib/imageRemoval.js";

const PAGE_SIZE = 20;

const queueQuerySchema = z.object({
  status: z.enum(["open", "handled"]).default("open"),
  cursor: z.string().datetime({ offset: true }).optional(),
});

const noteSchema = z.string().trim().max(MODERATION_NOTE_MAX_LENGTH).optional();

const decisionSchema = z
  .object({
    targetType: z.enum(REPORT_TARGET_TYPES),
    targetId: z.string().uuid(),
    action: z.enum(MODERATION_DECISIONS),
    reason: z.enum(REPORT_REASONS).optional(),
    note: noteSchema,
  })
  .refine((d) => d.action === "dismiss" || d.reason !== undefined, "Un motif est obligatoire pour masquer ou suspendre.")
  .refine((d) => !(d.action === "hide" && d.targetType === "user"), "Un profil ne se masque pas : suspendez le compte.");

const undoSchema = z.object({ note: noteSchema });

const removeImageSchema = z.object({ targetType: z.enum(IMAGE_REMOVAL_TARGET_TYPES), targetId: z.string().uuid(), note: noteSchema });

const OUTCOME = z.array(z.object({ outcome: z.string(), action_id: z.string().uuid().nullable() })).length(1);

const INVALID_DECISION = { error: "invalid_body", message: "Décision invalide." };
const REFUSALS: Record<string, { status: number; error: string; message: string }> = {
  not_admin: { status: 404, error: "not_found", message: "Page introuvable." },
  invalid: { status: 400, ...INVALID_DECISION },
  target_not_found: { status: 404, error: "target_not_found", message: "Contenu introuvable." },
  already_hidden: { status: 409, error: "already_hidden", message: "Ce contenu est déjà masqué." },
  already_suspended: { status: 409, error: "already_suspended", message: "Ce compte est déjà suspendu." },
  already_undone: { status: 409, error: "already_undone", message: "Cette décision a déjà été annulée." },
  already_handled: { status: 409, error: "already_handled", message: "Ces signalements ont déjà été traités." },
  // Retrait d'une image copiée (lot 5, partie B).
  not_a_copy: { status: 409, error: "not_a_copy", message: "Cette image a été publiée par la personne elle-même : utilisez « Masquer »." },
  already_removed: { status: 409, error: "already_removed", message: "L'image a déjà été retirée." },
  shared_copy: {
    status: 409,
    error: "shared_copy",
    message: "Cette image sert aussi à un autre contenu : rien n'a été effacé ni changé. Signalez ce cas à l'équipe technique.",
  },
  storage_failed: {
    status: 503,
    error: "storage_failed",
    message: "L'image n'a pas pu être effacée du stockage : rien n'a été changé. Réessayez dans un instant.",
  },
  not_undoable: { status: 409, error: "not_undoable", message: "Le retrait d'une image ne s'annule pas : le fichier a été effacé." },
};

export default async function moderationRoutes(fastify: FastifyInstance) {
  const adminOnly = { preHandler: [fastify.requireAuth, fastify.requireAdmin] };

  fastify.get("/api/admin/moderation", adminOnly, async (request, reply) => {
    const query = parseInput(queueQuerySchema, request.query, reply, { error: "invalid_query", message: "Paramètre de liste invalide." });
    if (!query) return;
    const { data, error } = await fastify.supabaseAdmin.rpc("moderation_queue", {
      p_handled: query.status === "handled",
      p_before: query.cursor ?? null,
      p_limit: PAGE_SIZE + 1,
    });
    const rows = QUEUE_ROWS.safeParse(data);
    if (error || !rows.success) {
      request.log.error({ error }, "File de modération illisible");
      return reply.code(500).send({ error: "internal_error", message: GENERIC_SERVER_ERROR });
    }
    const pageRows = rows.data.slice(0, PAGE_SIZE);
    let items: ModerationItem[];
    try {
      items = await buildModerationItems(fastify, pageRows);
    } catch (buildError) {
      request.log.error({ buildError }, "Aperçus de modération illisibles");
      return reply.code(500).send({ error: "internal_error", message: GENERIC_SERVER_ERROR });
    }
    const page: ModerationPage = { items, nextCursor: rows.data.length > PAGE_SIZE ? (pageRows.at(-1)?.last_at ?? null) : null };
    return reply.send(page);
  });

  fastify.post("/api/admin/moderation/actions", adminOnly, async (request, reply) => {
    const parsed = decisionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(INVALID_DECISION);
    const decision = parsed.data;
    const { data, error } = await fastify.supabaseAdmin.rpc("moderation_apply", {
      p_admin_id: request.user!.id,
      p_action: decision.action,
      p_target_type: decision.targetType,
      p_target_id: decision.targetId,
      p_reason: decision.reason ?? null,
      p_note: decision.note || null,
    });
    return sendOutcome(request.log, reply, data, error, "Décision de modération");
  });

  fastify.post("/api/admin/moderation/actions/:id/undo", adminOnly, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const body = parseInput(undoSchema, request.body ?? {}, reply, INVALID_DECISION);
    if (!body) return;
    const { data, error } = await fastify.supabaseAdmin.rpc("moderation_undo", {
      p_admin_id: request.user!.id,
      p_action_id: params.id,
      p_note: body.note || null,
    });
    return sendOutcome(request.log, reply, data, error, "Annulation d'une décision de modération");
  });

  // Fichiers effacés D'ABORD (3 essais) ; la décision n'est enregistrée
  // qu'ensuite : un échec du stockage ne laisse jamais une image « retirée »
  // encore en ligne.
  fastify.post("/api/admin/moderation/remove-image", adminOnly, async (request, reply) => {
    const body = parseInput(removeImageSchema, request.body, reply, INVALID_DECISION);
    if (!body) return;
    let refusal: string | null;
    try {
      refusal = await eraseCopiedImage(fastify, request.log, body.targetType, body.targetId);
    } catch (readError) {
      if (!(readError instanceof DatabaseReadError)) throw readError;
      request.log.error({ readError }, "Retrait d'image : lecture impossible");
      return reply.code(500).send({ error: "internal_error", message: GENERIC_SERVER_ERROR });
    }
    if (refusal) return sendRefusal(reply, refusal);
    const { data, error } = await fastify.supabaseAdmin.rpc("moderation_remove_image", {
      p_admin_id: request.user!.id,
      p_target_type: body.targetType,
      p_target_id: body.targetId,
      p_note: body.note || null,
    });
    return sendOutcome(request.log, reply, data, error, "Retrait d'une image copiée");
  });
}

function sendRefusal(reply: FastifyReply, outcome: string) {
  const refusal = REFUSALS[outcome] ?? { status: 500, error: "internal_error", message: GENERIC_SERVER_ERROR };
  return reply.code(refusal.status).send({ error: refusal.error, message: refusal.message });
}

/** Résultat d'une fonction de la base : 200 avec l'identifiant de la décision, ou le refus expliqué. */
function sendOutcome(log: FastifyInstance["log"], reply: FastifyReply, data: unknown, error: unknown, what: string) {
  const parsed = OUTCOME.safeParse(data);
  if (error || !parsed.success) {
    log.error({ error }, `${what} : réponse illisible`);
    return reply.code(500).send({ error: "internal_error", message: GENERIC_SERVER_ERROR });
  }
  const { outcome, action_id: actionId } = parsed.data[0]!;
  if (outcome === "ok" && actionId) {
    log.info({ outcome }, what);
    return reply.send({ actionId });
  }
  return sendRefusal(reply, outcome);
}
