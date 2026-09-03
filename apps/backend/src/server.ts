import { env } from "./env.js";
import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import supabasePlugin from "./plugins/supabase.js";
import authPlugin from "./plugins/auth.js";
import meRoutes from "./routes/me.js";
import searchesRoutes from "./routes/searches.js";
import productMatchesRoutes from "./routes/productMatches.js";
import vaultRoutes from "./routes/vault.js";
import usersRoutes from "./routes/users.js";
import followsRoutes from "./routes/follows.js";
import postsRoutes from "./routes/posts.js";
import accountRoutes from "./routes/account.js";

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true });
await fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
await fastify.register(supabasePlugin);
await fastify.register(authPlugin);
await fastify.register(meRoutes);
await fastify.register(searchesRoutes);
await fastify.register(productMatchesRoutes);
await fastify.register(vaultRoutes);
await fastify.register(usersRoutes);
await fastify.register(followsRoutes);
await fastify.register(postsRoutes);
await fastify.register(accountRoutes);

fastify.get("/health", async () => ({ status: "ok" }));

// Filet de sécurité : sans ça, une erreur non anticipée (fichier trop
// volumineux, JSON malformé, exception inattendue...) renvoie le format
// d'erreur par défaut de Fastify — en anglais, et sans respecter le contrat
// { error, message } que le mobile attend pour afficher un message French
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
  return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue, réessayez." });
});

fastify
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then((address) => fastify.log.info(`Backend démarré sur ${address}`))
  .catch((error) => {
    fastify.log.error(error);
    process.exit(1);
  });
