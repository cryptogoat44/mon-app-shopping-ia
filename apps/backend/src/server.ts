import { env } from "./env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import supabasePlugin from "./plugins/supabase.js";
import authPlugin from "./plugins/auth.js";
import meRoutes from "./routes/me.js";
import searchesRoutes from "./routes/searches.js";
import productMatchesRoutes from "./routes/productMatches.js";

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true });
await fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
await fastify.register(supabasePlugin);
await fastify.register(authPlugin);
await fastify.register(meRoutes);
await fastify.register(searchesRoutes);
await fastify.register(productMatchesRoutes);

fastify.get("/health", async () => ({ status: "ok" }));

fastify
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then((address) => fastify.log.info(`Backend démarré sur ${address}`))
  .catch((error) => {
    fastify.log.error(error);
    process.exit(1);
  });
