import type { FastifyInstance } from "fastify";

export default async function followsRoutes(fastify: FastifyInstance) {
  fastify.post("/api/follows/:userId", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const { userId: followeeId } = request.params as { userId: string };
    const followerId = request.user!.id;

    if (followeeId === followerId) {
      return reply.code(400).send({ error: "invalid_target", message: "Impossible de se suivre soi-même." });
    }

    const { data: target } = await fastify.supabaseAdmin.from("profiles").select("id").eq("id", followeeId).single();
    if (!target) {
      return reply.code(404).send({ error: "user_not_found", message: "Profil introuvable." });
    }

    const { error } = await fastify.supabaseAdmin
      .from("follows")
      .upsert({ follower_id: followerId, followee_id: followeeId }, { onConflict: "follower_id,followee_id" });

    if (error) {
      request.log.error({ error }, "Échec de l'abonnement");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    return reply.code(204).send();
  });

  fastify.delete("/api/follows/:userId", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const { userId: followeeId } = request.params as { userId: string };
    const followerId = request.user!.id;

    const { error } = await fastify.supabaseAdmin
      .from("follows")
      .delete()
      .eq("follower_id", followerId)
      .eq("followee_id", followeeId);

    if (error) {
      request.log.error({ error }, "Échec du désabonnement");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    return reply.code(204).send();
  });
}
