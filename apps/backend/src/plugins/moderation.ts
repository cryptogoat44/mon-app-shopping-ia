import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { GENERIC_SERVER_ERROR } from "../lib/messages.js";
import { ACCOUNT_SUSPENDED, ADMIN_NOT_FOUND, isAdmin, isSuspended } from "../lib/moderation.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Après `requireAuth` : réservé aux administrateurs (table « admins »).
     * Les autres comptes reçoivent 404 : la modération leur reste invisible. */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Après `requireAuth` : refuse (403) les actions d'un compte suspendu —
     * publier, commenter, suivre, réagir, modifier son profil public. */
    requireActiveAccount: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async function moderationPlugin(fastify: FastifyInstance) {
  fastify.decorate("requireAdmin", async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
    try {
      if (!(await isAdmin(fastify, request.user!.id))) await reply.code(404).send(ADMIN_NOT_FOUND);
    } catch {
      request.log.error("Rôle administrateur illisible");
      await reply.code(500).send({ error: "internal_error", message: GENERIC_SERVER_ERROR });
    }
  });

  fastify.decorate("requireActiveAccount", async function requireActiveAccount(request: FastifyRequest, reply: FastifyReply) {
    try {
      if (await isSuspended(fastify, request.user!.id)) await reply.code(403).send(ACCOUNT_SUSPENDED);
    } catch {
      request.log.error("Suspension illisible");
      await reply.code(500).send({ error: "internal_error", message: GENERIC_SERVER_ERROR });
    }
  });
});
