import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MODERATION_ACTION_TYPES,
  NOTIFICATION_TYPES,
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  type AppNotification,
  type ModerationNotice,
  type PostAuthor,
} from "@monapp/shared-types";
import { fetchBlockedUserIds } from "../lib/blocks.js";
import { GENERIC_SERVER_ERROR } from "../lib/messages.js";
import { INVALID_CURSOR, cursorQuerySchema, parseDbRows, parseInput } from "../lib/validation.js";

// Pagination par curseur (date de la dernière notification reçue) : la
// réponse reste une liste, comme avant (compatible avec l'app déjà en ligne) ;
// une page pleine signale qu'il peut en rester.
const PAGE_SIZE = 50;

const ID = z.string().uuid();
const NOTIFICATION_ROWS = z.array(
  z.object({
    id: ID,
    type: z.enum(NOTIFICATION_TYPES),
    actor_id: ID.nullable(),
    post_id: ID.nullable(),
    moderation_action_id: ID.nullable(),
    created_at: z.string(),
    read_at: z.string().nullable(),
  })
);
type NotificationRow = z.infer<typeof NOTIFICATION_ROWS>[number];

const ACTOR_ROWS = z.array(
  z.object({ id: ID, username: z.string().nullable(), display_name: z.string(), avatar_url: z.string().nullable() })
);
const NOTICE_ROWS = z.array(
  z.object({
    id: ID,
    action: z.enum(MODERATION_ACTION_TYPES),
    target_type: z.enum(REPORT_TARGET_TYPES),
    reason: z.enum(REPORT_REASONS).nullable(),
    note: z.string().nullable(),
  })
);

/** Filtre PostgREST : les notifications d'un compte en blocage (dans un sens
 * ou dans l'autre) n'apparaissent jamais ; celles de la modération, sans
 * auteur, toujours. Les identifiants viennent de notre propre base, jamais du
 * client. */
function visibleActorsFilter(blockedIds: Set<string>): string | null {
  return blockedIds.size > 0 ? `actor_id.is.null,actor_id.not.in.(${[...blockedIds].join(",")})` : null;
}

async function fetchActors(fastify: FastifyInstance, rows: NotificationRow[]): Promise<Map<string, PostAuthor>> {
  const ids = [...new Set(rows.map((row) => row.actor_id).filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const result = await fastify.supabaseAdmin.from("profiles").select("id, username, display_name, avatar_url").in("id", ids);
  const profiles = parseDbRows(ACTOR_ROWS, result, "Auteurs des notifications");
  return new Map(
    profiles.map((p) => [p.id, { id: p.id, username: p.username ?? "", displayName: p.display_name, avatarUrl: p.avatar_url }])
  );
}

/** Décisions de la modération citées par ces notifications (quoi et pourquoi, jamais qui). */
async function fetchNotices(fastify: FastifyInstance, rows: NotificationRow[]): Promise<Map<string, ModerationNotice>> {
  const ids = rows.map((row) => row.moderation_action_id).filter((id): id is string => id !== null);
  if (ids.length === 0) return new Map();
  const result = await fastify.supabaseAdmin.from("moderation_actions").select("id, action, target_type, reason, note").in("id", ids);
  const actions = parseDbRows(NOTICE_ROWS, result, "Décisions de modération");
  return new Map(actions.map((a) => [a.id, { action: a.action, targetType: a.target_type, reason: a.reason, note: a.note }]));
}

/** La personne concernée lit la décision et son motif ; l'auteur d'un
 * signalement, seulement le type du contenu signalé (« traité »). */
function toNotification(row: NotificationRow, actors: Map<string, PostAuthor>, notices: Map<string, ModerationNotice>): AppNotification {
  const actor = row.actor_id ? (actors.get(row.actor_id) ?? { id: row.actor_id, username: "", displayName: "", avatarUrl: null }) : null;
  const notice = row.moderation_action_id ? (notices.get(row.moderation_action_id) ?? null) : null;
  return {
    id: row.id,
    type: row.type,
    actor,
    createdAt: row.created_at,
    read: row.read_at !== null,
    postId: row.post_id,
    moderation: row.type === "moderation" ? notice : null,
    reportedType: row.type === "report_handled" ? (notice?.targetType ?? null) : null,
  };
}

export default async function notificationsRoutes(fastify: FastifyInstance) {
  fastify.get("/api/notifications", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const pageQuery = parseInput(cursorQuerySchema, request.query, reply, INVALID_CURSOR);
    if (!pageQuery) return;
    const userId = request.user!.id;

    // Un compte bloqué n'apparaît jamais, y compris dans les notifications
    // reçues avant le blocage (audit Lot Q, SEC-04). Une notification qui
    // parle d'un contenu masqué par la modération disparaît avec lui (lot 5).
    const actorsFilter = visibleActorsFilter(await fetchBlockedUserIds(fastify, userId));
    let query = fastify.supabaseAdmin
      .from("notifications")
      .select("id, type, actor_id, post_id, moderation_action_id, created_at, read_at")
      .eq("user_id", userId)
      .is("hidden_at", null)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (actorsFilter) query = query.or(actorsFilter);
    if (pageQuery.cursor) query = query.lt("created_at", pageQuery.cursor);

    const result = await query;
    if (result.error) {
      request.log.error({ error: result.error }, "Échec de lecture des notifications");
      return reply.code(500).send({ error: "internal_error", message: GENERIC_SERVER_ERROR });
    }
    const rows = parseDbRows(NOTIFICATION_ROWS, result, "Notifications");
    const [actors, notices] = await Promise.all([fetchActors(fastify, rows), fetchNotices(fastify, rows)]);
    return reply.send(rows.map((row) => toNotification(row, actors, notices)));
  });

  fastify.get("/api/notifications/unread-count", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;
    const actorsFilter = visibleActorsFilter(await fetchBlockedUserIds(fastify, userId));

    let query = fastify.supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null)
      .is("hidden_at", null);
    if (actorsFilter) query = query.or(actorsFilter);

    const { count, error } = await query;

    if (error) {
      request.log.error({ error }, "Échec de lecture du compteur de notifications");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    return reply.send({ count: count ?? 0 });
  });

  fastify.post("/api/notifications/read-all", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    const { error } = await fastify.supabaseAdmin
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("read_at", null);

    if (error) {
      request.log.error({ error }, "Échec de la mise à jour des notifications");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    return reply.code(204).send();
  });
}
