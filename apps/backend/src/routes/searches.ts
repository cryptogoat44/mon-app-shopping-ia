import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  SEARCH_FAILURE_MESSAGES,
  SEARCH_QUERY_MAX_LENGTH,
  type PlatformSource,
  type ProductSearch,
  type RecognitionMethod,
  type SearchStatus,
} from "@monapp/shared-types";
import { detectPlatform, fetchOfficialPreview } from "../services/oembed.js";
import { searchProductsByImageUrl, type VisualMatch } from "../services/visualSearch.js";
import { isFileTooLargeError } from "../lib/multipartErrors.js";
import { fetchAffiliateUrls } from "../lib/affiliateLinks.js";
import { INVALID_ID, idParamsSchema, parseInput } from "../lib/validation.js";
import { ImageSourceError, downloadThumbnail, prepareImageForAnalysis } from "../lib/imageProcessing.js";

const createSearchSchema = z.object({
  sourceUrl: z.string().url().max(2048).optional(),
});

const SIGNED_URL_TTL_SECONDS = 300;

const NO_MATCH_MESSAGE = SEARCH_FAILURE_MESSAGES.noMatch;
const TECHNICAL_FAILURE_MESSAGE = SEARCH_FAILURE_MESSAGES.technical;

const cropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0.05).max(1),
    height: z.number().min(0.05).max(1),
  })
  // Petite tolérance aux arrondis de l'app, jamais au-delà de l'image.
  .refine((c) => c.x + c.width <= 1.001 && c.y + c.height <= 1.001);

const runSearchSchema = z.object({
  crop: cropSchema.optional(),
  query: z.string().max(SEARCH_QUERY_MAX_LENGTH).optional(),
});

interface ProductSearchRow {
  id: string;
  user_id: string;
  source_url: string | null;
  source_platform: PlatformSource;
  method: RecognitionMethod;
  thumbnail_url: string | null;
  screenshot_url: string | null;
  status: SearchStatus;
  error_message: string | null;
  query: string | null;
  created_at: string;
}

interface ProductMatchRow {
  id: string;
  search_id?: string;
  rank: number;
  product_name: string;
  brand: string | null;
  image_url: string;
  image_hd_url: string | null;
  price_min: string | null;
  price_max: string | null;
  currency: string | null;
  merchant_name: string | null;
  merchant_url: string;
}

function toProductSearch(
  row: ProductSearchRow,
  matches: ProductMatchRow[],
  affiliateUrlByMatchId: Map<string, string>
): ProductSearch {
  return {
    id: row.id,
    sourceUrl: row.source_url,
    sourcePlatform: row.source_platform,
    method: row.method,
    thumbnailUrl: row.thumbnail_url,
    status: row.status,
    errorMessage: row.error_message,
    query: row.query ?? null,
    createdAt: row.created_at,
    matches: matches
      .sort((a, b) => a.rank - b.rank)
      .map((m) => ({
        id: m.id,
        rank: m.rank,
        productName: m.product_name,
        brand: m.brand,
        imageUrl: m.image_url,
        imageHdUrl: m.image_hd_url ?? null,
        priceMin: m.price_min !== null ? Number(m.price_min) : null,
        priceMax: m.price_max !== null ? Number(m.price_max) : null,
        currency: m.currency,
        merchantName: m.merchant_name,
        merchantUrl: m.merchant_url,
        // Repli sur merchant_url si le lien affilié manque (échec d'écriture
        // ponctuel dans saveMatches) — toujours une URL valide à ouvrir.
        affiliateUrl: affiliateUrlByMatchId.get(m.id) ?? m.merchant_url,
      })),
  };
}

// RGPD : l'image analysée (capture importée ou zone recadrée) n'est
// stockée que le temps que SerpApi la lise, via une adresse temporaire
// signée. Elle est supprimée dès la réponse, que la recherche réussisse ou
// échoue : rien ne la réutilise ensuite (l'app garde sa propre copie pour
// « Recadrer », l'historique affiche les images des produits). Un échec de
// suppression est journalisé sans bloquer l'utilisateur.
async function discardAnalysisImage(fastify: FastifyInstance, storagePath: string): Promise<void> {
  const { error } = await fastify.supabaseAdmin.storage.from("screenshots").remove([storagePath]);
  if (error) fastify.log.warn({ error, storagePath }, "Image analysée non supprimée après la recherche");
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
      image_hd_url: m.imageHdUrl,
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

const RECENT_SEARCHES_DEFAULT_LIMIT = 6;
const RECENT_SEARCHES_MAX_LIMIT = 20;

const recentSearchesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

export default async function searchesRoutes(fastify: FastifyInstance) {
  // Alimente "Récemment spottées" (Spotter et le sélecteur de pièces de
  // Publier) : les recherches réussies les plus récentes, avec seulement
  // leur meilleur résultat (plus petit rang) — le mobile n'affiche qu'une vignette
  // par recherche, pas la liste complète des correspondances.
  fastify.get("/api/searches", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;
    const query = parseInput(recentSearchesQuerySchema, request.query, reply, {
      error: "invalid_query",
      message: "Paramètre de liste invalide.",
    });
    if (!query) return;
    const limit = Math.min(query.limit ?? RECENT_SEARCHES_DEFAULT_LIMIT, RECENT_SEARCHES_MAX_LIMIT);

    const { data: searches, error } = await fastify.supabaseAdmin
      .from("product_searches")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      request.log.error({ error }, "Échec de lecture de l'historique des recherches");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const rows = (searches as ProductSearchRow[]) ?? [];
    if (rows.length === 0) {
      return reply.send([]);
    }

    const { data: matchRows, error: matchError } = await fastify.supabaseAdmin
      .from("product_matches")
      .select("*")
      .in("search_id", rows.map((row) => row.id))
      .order("rank", { ascending: true });

    if (matchError) {
      request.log.error({ matchError }, "Échec de lecture des meilleurs résultats de l'historique");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    // Meilleur résultat = le plus petit rang EXISTANT de chaque recherche,
    // pas forcément le rang 1 : les rangs viennent de Google Lens avant le
    // filtrage des réseaux sociaux, et une recherche dont le 1ᵉʳ résultat
    // était un TikTok disparaissait de « Récemment spottées » et du
    // sélecteur de pièces de Publier (audit Lot Q, ROB-04).
    const topMatchBySearch = new Map<string, ProductMatchRow>();
    for (const match of (matchRows as ProductMatchRow[]) ?? []) {
      if (match.search_id && !topMatchBySearch.has(match.search_id)) topMatchBySearch.set(match.search_id, match);
    }

    const affiliateUrlByMatchId = await fetchAffiliateUrls(
      fastify,
      Array.from(topMatchBySearch.values()).map((m) => m.id)
    );

    return reply.send(
      rows
        .map((row) => {
          const topMatch = topMatchBySearch.get(row.id);
          return topMatch ? toProductSearch(row, [topMatch], affiliateUrlByMatchId) : null;
        })
        .filter((search): search is ProductSearch => search !== null)
    );
  });

  // ---------------------------------------------------------------------
  // Spotter en deux temps (Lot S). Les routes historiques POST /api/searches
  // et /:id/screenshot ont été retirées au bloc 3 du Lot Q, une fois le
  // nouveau site en ligne (plus aucun appel ne les utilisait).
  // ---------------------------------------------------------------------

  // Temps 1 — PRÉPARER (gratuit, aucun appel SerpApi) : crée la recherche
  // et récupère par la voie officielle l'image qui sera analysée, pour que
  // l'utilisateur la VOIE avant de lancer quoi que ce soit (aperçu). Sans
  // lien (import d'une photo) ou sans vignette officielle, la recherche
  // attend simplement une image au lancement.
  fastify.post("/api/searches/prepare", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const body = parseInput(createSearchSchema, request.body ?? {}, reply, {
      error: "invalid_body",
      message: "Lien invalide.",
    });
    if (!body) return;

    const userId = request.user!.id;
    const sourceUrl = body.sourceUrl ?? null;
    const platform: PlatformSource = sourceUrl ? detectPlatform(sourceUrl) : "photo";
    const preview = sourceUrl ? await fetchOfficialPreview(sourceUrl, platform) : null;
    const thumbnail = preview?.ok ? { thumbnailUrl: preview.thumbnailUrl } : null;

    const { data: inserted, error } = await fastify.supabaseAdmin
      .from("product_searches")
      .insert({
        user_id: userId,
        source_url: sourceUrl,
        source_platform: platform,
        method: thumbnail ? "oembed" : "manual_screenshot",
        thumbnail_url: thumbnail?.thumbnailUrl ?? null,
        status: "pending",
      })
      .select("*")
      .single();

    if (error || !inserted) {
      request.log.error({ error }, "Échec de préparation d'une recherche");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    // Sans image : la raison précise, pour que l'app dise quoi faire.
    const previewIssue = preview && !preview.ok ? preview.issue : null;
    return reply.send({ ...toProductSearch(inserted as ProductSearchRow, [], new Map()), previewIssue });
  });

  // Temps 2 — LANCER (1 crédit SerpApi, une seule fois par recherche) :
  // formulaire multipart avec, au choix, une image importée (champ
  // "file" — photo ou capture au bon moment de la vidéo) ou, à défaut, la
  // vignette officielle préparée au temps 1 ; plus la zone choisie ("crop",
  // JSON en proportions 0–1) et le texte facultatif ("query"). Le serveur
  // recadre lui-même : identique sur le web et sur iPhone, et sans les
  // restrictions du navigateur sur les images d'un autre site.
  fastify.post(
    "/api/searches/:id/run",
    {
      preHandler: [fastify.requireAuth, fastify.rateLimitCheck("searchCreate")],
      config: { rateLimitName: "searchCreate" },
    },
    async (request, reply) => {
      const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
      if (!params) return;
      const { id } = params;
      const userId = request.user!.id;

      if (!request.isMultipart()) {
        return reply.code(400).send({ error: "invalid_body", message: "Requête invalide." });
      }

      const fields: Record<string, string> = {};
      let fileBuffer: Buffer | null = null;
      try {
        for await (const part of request.parts()) {
          if (part.type === "file") {
            fileBuffer = await part.toBuffer();
          } else {
            fields[part.fieldname] = String(part.value);
          }
        }
      } catch (error) {
        if (isFileTooLargeError(error)) {
          return reply.code(413).send({ error: "file_too_large", message: "Le fichier est trop volumineux (10 Mo maximum)." });
        }
        throw error;
      }

      let rawCrop: unknown = undefined;
      if (fields.crop) {
        try {
          rawCrop = JSON.parse(fields.crop);
        } catch {
          return reply.code(400).send({ error: "invalid_body", message: "Zone de recadrage invalide." });
        }
      }
      const input = parseInput(runSearchSchema, { crop: rawCrop, query: fields.query }, reply, {
        error: "invalid_body",
        message: "Zone de recadrage ou texte invalide.",
      });
      if (!input) return;
      const query = input.query?.trim() || null;

      const { data: search } = await fastify.supabaseAdmin
        .from("product_searches")
        .select("*")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!search) {
        return reply.code(404).send({ error: "search_not_found", message: "Recherche introuvable." });
      }
      const row = search as ProductSearchRow;
      if (row.status !== "pending") {
        return reply.code(409).send({ error: "search_already_run", message: "Cette recherche a déjà été lancée." });
      }

      // Image source : celle importée en priorité, sinon la vignette officielle.
      let source: Buffer;
      try {
        if (fileBuffer) {
          source = fileBuffer;
        } else if (row.thumbnail_url) {
          source = await downloadThumbnail(row.thumbnail_url);
        } else {
          return reply.code(400).send({ error: "image_required", message: "Importez une capture de la pièce." });
        }
      } catch (error) {
        request.log.warn({ error }, "Vignette officielle indisponible au lancement");
        return reply.code(422).send({
          error: "preview_unavailable",
          message: "L'image de la vidéo n'est plus disponible. Importez une capture de la pièce.",
        });
      }

      let prepared: Buffer;
      try {
        prepared = await prepareImageForAnalysis(source, input.crop ?? null);
      } catch (error) {
        if (error instanceof ImageSourceError) {
          return reply.code(400).send({ error: "invalid_image", message: "Cette image n'a pas pu être lue, ou la zone choisie est trop petite." });
        }
        throw error;
      }

      // Verrou : passe de "pending" à "processing" en une seule instruction
      // conditionnelle. Deux lancements simultanés (double appui, réseau
      // lent) ne peuvent pas consommer deux crédits : le second ne trouve
      // plus de ligne "pending" et reçoit 409 (audit Lot Q, ROB-03).
      const { data: locked } = await fastify.supabaseAdmin
        .from("product_searches")
        .update({ status: "processing", query })
        .eq("id", id)
        .eq("status", "pending")
        .select("id");
      if (!locked || locked.length === 0) {
        return reply.code(409).send({ error: "search_already_run", message: "Cette recherche a déjà été lancée." });
      }

      const storagePath = `${userId}/${id}.jpg`;
      const { error: uploadError } = await fastify.supabaseAdmin.storage
        .from("screenshots")
        .upload(storagePath, prepared, { contentType: "image/jpeg", upsert: true });
      const signed = uploadError
        ? null
        : await fastify.supabaseAdmin.storage.from("screenshots").createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
      if (uploadError || !signed?.data) {
        request.log.error({ uploadError }, "Échec d'envoi de l'image recadrée");
        if (!uploadError) await discardAnalysisImage(fastify, storagePath);
        await fastify.supabaseAdmin.from("product_searches").update({ status: "pending" }).eq("id", id);
        return reply.code(500).send({ error: "upload_failed", message: "L'envoi de l'image a échoué, réessayez." });
      }

      // « Annuler » dans l'app coupe la connexion : si c'est déjà fait à ce
      // stade, on n'appelle pas SerpApi (aucun crédit consommé) et la
      // recherche redevient lançable. Passé ce point, le crédit est engagé
      // — l'app ne promet jamais de le rembourser.
      if (request.raw.socket?.destroyed) {
        await discardAnalysisImage(fastify, storagePath);
        await fastify.supabaseAdmin.from("product_searches").update({ status: "pending" }).eq("id", id);
        return;
      }

      let finalStatus: SearchStatus = "completed";
      let errorMessage: string | null = null;
      let matches: VisualMatch[] = [];
      fastify.countRateLimitHit(request, "searchCreate");
      try {
        matches = await searchProductsByImageUrl(fastify, signed.data.signedUrl, { query });
        if (matches.length === 0) {
          finalStatus = "failed";
          errorMessage = NO_MATCH_MESSAGE;
        }
      } catch (error) {
        request.log.error({ error }, "Échec de l'appel à l'API de recherche visuelle (lancement)");
        finalStatus = "failed";
        errorMessage = TECHNICAL_FAILURE_MESSAGE;
      }

      await discardAnalysisImage(fastify, storagePath);
      await saveMatches(fastify, id, matches);

      const { data: updated } = await fastify.supabaseAdmin
        .from("product_searches")
        .update({ screenshot_url: null, status: finalStatus, error_message: errorMessage })
        .eq("id", id)
        .select("*")
        .single();

      const { data: matchRows } = await fastify.supabaseAdmin.from("product_matches").select("*").eq("search_id", id);
      const rowsForSearch = (matchRows as ProductMatchRow[]) ?? [];
      const affiliateUrlByMatchId = await fetchAffiliateUrls(fastify, rowsForSearch.map((m) => m.id));

      return reply.send(toProductSearch((updated as ProductSearchRow) ?? row, rowsForSearch, affiliateUrlByMatchId));
    }
  );

  fastify.get("/api/searches/:id", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const { id } = params;
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
    const rowsForSearch = (matchRows as ProductMatchRow[]) ?? [];
    const affiliateUrlByMatchId = await fetchAffiliateUrls(fastify, rowsForSearch.map((m) => m.id));

    return reply.send(toProductSearch(search as ProductSearchRow, rowsForSearch, affiliateUrlByMatchId));
  });
}
