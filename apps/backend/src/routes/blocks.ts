import type { FastifyInstance } from "fastify";
import type { BlockedUser } from "@monapp/shared-types";
import { INVALID_ID, parseInput, userIdParamsSchema } from "../lib/validation.js";

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
}

export default async function blocksRoutes(fastify: FastifyInstance) {
  fastify.post("/api/blocks/:userId", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const blockedId = params.userId;
    const blockerId = request.user!.id;

    if (blockedId === blockerId) {
      return reply.code(400).send({ error: "invalid_target", message: "Impossible de se bloquer soi-même." });
    }

    const { data: target } = await fastify.supabaseAdmin.from("profiles").select("id").eq("id", blockedId).single();
    if (!target) {
      return reply.code(404).send({ error: "user_not_found", message: "Profil introuvable." });
    }

    const { error } = await fastify.supabaseAdmin
      .from("blocks")
      .upsert({ blocker_id: blockerId, blocked_id: blockedId }, { onConflict: "blocker_id,blocked_id" });

    if (error) {
      request.log.error({ error }, "Échec du blocage");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    // Le blocage rompt tout lien d'abonnement existant, dans les deux sens —
    // deux appels distincts plutôt qu'un .or() construit par interpolation
    // (même risque de manipulation du filtre PostgREST qu'ailleurs dans le
    // backend, même si ici les deux ids viennent du serveur, pas de l'utilisateur).
    await fastify.supabaseAdmin.from("follows").delete().eq("follower_id", blockerId).eq("followee_id", blockedId);
    await fastify.supabaseAdmin.from("follows").delete().eq("follower_id", blockedId).eq("followee_id", blockerId);

    // Et efface les notifications échangées entre les deux comptes : un
    // compte bloqué ne doit plus apparaître nulle part (audit Lot Q, SEC-04 —
    // la lecture des notifications les filtre aussi, par sécurité).
    await fastify.supabaseAdmin.from("notifications").delete().eq("user_id", blockerId).eq("actor_id", blockedId);
    await fastify.supabaseAdmin.from("notifications").delete().eq("user_id", blockedId).eq("actor_id", blockerId);

    return reply.code(204).send();
  });

  fastify.delete("/api/blocks/:userId", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const blockedId = params.userId;
    const blockerId = request.user!.id;

    const { error } = await fastify.supabaseAdmin
      .from("blocks")
      .delete()
      .eq("blocker_id", blockerId)
      .eq("blocked_id", blockedId);

    if (error) {
      request.log.error({ error }, "Échec du déblocage");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    return reply.code(204).send();
  });

  fastify.get("/api/blocks", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const blockerId = request.user!.id;

    const { data: rows, error } = await fastify.supabaseAdmin
      .from("blocks")
      .select("blocked_id, created_at")
      .eq("blocker_id", blockerId)
      .order("created_at", { ascending: false });

    if (error) {
      request.log.error({ error }, "Échec de lecture des blocages");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const blockedIds = (rows ?? []).map((r) => r.blocked_id as string);
    if (blockedIds.length === 0) {
      return reply.send([]);
    }

    const { data: profiles } = await fastify.supabaseAdmin
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", blockedIds);

    const profileById = new Map(((profiles as ProfileRow[]) ?? []).map((p) => [p.id, p]));

    const result: BlockedUser[] = (rows ?? [])
      .map((row) => {
        const profile = profileById.get(row.blocked_id as string);
        if (!profile) return null;
        return {
          id: profile.id,
          username: profile.username ?? "",
          displayName: profile.display_name,
          avatarUrl: profile.avatar_url,
          blockedAt: row.created_at as string,
        };
      })
      .filter((r): r is BlockedUser => r !== null);

    return reply.send(result);
  });
}
