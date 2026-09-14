import type { FastifyInstance } from "fastify";
import type { AppNotification, NotificationType, PostAuthor } from "@monapp/shared-types";

interface NotificationRow {
  id: string;
  type: NotificationType;
  actor_id: string;
  created_at: string;
  read_at: string | null;
}

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
}

export default async function notificationsRoutes(fastify: FastifyInstance) {
  fastify.get("/api/notifications", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    const { data: rows, error } = await fastify.supabaseAdmin
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      request.log.error({ error }, "Échec de lecture des notifications");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const notifRows = (rows as NotificationRow[]) ?? [];
    if (notifRows.length === 0) {
      return reply.send([]);
    }

    const actorIds = [...new Set(notifRows.map((r) => r.actor_id))];
    const { data: profiles } = await fastify.supabaseAdmin
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", actorIds);

    const profileById = new Map(((profiles as ProfileRow[]) ?? []).map((p) => [p.id, p]));

    const notifications: AppNotification[] = notifRows.map((row) => {
      const actor = profileById.get(row.actor_id);
      const actorInfo: PostAuthor = {
        id: row.actor_id,
        username: actor?.username ?? "",
        displayName: actor?.display_name ?? "",
        avatarUrl: actor?.avatar_url ?? null,
      };
      return {
        id: row.id,
        type: row.type,
        actor: actorInfo,
        createdAt: row.created_at,
        read: row.read_at !== null,
      };
    });

    return reply.send(notifications);
  });

  fastify.get("/api/notifications/unread-count", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    const { count, error } = await fastify.supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null);

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
