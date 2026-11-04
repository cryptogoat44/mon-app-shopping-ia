// Serveur local de la mesure de la voie C (scripts/mesure-voie-c.ts) : le même
// démarrage que src/server.ts — Sentry d'abord, puis l'app entière, sans rien
// changer —, à deux détails près : il n'écoute que sur cette machine
// (127.0.0.1, jamais sur le réseau du Mac), et il s'arrête tout seul si l'outil
// de mesure disparaît (son entrée standard se ferme). Lancé seulement par
// l'outil, avec l'environnement qu'il prépare (voie C allumée pour ce seul
// processus, Sentry retiré).
import "../../../src/instrument.js";
import { env } from "../../../src/env.js";
import { buildApp } from "../../../src/app.js";

process.stdin.on("end", () => process.exit(0));
process.stdin.resume();

const fastify = await buildApp();

fastify
  .listen({ port: env.PORT, host: "127.0.0.1" })
  .then((address) => fastify.log.info(`Backend démarré sur ${address}`))
  .catch((error) => {
    fastify.log.error(error);
    process.exit(1);
  });
