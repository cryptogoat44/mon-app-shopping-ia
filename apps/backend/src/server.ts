import { env } from "./env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import supabasePlugin from "./plugins/supabase.js";
import authPlugin from "./plugins/auth.js";
import meRoutes from "./routes/me.js";

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true });
await fastify.register(supabasePlugin);
await fastify.register(authPlugin);
await fastify.register(meRoutes);

fastify.get("/health", async () => ({ status: "ok" }));

fastify
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then((address) => fastify.log.info(`Backend démarré sur ${address}`))
  .catch((error) => {
    fastify.log.error(error);
    process.exit(1);
  });
