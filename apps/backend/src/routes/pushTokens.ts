// Appareils qui reçoivent les notifications des nouveaux messages (lot
// notifications, migration 0035, lib/push.ts). L'app iPhone enregistre son
// jeton d'Expo quand la personne accepte les notifications (et le rafraîchit
// à l'ouverture), et l'oublie quand elle les coupe ou se déconnecte.
// Un réglage personnel : permis à un compte suspendu, comme les autres.
// Jamais le jeton dans le journal : seulement le système de l'appareil.
import type { FastifyInstance } from "fastify";
import { GENERIC_SERVER_ERROR } from "../lib/messages.js";
import {
  INVALID_PUSH_TOKEN,
  PUSH_UNAVAILABLE,
  deletePushToken,
  deletePushTokenSchema,
  pushAvailable,
  pushReady,
  registerPushTokenSchema,
  savePushToken,
} from "../lib/push.js";
import { parseInput } from "../lib/validation.js";

const SERVER_ERROR = { error: "internal_error", message: GENERIC_SERVER_ERROR } as const;

export default async function pushTokensRoutes(fastify: FastifyInstance) {
  const options = { preHandler: [fastify.requireAuth, fastify.rateLimit("pushToken")], config: { rateLimitName: "pushToken" as const } };

  // Enregistrer cet appareil, ou rafraîchir son jeton. Notifications coupées
  // (PUSH_ENABLED) ou migration 0035 absente : 404, rien n'est enregistré.
  fastify.put("/api/me/push-token", options, async (request, reply) => {
    if (!(await pushAvailable(fastify))) return reply.code(404).send(PUSH_UNAVAILABLE);
    const body = parseInput(registerPushTokenSchema, request.body, reply, INVALID_PUSH_TOKEN);
    if (!body) return;
    try {
      await savePushToken(fastify, request.user!.id, body.token, body.platform);
    } catch (error) {
      request.log.error({ error }, "Appareil non enregistré pour les notifications");
      return reply.code(500).send(SERVER_ERROR);
    }
    request.log.info({ platform: body.platform }, "Appareil enregistré pour les notifications");
    return reply.code(204).send();
  });

  // Oublier cet appareil (notifications coupées dans l'app, déconnexion).
  // Toujours permis, même interrupteur coupé : ce qui a été enregistré doit
  // pouvoir partir. Sans la migration 0035, il n'y a rien à oublier.
  fastify.delete("/api/me/push-token", options, async (request, reply) => {
    const body = parseInput(deletePushTokenSchema, request.body, reply, INVALID_PUSH_TOKEN);
    if (!body) return;
    if (!(await pushReady(fastify))) return reply.code(204).send();
    try {
      await deletePushToken(fastify, request.user!.id, body.token);
    } catch (error) {
      request.log.error({ error }, "Appareil non oublié pour les notifications");
      return reply.code(500).send(SERVER_ERROR);
    }
    return reply.code(204).send();
  });
}
