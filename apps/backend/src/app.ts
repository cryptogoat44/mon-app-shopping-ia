import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import supabasePlugin from "./plugins/supabase.js";
import authPlugin from "./plugins/auth.js";
import rateLimitPlugin from "./plugins/rateLimit.js";
import meRoutes from "./routes/me.js";
import searchesRoutes from "./routes/searches.js";
import productMatchesRoutes from "./routes/productMatches.js";
import vaultRoutes from "./routes/vault.js";
import wishlistRoutes from "./routes/wishlist.js";
import usersRoutes from "./routes/users.js";
import followsRoutes from "./routes/follows.js";
import postsRoutes from "./routes/posts.js";
import notificationsRoutes from "./routes/notifications.js";
import accountRoutes from "./routes/account.js";
import blocksRoutes from "./routes/blocks.js";
import reportsRoutes from "./routes/reports.js";
import commentsRoutes from "./routes/comments.js";
import videoMomentsRoutes from "./routes/videoMoments.js";
import { captureServerError, captureServerFailure } from "./lib/sentry.js";
import { isErrorBody, localizeMessage } from "./lib/messages.js";
import { requestLocale } from "./lib/locale.js";

// Requêtes dont l'erreur a déjà été transmise à Sentry (évite un doublon).
const reportedToSentry = new Set<string>();

// Séparé de server.ts pour que les tests puissent construire l'app et
// l'interroger via `.inject()` sans jamais ouvrir de vrai port réseau. Les
// tests peuvent aussi lire les journaux (ex. : jamais de contenu journalisé).
export async function buildApp(options: { logger?: FastifyServerOptions["logger"] } = {}): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: options.logger ?? true });

  await fastify.register(cors, { origin: true });
  await fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  // Déclaré AVANT l'enregistrement des routes : Fastify ne transmet un
  // gestionnaire d'erreurs qu'aux routes enregistrées après lui. Déclaré
  // en fin de fichier (comme avant), il ne s'appliquait à AUCUNE route et
  // les erreurs imprévues renvoyaient leur message interne en anglais
  // (audit Lot Q, SEC-02).
  //
  // Filet de sécurité : sans ça, une erreur non anticipée (fichier trop
  // volumineux, JSON malformé, exception inattendue...) renvoie le format
  // d'erreur par défaut de Fastify — en anglais, et sans respecter le contrat
  // { error, message } que le mobile attend pour afficher un message en français
  // cohérent. Ici on ramène systématiquement vers ce contrat.
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.code === "FST_REQ_FILE_TOO_LARGE") {
      return reply.code(413).send({ error: "file_too_large", message: "Le fichier est trop volumineux (10 Mo maximum)." });
    }

    if (error.validation || (error.statusCode && error.statusCode < 500)) {
      return reply
        .code(error.statusCode ?? 400)
        .send({ error: "invalid_request", message: "Requête invalide." });
    }

    request.log.error({ error }, "Erreur non gérée");
    captureServerError(error, request.user?.id);
    reportedToSentry.add(request.id);
    return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue, réessayez." });
  });

  // Toute autre réponse 500 (renvoyée par une route après avoir géré
  // l'erreur elle-même) est aussi signalée à Sentry, sans doublon.
  fastify.addHook("onResponse", async (request, reply) => {
    if (reportedToSentry.delete(request.id)) return;
    if (reply.statusCode >= 500) {
      captureServerFailure(request.method, request.routeOptions.url ?? "route inconnue", reply.statusCode, request.user?.id);
    }
  });

  // Messages d'erreur dans la langue de l'utilisateur (lot 3) — voir lib/messages.ts.
  fastify.addHook("preSerialization", async (request, reply, payload) => {
    if (reply.statusCode < 400 || !isErrorBody(payload)) return payload;
    return { ...payload, message: localizeMessage(payload.message, reply.statusCode, requestLocale(request)) };
  });

  await fastify.register(supabasePlugin);
  await fastify.register(authPlugin);
  await fastify.register(rateLimitPlugin);
  await fastify.register(meRoutes);
  await fastify.register(searchesRoutes);
  await fastify.register(productMatchesRoutes);
  await fastify.register(vaultRoutes);
  await fastify.register(wishlistRoutes);
  await fastify.register(usersRoutes);
  await fastify.register(followsRoutes);
  await fastify.register(postsRoutes);
  await fastify.register(notificationsRoutes);
  await fastify.register(accountRoutes);
  await fastify.register(blocksRoutes);
  await fastify.register(reportsRoutes);
  await fastify.register(commentsRoutes);
  await fastify.register(videoMomentsRoutes);

  // Exclue du filet anti-abus "default" : les sondes de disponibilité de
  // Render l'appellent très régulièrement, ça n'a rien à voir avec un abus.
  fastify.get("/health", { config: { skipDefaultRateLimit: true } }, async () => ({ status: "ok" }));

  return fastify;
}
