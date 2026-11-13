// Sentry d'abord (voir instrument.ts).
import "./instrument.js";
import { env } from "./env.js";
import { buildApp } from "./app.js";
import { scheduleLeaseCleanup } from "./lib/wishAlertsSend.js";

const fastify = await buildApp();

fastify
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then((address) => {
    fastify.log.info(`Backend démarré sur ${address}`);
    // Alertes prix et stock (0041) : un arrêt brutal a pu laisser des
    // réservations ; un passage de ménage 16 minutes après le démarrage.
    scheduleLeaseCleanup(fastify);
  })
  .catch((error) => {
    fastify.log.error(error);
    process.exit(1);
  });
