// Sécurité des images, avant tout le reste : sharp ne lit plus que les
// formats JPEG, PNG, WebP, GIF et HEIF/AVIF (lib/imageSafety.ts).
import "./lib/imageSafety.js";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import supabasePlugin from "./plugins/supabase.js";
import authPlugin from "./plugins/auth.js";
import rateLimitPlugin from "./plugins/rateLimit.js";
import moderationPlugin from "./plugins/moderation.js";
import meRoutes from "./routes/me.js";
import searchesRoutes from "./routes/searches.js";
import productMatchesRoutes from "./routes/productMatches.js";
import matchFeedbackRoutes from "./routes/matchFeedback.js";
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
import moderationRoutes from "./routes/moderation.js";
import piecesRoutes from "./routes/pieces.js";
import searchCapacityRoutes from "./routes/searchCapacity.js";
import appVersionRoutes from "./routes/appVersion.js";
import { captureServerError, captureServerFailure } from "./lib/sentry.js";
import { GENERIC_CLIENT_ERROR, isErrorBody, localizeMessage } from "./lib/messages.js";
import { requestLocale } from "./lib/locale.js";
import { APP_BUILD_HEADER } from "@monapp/shared-types";
import { env } from "./env.js";
import { buildFromHeader, isBelowMinimum, isVersionGuardExempt, updateRequiredBody } from "./lib/appVersion.js";
import { requestLogFields, scrubLogLine, withoutErrorDetails } from "./lib/logPrivacy.js";

/** La base répond-elle en 3 secondes ? Une lecture sans ligne (limit 0). */
async function databaseResponds(fastify: FastifyInstance): Promise<boolean> {
  try {
    const { error } = await fastify.supabaseAdmin.from("serpapi_calls").select("id").limit(0).abortSignal(AbortSignal.timeout(3_000));
    return !error;
  } catch {
    return false;
  }
}

type LoggerOption = FastifyServerOptions["logger"];

/** Journal de Fastify, sans donnée personnelle (lib/logPrivacy.ts) : route
 * déclarée au lieu de l'adresse, erreurs réduites à leur nom et leur code.
 * Les options d'un test (niveau, flux) s'y ajoutent ; « false » le coupe. */
function loggerOptions(logger: LoggerOption): LoggerOption {
  if (logger === false) return false;
  const custom = typeof logger === "object" && logger !== null ? logger : {};
  return {
    ...custom,
    serializers: { req: requestLogFields, ...custom.serializers },
    formatters: { log: withoutErrorDetails, ...custom.formatters },
    hooks: { streamWrite: scrubLogLine, ...custom.hooks },
  };
}

// Requêtes dont l'erreur a déjà été transmise à Sentry (évite un doublon).
const reportedToSentry = new Set<string>();

// Séparé de server.ts pour que les tests puissent construire l'app et
// l'interroger via `.inject()` sans jamais ouvrir de vrai port réseau. Les
// tests peuvent aussi lire les journaux (ex. : jamais de contenu journalisé).
export async function buildApp(options: { logger?: LoggerOption } = {}): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: loggerOptions(options.logger ?? true) });

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

  // Mise à jour obligatoire de l'app iPhone (lot « app iPhone prête »,
  // lib/appVersion.ts) : un build sous le minimum réglé chez Render reçoit
  // 426 sur tout appel, avant toute vérification de compte. Sans minimum
  // (par défaut), ou sans numéro de build (le site), rien ne change.
  fastify.addHook("onRequest", async (request, reply) => {
    if (isVersionGuardExempt(request.url)) return;
    if (!isBelowMinimum(buildFromHeader(request.headers[APP_BUILD_HEADER]), env.APP_MIN_IOS_BUILD)) return;
    return reply.code(426).send(updateRequiredBody(env.APP_STORE_URL));
  });

  await fastify.register(supabasePlugin);
  await fastify.register(authPlugin);
  await fastify.register(rateLimitPlugin);
  await fastify.register(moderationPlugin);
  await fastify.register(meRoutes);
  await fastify.register(searchesRoutes);
  await fastify.register(productMatchesRoutes);
  await fastify.register(matchFeedbackRoutes);
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
  await fastify.register(moderationRoutes);
  await fastify.register(piecesRoutes);
  await fastify.register(searchCapacityRoutes);
  await fastify.register(appVersionRoutes);

  // Exclue du filet anti-abus "default" : les sondes de disponibilité de
  // Render l'appellent très régulièrement, ça n'a rien à voir avec un abus.
  // Elle ne dit que « le serveur répond » : Render s'en sert pour savoir si
  // une mise en ligne a démarré ; une panne de la base ne doit pas la faire échouer.
  // « version » (lot « filets de sécurité ») : les 7 premiers caractères du
  // commit en service, ou null hors de Render (lib/serverVersion.ts). Rien
  // d'autre : ni réglage, ni adresse, ni nom de service.
  fastify.get("/health", { config: { skipDefaultRateLimit: true } }, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { status: "ok", version: env.RENDER_GIT_COMMIT };
  });

  // Adresse inconnue : même réponse qu'avec Fastify (404, message général,
  // traduit par preSerialization), mais sans sa ligne « Route GET:/… not
  // found », qui recopiait l'adresse entière dans le journal (lot « filets
  // de sécurité », lib/logPrivacy.ts).
  fastify.setNotFoundHandler(async (_request, reply) => reply.code(404).send({ error: "Not Found", message: GENERIC_CLIENT_ERROR, statusCode: 404 }));

  // Sonde complète (lot garde-fous), pour une surveillance extérieure toutes
  // les 5 minutes : le serveur répond ET la base aussi. 503 si la base ne
  // répond pas en 3 secondes. Rien de personnel : une lecture vide d'une
  // table sans données personnelles. Garde le filet anti-abus par défaut.
  fastify.get("/health/deep", async (request, reply) => {
    const database = await databaseResponds(fastify);
    if (!database) request.log.error("Sonde complète : la base ne répond pas");
    return reply
      .code(database ? 200 : 503)
      .header("Cache-Control", "no-store")
      .send({ status: database ? "ok" : "degraded", database: database ? "ok" : "unreachable" });
  });

  return fastify;
}
