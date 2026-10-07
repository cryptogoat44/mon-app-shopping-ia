import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isAuthApiError, isAuthSessionMissingError, type AuthError, type User } from "@supabase/supabase-js";

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
     * Répond 401 si le jeton est absent ou refusé par Supabase, 503 si
     * Supabase n'a pas pu être joint (jamais 401 dans ce cas). */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const AUTH_UNAVAILABLE_MESSAGE = "Spotto est momentanément injoignable. Réessayez dans un instant.";

/** Session refusée : seulement sur une réponse explicite de Supabase (jeton
 * invalide ou expiré, session fermée, compte supprimé). Une connexion coupée,
 * une réponse illisible ou une erreur 5xx de Supabase n'en sont pas. */
export function sessionRejected(error: AuthError): boolean {
  if (isAuthSessionMissingError(error)) return true;
  return isAuthApiError(error) && error.status >= 400 && error.status < 500;
}

type Check = { kind: "user"; user: User } | { kind: "rejected" } | { kind: "unavailable"; error: AuthError | null };

/** Vérifie le jeton auprès de Supabase ; une panne passagère a droit à un
 * second essai, aussitôt (une connexion inutilisable est alors remplacée). */
async function checkToken(fastify: FastifyInstance, token: string): Promise<Check> {
  let last: AuthError | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await fastify.supabaseAdmin.auth.getUser(token);
    if (!error && data.user) return { kind: "user", user: data.user };
    if (error && sessionRejected(error)) return { kind: "rejected" };
    last = error;
  }
  return { kind: "unavailable", error: last };
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
    // supprimé ou banni entre-temps. Une panne de Supabase n'est JAMAIS une
    // session refusée : avant le lot 4 ter, elle répondait 401 et l'app
    // déconnectait la personne (incident du 2026-10-07, refus en 2 ms).
    const check = await checkToken(fastify, token);
    if (check.kind === "unavailable") {
      request.log.warn({ authError: check.error ? { name: check.error.name, status: check.error.status } : null }, "Vérification de session impossible (Supabase injoignable)");
      return reply.code(503).send({ error: "auth_unavailable", message: AUTH_UNAVAILABLE_MESSAGE });
    }
    if (check.kind === "rejected") {
      return reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification invalide ou expiré." });
    }

    request.user = { id: check.user.id, email: check.user.email ?? null };
  });
});
