import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MERCHANT_LINK_CONTEXTS } from "@monapp/shared-types";
import { INVALID_ID, idParamsSchema, parseInput } from "../lib/validation.js";

const clickBodySchema = z.object({ context: z.enum(MERCHANT_LINK_CONTEXTS).optional() }).optional();

export default async function productMatchesRoutes(fastify: FastifyInstance) {
  // Enregistre le clic sortant vers le marchand (pour le calcul futur des
  // commissions) puis renvoie l'URL à ouvrir. Le mobile appelle cette route
  // avant d'ouvrir le lien, plutôt que d'ouvrir merchant_url directement.
  fastify.post("/api/product-matches/:id/click", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const { id } = params;
    const userId = request.user!.id;
    const parsedBody = clickBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "invalid_body", message: "Contexte de clic invalide." });
    }
    const context = parsedBody.data?.context ?? null;

    const { data: match, error: matchError } = await fastify.supabaseAdmin
      .from("product_matches")
      .select("id, search_id")
      .eq("id", id)
      .single();

    if (matchError || !match) {
      return reply.code(404).send({ error: "match_not_found", message: "Produit introuvable." });
    }

    // Vérifie que la recherche parente appartient bien à l'utilisateur
    // authentifié, pour ne pas laisser quelqu'un tracker un clic (ou
    // découvrir un lien) sur les recherches d'un autre utilisateur.
    const { data: search, error: searchError } = await fastify.supabaseAdmin
      .from("product_searches")
      .select("id")
      .eq("id", match.search_id)
      .eq("user_id", userId)
      .single();

    if (searchError || !search) {
      return reply.code(404).send({ error: "match_not_found", message: "Produit introuvable." });
    }

    const { data: link, error: linkError } = await fastify.supabaseAdmin
      .from("affiliate_links")
      .select("id, affiliate_url")
      .eq("product_match_id", id)
      .single();

    if (linkError || !link) {
      request.log.error({ linkError }, "Aucun affiliate_link pour ce product_match");
      return reply.code(404).send({ error: "link_not_found", message: "Lien marchand introuvable." });
    }

    const { error: clickError } = await fastify.supabaseAdmin.from("affiliate_clicks").insert({
      affiliate_link_id: link.id,
      user_id: userId,
      context,
      user_agent: request.headers["user-agent"] ?? null,
    });

    if (clickError) {
      // On ne bloque jamais l'utilisateur pour un échec de tracking : il
      // doit pouvoir accéder au marchand même si le clic n'a pas pu être
      // enregistré. On le journalise pour investigation.
      request.log.error({ clickError }, "Échec d'enregistrement du clic affilié");
    }

    return reply.send({ url: link.affiliate_url });
  });
}
