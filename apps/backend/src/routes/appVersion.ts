import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { appVersionInfo } from "../lib/appVersion.js";

// Lot « app iPhone prête » (chantier 4, point 11) : build minimal exigé de
// l'app iPhone, lu par l'app au démarrage et au retour dans l'app — sans
// compte (l'écran d'accueil aussi doit pouvoir dire « Mettez à jour Spotto »).
// Ne renvoie que deux réglages publics ; jamais servi depuis un cache.
export default async function appVersionRoutes(fastify: FastifyInstance) {
  fastify.get("/api/app/version", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return reply.send(appVersionInfo(env.APP_MIN_IOS_BUILD, env.APP_STORE_URL));
  });
}
