// Appareils qui reçoivent les notifications des nouveaux messages (lot
// notifications, migration 0035, lib/push.ts). L'app iPhone enregistre son
// jeton d'Expo quand la personne accepte les notifications (et le rafraîchit
// à l'ouverture), et l'oublie quand elle les coupe ou se déconnecte.
// Un réglage personnel : permis à un compte suspendu, comme les autres.
// Lot alertes prix (0036) : `messages` et `alerts` disent ce que reçoit cet
// appareil ; `messages: false` le garde pour les seules alertes (aucune
// notification de message ne lui est envoyée), les deux à false l'oublient.
// Lot « durcissement des alertes » (revue de sécurité) : POST
// /api/push-token/forget oublie un appareil par son seul jeton, SANS session
// (avoir le jeton, c'est être cet appareil) : l'app l'appelle quand la
// session a été fermée ailleurs, ou que l'oubli normal a échoué (hors réseau),
// jusqu'à ce qu'il réussisse. Réponse 204 que le jeton ait existé ou non
// (rien n'est appris). Limite : 10 par heure et par appareil (empreinte du
// jeton, jamais l'adresse IP, souvent commune chez l'hébergeur), et un
// plafond commun large pour tout le service.
// Jamais le jeton dans le journal : seulement le système de l'appareil.
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { consumeRateLimitFor } from "../plugins/rateLimit.js";
import { RATE_LIMITS } from "../lib/rateLimits.js";
import { GENERIC_SERVER_ERROR } from "../lib/messages.js";
import {
  INVALID_PUSH_TOKEN,
  PUSH_UNAVAILABLE,
  deletePushToken,
  deletePushTokenSchema,
  forgetPushTokenEverywhere,
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
      await savePushToken(fastify, request.user!.id, body.token, body.platform, { messages: body.messages, alerts: body.alerts });
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

  // Oublier cet appareil sans session (déconnexion forcée, oubli normal
  // échoué). Toujours 204, que le jeton ait été enregistré ou non : la
  // réponse ne dit jamais si un jeton existe. Sans la migration 0035, il n'y
  // a rien à oublier.
  fastify.post(
    "/api/push-token/forget",
    { preHandler: [fastify.rateLimit("pushTokenForgetGlobal")], config: { rateLimitName: "pushTokenForgetGlobal" as const } },
    async (request, reply) => {
      const body = parseInput(deletePushTokenSchema, request.body, reply, INVALID_PUSH_TOKEN);
      if (!body) return;
      const device = createHash("sha256").update(body.token).digest("hex");
      const limit = consumeRateLimitFor(device, "pushTokenForget");
      if (!limit.allowed) {
        reply.header("Retry-After", Math.ceil(limit.retryAfterMs / 1000).toString());
        return reply.code(429).send({ error: RATE_LIMITS.pushTokenForget.error, message: RATE_LIMITS.pushTokenForget.message });
      }
      if (!(await pushReady(fastify))) return reply.code(204).send();
      try {
        await forgetPushTokenEverywhere(fastify, body.token);
      } catch (error) {
        request.log.error({ error }, "Appareil non oublié pour les notifications (sans session)");
        return reply.code(500).send(SERVER_ERROR);
      }
      return reply.code(204).send();
    }
  );
}
