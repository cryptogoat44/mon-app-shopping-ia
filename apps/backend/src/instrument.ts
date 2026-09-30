// Chargé en tout premier par server.ts : Sentry doit être initialisé avant
// le reste du serveur (documentation officielle de Sentry pour Fastify).
import { env } from "./env.js";
import { initSentry } from "./lib/sentry.js";

initSentry(env.SENTRY_DSN, env.SENTRY_ENVIRONMENT);
