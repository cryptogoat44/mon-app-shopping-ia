import { env } from "./env.js";
import { buildApp } from "./app.js";

const fastify = await buildApp();

fastify
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then((address) => fastify.log.info(`Backend démarré sur ${address}`))
  .catch((error) => {
    fastify.log.error(error);
    process.exit(1);
  });
