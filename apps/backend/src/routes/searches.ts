import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PlatformSource, ProductSearch, RecognitionMethod, SearchStatus } from "@monapp/shared-types";
import { detectPlatform, fetchOfficialThumbnail } from "../services/oembed.js";
import { searchProductsByImageUrl, type VisualMatch } from "../services/visualSearch.js";
import { isFileTooLargeError } from "../lib/multipartErrors.js";

const createSearchSchema = z.object({
  sourceUrl: z.string().url(),
});

const SIGNED_URL_TTL_SECONDS = 300;

interface ProductSearchRow {
  id: string;
  user_id: string;
  source_url: string;
  source_platform: PlatformSource;
  method: RecognitionMethod;
  thumbnail_url: string | null;
  screenshot_url: string | null;
  status: SearchStatus;
  error_message: string | null;
  created_at: string;
}

interface ProductMatchRow {
  id: string;
  rank: number;
  product_name: string;
  brand: string | null;
  image_url: string;
  price_min: string | null;
  price_max: string | null;
  currency: string | null;
  merchant_name: string | null;
  merchant_url: string;
}

function toProductSearch(row: ProductSearchRow, matches: ProductMatchRow[]): ProductSearch {
  return {
    id: row.id,
    sourceUrl: row.source_url,
    sourcePlatform: row.source_platform,
    method: row.method,
    thumbnailUrl: row.thumbnail_url,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    matches: matches
      .sort((a, b) => a.rank - b.rank)
      .map((m) => ({
        id: m.id,
        rank: m.rank,
        productName: m.product_name,
        brand: m.brand,
        imageUrl: m.image_url,
        priceMin: m.price_min !== null ? Number(m.price_min) : null,
        priceMax: m.price_max !== null ? Number(m.price_max) : null,
        currency: m.currency,
        merchantName: m.merchant_name,
        merchantUrl: m.merchant_url,
      })),
  };
}

async function saveMatches(
  fastify: FastifyInstance,
  searchId: string,
  matches: VisualMatch[]
): Promise<void> {
  if (matches.length === 0) return;

  const { error } = await fastify.supabaseAdmin.from("product_matches").insert(
    matches.map((m) => ({
      search_id: searchId,
      rank: m.rank,
      product_name: m.productName,
      image_url: m.imageUrl,
      price_min: m.priceValue,
      price_max: m.priceValue,
      currency: m.currency ?? "EUR",
      merchant_name: m.merchantName,
      merchant_url: m.merchantUrl,
    }))
  );

  if (error) {
    fastify.log.error({ error }, "Échec d'enregistrement des product_matches");
    return;
  }

  // Un lien affilié par produit identifié. Pour l'instant "direct" (aucun
  // réseau d'affiliation rejoint) : le lien pointe tel quel vers le
  // marchand, sans commission. Le tracking de clic est déjà en place pour
  // qu'il suffise de changer affiliate_url le jour où un programme
  // d'affiliation (Awin, Rakuten, CJ...) est rejoint pour ce marchand.
  const { data: insertedMatches, error: fetchError } = await fastify.supabaseAdmin
    .from("product_matches")
    .select("id, merchant_url")
    .eq("search_id", searchId);

  if (fetchError || !insertedMatches) {
    fastify.log.error({ fetchError }, "Impossible de relire les product_matches pour créer les liens affiliés");
    return;
  }

  const { error: linksError } = await fastify.supabaseAdmin.from("affiliate_links").insert(
    (insertedMatches as { id: string; merchant_url: string }[]).map((m) => ({
      product_match_id: m.id,
      network: "direct",
      affiliate_url: m.merchant_url,
    }))
  );

  if (linksError) {
    fastify.log.error({ linksError }, "Échec d'enregistrement des affiliate_links");
  }
}

export default async function searchesRoutes(fastify: FastifyInstance) {
  // Étape 1 : voie officielle (oEmbed). Si elle échoue ou ne donne rien
  // d'exploitable, la recherche reste en statut "failed" avec method
  // "manual_screenshot" : le mobile propose alors l'import d'une capture.
  fastify.post("/api/searches", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const parsed = createSearchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", message: "URL manquante ou invalide." });
    }

    const userId = request.user!.id;
    const { sourceUrl } = parsed.data;
    const platform = detectPlatform(sourceUrl);

    const thumbnail = await fetchOfficialThumbnail(sourceUrl, platform);

    const { data: inserted, error: insertError } = await fastify.supabaseAdmin
      .from("product_searches")
      .insert({
        user_id: userId,
        source_url: sourceUrl,
        source_platform: platform,
        method: thumbnail ? "oembed" : "manual_screenshot",
        thumbnail_url: thumbnail?.thumbnailUrl ?? null,
        status: thumbnail ? "processing" : "pending",
      })
      .select("*")
      .single();

    if (insertError || !inserted) {
      request.log.error({ insertError }, "Échec de création de product_searches");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const row = inserted as ProductSearchRow;

    if (!thumbnail) {
      // Pas de voie officielle disponible pour ce lien : on s'arrête ici,
      // le mobile va appeler /screenshot avec une capture importée par l'utilisateur.
      return reply.send(toProductSearch(row, []));
    }

    try {
      const matches = await searchProductsByImageUrl(thumbnail.thumbnailUrl);
      await saveMatches(fastify, row.id, matches);

      const finalStatus: SearchStatus = matches.length > 0 ? "completed" : "failed";
      const errorMessage = matches.length > 0 ? null : "Aucun produit identifié sur la miniature.";

      const { data: updated } = await fastify.supabaseAdmin
        .from("product_searches")
        .update({ status: finalStatus, error_message: errorMessage })
        .eq("id", row.id)
        .select("*")
        .single();

      const { data: matchRows } = await fastify.supabaseAdmin
        .from("product_matches")
        .select("*")
        .eq("search_id", row.id);

      return reply.send(toProductSearch((updated as ProductSearchRow) ?? row, (matchRows as ProductMatchRow[]) ?? []));
    } catch (error) {
      request.log.error({ error }, "Échec de l'appel à l'API de recherche visuelle");
      await fastify.supabaseAdmin
        .from("product_searches")
        .update({ status: "failed", error_message: "La recherche visuelle a échoué." })
        .eq("id", row.id);

      return reply.send(
        toProductSearch({ ...row, status: "failed", error_message: "La recherche visuelle a échoué." }, [])
      );
    }
  });

  // Étape 2 (repli) : l'utilisateur importe une capture d'écran du bon
  // instant de la vidéo, on l'envoie à la recherche visuelle à sa place.
  fastify.post("/api/searches/:id/screenshot", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;

    const { data: search, error: fetchError } = await fastify.supabaseAdmin
      .from("product_searches")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (fetchError || !search) {
      return reply.code(404).send({ error: "search_not_found", message: "Recherche introuvable." });
    }

    const file = await request.file();
    if (!file || !file.mimetype.startsWith("image/")) {
      return reply.code(400).send({ error: "invalid_file", message: "Merci d'envoyer une image." });
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (error) {
      if (isFileTooLargeError(error)) {
        return reply.code(413).send({ error: "file_too_large", message: "Le fichier est trop volumineux (10 Mo maximum)." });
      }
      throw error;
    }
    const extension = file.mimetype.split("/")[1] ?? "jpg";
    const storagePath = `${userId}/${id}.${extension}`;

    const { error: uploadError } = await fastify.supabaseAdmin.storage
      .from("screenshots")
      .upload(storagePath, buffer, { contentType: file.mimetype, upsert: true });

    if (uploadError) {
      request.log.error({ uploadError }, "Échec d'upload de la capture d'écran");
      return reply.code(500).send({ error: "upload_failed", message: "L'envoi de l'image a échoué." });
    }

    const { data: signedUrlData, error: signedUrlError } = await fastify.supabaseAdmin.storage
      .from("screenshots")
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

    if (signedUrlError || !signedUrlData) {
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    let finalStatus: SearchStatus = "completed";
    let errorMessage: string | null = null;
    let matches: VisualMatch[] = [];

    try {
      matches = await searchProductsByImageUrl(signedUrlData.signedUrl);
      if (matches.length === 0) {
        finalStatus = "failed";
        errorMessage = "Aucun produit identifié sur cette image.";
      }
    } catch (error) {
      request.log.error({ error }, "Échec de l'appel à l'API de recherche visuelle (capture manuelle)");
      finalStatus = "failed";
      errorMessage = "La recherche visuelle a échoué.";
    }

    await saveMatches(fastify, id, matches);

    const { data: updated } = await fastify.supabaseAdmin
      .from("product_searches")
      .update({ screenshot_url: storagePath, status: finalStatus, error_message: errorMessage })
      .eq("id", id)
      .select("*")
      .single();

    const { data: matchRows } = await fastify.supabaseAdmin.from("product_matches").select("*").eq("search_id", id);

    return reply.send(
      toProductSearch((updated as ProductSearchRow) ?? search, (matchRows as ProductMatchRow[]) ?? [])
    );
  });

  fastify.get("/api/searches/:id", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;

    const { data: search, error } = await fastify.supabaseAdmin
      .from("product_searches")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (error || !search) {
      return reply.code(404).send({ error: "search_not_found", message: "Recherche introuvable." });
    }

    const { data: matchRows } = await fastify.supabaseAdmin.from("product_matches").select("*").eq("search_id", id);

    return reply.send(toProductSearch(search as ProductSearchRow, (matchRows as ProductMatchRow[]) ?? []));
  });
}
