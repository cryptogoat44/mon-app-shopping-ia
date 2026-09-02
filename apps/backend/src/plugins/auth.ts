import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface AuthenticatedUser {
  id: string;
  email: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }
  interface FastifyInstance {
    /** À poser sur une route pour exiger un utilisateur connecté.
     * Répond 401 si le jeton est absent ou invalide. */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async function authPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest("user", null);

  fastify.decorate("requireAuth", async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

    if (!token) {
      return reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification manquant." });
    }

    // On délègue la vérification du jeton à Supabase plutôt que de le décoder
    // nous-mêmes : ça reste valide quel que soit l'algorithme de signature
    // utilisé par le projet, et ça vérifie aussi que le compte n'a pas été
    // supprimé ou banni entre-temps.
    const { data, error } = await fastify.supabaseAdmin.auth.getUser(token);

    if (error || !data.user) {
      return reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification invalide ou expiré." });
    }

    request.user = { id: data.user.id, email: data.user.email ?? null };
  });
});
