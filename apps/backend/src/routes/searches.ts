import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  SEARCH_FAILURE_MESSAGES,
  SEARCH_QUERY_MAX_LENGTH,
  type PlatformSource,
  type ProductSearch,
  type SearchStatus,
} from "@monapp/shared-types";
import { detectPlatform, fetchOfficialPreview } from "../services/oembed.js";
import { LensCallError, searchProductsByImageUrl, type VisualMatch } from "../services/visualSearch.js";
import { parseMatchRows, parseSearchRow, parseSearchRows, toProductSearch, type MatchRow, type SearchRow } from "../lib/searchRows.js";
import { cropAreaPct, failedColumns, measuredColumns, secondsSince, type MeasureColumns } from "../lib/searchMeasure.js";
import { fetchFeedbackReasons } from "../lib/matchFeedback.js";
import { isFileTooLargeError } from "../lib/multipartErrors.js";
import { purgeExpiredSearches } from "../lib/searchRetention.js";
import { fetchAffiliateUrls } from "../lib/affiliateLinks.js";
import { searchLocaleFor } from "../lib/locale.js";
import { INVALID_ID, idParamsSchema, parseInput } from "../lib/validation.js";
import { ImageSourceError, downloadThumbnail, prepareImageForAnalysis } from "../lib/imageProcessing.js";
import { reserveSearch, sendCapacityReached } from "../lib/searchCapacity.js";

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

const INSERTED_MATCH_ROWS = z.array(z.object({ id: z.string(), merchant_url: z.string() }));

function toMatchRow(searchId: string, m: VisualMatch, rank: number) {
  return {
    search_id: searchId,
    rank,
    product_name: m.productName,
    image_url: m.imageUrl,
    image_hd_url: m.imageHdUrl,
    price_min: m.priceValue,
    price_max: m.priceValue,
    currency: m.currency ?? "EUR",
    merchant_name: m.merchantName,
    merchant_url: m.merchantUrl,
  };
}

/** Range les propositions et renvoie leur nombre. Une proposition que la
 * base refuse (valeur inattendue) est écartée seule, jamais les autres : on
 * reprend alors une par une, rangs renumérotés sans trou (fiabilité des
 * résultats, 2026-10-15). 0 : rien n'a pu être rangé. */
async function insertMatches(fastify: FastifyInstance, searchId: string, matches: VisualMatch[]): Promise<number> {
  const table = () => fastify.supabaseAdmin.from("product_matches");
  const { error } = await table().insert(matches.map((m, index) => toMatchRow(searchId, m, index + 1)));
  if (!error) return matches.length;

  let saved = 0;
  for (const match of matches) {
    const { error: rowError } = await table().insert(toMatchRow(searchId, match, saved + 1));
    if (!rowError) saved += 1;
  }
  if (saved === 0) fastify.log.error({ error }, "Échec d'enregistrement des product_matches");
  else fastify.log.warn({ refused: matches.length - saved, total: matches.length }, "Propositions refusées par la base : écartées, les autres gardées");
  return saved;
}

/** Enregistre les propositions et leurs liens. false : aucune n'a pu être
 * enregistrée — la recherche est alors une panne, jamais « aucune pièce
 * trouvée » (charte, règle 3 ; constaté au lot 4 ter). */
async function saveMatches(
  fastify: FastifyInstance,
  searchId: string,
  matches: VisualMatch[]
): Promise<boolean> {
  if (matches.length === 0) return true;
  if ((await insertMatches(fastify, searchId, matches)) === 0) return false;

  // Un lien affilié par produit identifié. Pour l'instant "direct" (aucun
  // réseau d'affiliation rejoint) : le lien pointe tel quel vers le
  // marchand, sans commission. Le tracking de clic est déjà en place pour
  // qu'il suffise de changer affiliate_url le jour où un programme
  // d'affiliation (Awin, Rakuten, CJ...) est rejoint pour ce marchand.
  const { data: insertedRows, error: fetchError } = await fastify.supabaseAdmin
    .from("product_matches")
    .select("id, merchant_url")
    .eq("search_id", searchId);
  const insertedMatches = INSERTED_MATCH_ROWS.safeParse(insertedRows);

  // Propositions enregistrées : sans lien affilié, l'app ouvre le lien du marchand.
  if (fetchError || !insertedMatches.success) {
    fastify.log.error({ fetchError }, "Impossible de relire les product_matches pour créer les liens affiliés");
    return true;
  }

  const { error: linksError } = await fastify.supabaseAdmin.from("affiliate_links").insert(
    insertedMatches.data.map((m) => ({
      product_match_id: m.id,
      network: "direct",
      affiliate_url: m.merchant_url,
    }))
  );

  if (linksError) {
    fastify.log.error({ linksError }, "Échec d'enregistrement des affiliate_links");
  }
  return true;
}

type RunInput = z.infer<typeof runSearchSchema>;
interface RunForm {
  input: RunInput;
  /** Image importée (photo ou capture), sinon null : la vignette officielle servira. */
  fileBuffer: Buffer | null;
}

/** Formulaire du lancement : image importée (champ « file »), zone choisie
 * (« crop », JSON) et texte (« query »). null : l'erreur est déjà envoyée. */
async function readRunForm(request: FastifyRequest, reply: FastifyReply): Promise<RunForm | null> {
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
      void reply.code(413).send({ error: "file_too_large", message: "Le fichier est trop volumineux (10 Mo maximum)." });
      return null;
    }
    throw error;
  }

  let rawCrop: unknown = undefined;
  if (fields.crop) {
    try {
      rawCrop = JSON.parse(fields.crop);
    } catch {
      void reply.code(400).send({ error: "invalid_body", message: "Zone de recadrage invalide." });
      return null;
    }
  }
  const input = parseInput(runSearchSchema, { crop: rawCrop, query: fields.query }, reply, {
    error: "invalid_body",
    message: "Zone de recadrage ou texte invalide.",
  });
  return input ? { input, fileBuffer } : null;
}

// Lancements refusés avant l'appel à SerpApi (aucun crédit). Les deux
// derniers sont comptés dans la mesure : un cadre inutilisable repéré par nous.
const RUN_REFUSALS = {
  image_required: { status: 400, body: { error: "image_required", message: "Importez une capture de la pièce." } },
  preview_unavailable: {
    status: 422,
    body: { error: "preview_unavailable", message: "L'image de la vidéo n'est plus disponible. Importez une capture de la pièce." },
  },
  invalid_image: { status: 400, body: { error: "invalid_image", message: "Cette image n'a pas pu être lue, ou la zone choisie est trop petite." } },
} as const;
type RunRefusal = keyof typeof RUN_REFUSALS;

/** Image à analyser — celle importée en priorité, sinon la vignette
 * officielle —, recadrée sur la zone choisie ; sinon la raison du refus. */
async function prepareRunImage(request: FastifyRequest, row: SearchRow, form: RunForm): Promise<{ image: Buffer } | { refusal: RunRefusal }> {
  let source: Buffer;
  try {
    if (form.fileBuffer) source = form.fileBuffer;
    else if (row.thumbnail_url) source = await downloadThumbnail(row.thumbnail_url);
    else return { refusal: "image_required" };
  } catch (error) {
    request.log.warn({ error }, "Vignette officielle indisponible au lancement");
    return { refusal: "preview_unavailable" };
  }

  try {
    return { image: await prepareImageForAnalysis(source, form.input.crop ?? null) };
  } catch (error) {
    if (error instanceof ImageSourceError) return { refusal: "invalid_image" };
    throw error;
  }
}

/** Mesure : un lancement refusé avant l'appel (cadre inutilisable repéré par
 * nous). Un échec d'écriture est journalisé, sans bloquer la réponse. */
async function countRefusalBeforeCall(fastify: FastifyInstance, row: SearchRow): Promise<void> {
  const { error } = await fastify.supabaseAdmin
    .from("product_searches")
    .update({ refused_before_call: row.refused_before_call + 1 })
    .eq("id", row.id);
  if (error) fastify.log.error({ error }, "Lancement refusé non compté dans la mesure");
}

async function markPending(fastify: FastifyInstance, id: string): Promise<void> {
  const { error } = await fastify.supabaseAdmin.from("product_searches").update({ status: "pending" }).eq("id", id);
  if (error) fastify.log.error({ error }, "Recherche non remise en attente après un lancement sans appel");
}

/** Aucun appel SerpApi finalement (annulation, plafond atteint, adresse
 * signée manquante) : l'image est effacée et la recherche redevient lançable. */
async function releaseSearch(fastify: FastifyInstance, id: string, storagePath: string): Promise<void> {
  await discardAnalysisImage(fastify, storagePath);
  await markPending(fastify, id);
}

/** Image déposée le temps que SerpApi la lise ; renvoie son adresse signée.
 * null : échec, et la recherche redevient lançable. */
async function uploadForAnalysis(fastify: FastifyInstance, request: FastifyRequest, id: string, storagePath: string, image: Buffer): Promise<string | null> {
  const { error: uploadError } = await fastify.supabaseAdmin.storage
    .from("screenshots")
    .upload(storagePath, image, { contentType: "image/jpeg", upsert: true });
  const signed = uploadError
    ? null
    : await fastify.supabaseAdmin.storage.from("screenshots").createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (!uploadError && signed?.data) return signed.data.signedUrl;

  request.log.error({ uploadError }, "Échec d'envoi de l'image recadrée");
  if (uploadError) await markPending(fastify, id);
  else await releaseSearch(fastify, id, storagePath);
  return null;
}

interface SearchOutcome {
  matches: VisualMatch[];
  status: SearchStatus;
  errorMessage: string | null;
  /** Mesure de la recherche (migration 0025) : des nombres, jamais de contenu. */
  measure: MeasureColumns;
}

/** L'appel SerpApi (1 crédit) : des propositions, rien, ou une panne — chacun annoncé comme tel, et mesuré. */
async function runVisualSearch(fastify: FastifyInstance, request: FastifyRequest, imageUrl: string, query: string | null): Promise<SearchOutcome> {
  const start = Date.now();
  try {
    const { matches, measure } = await searchProductsByImageUrl(fastify, imageUrl, { query, locale: searchLocaleFor(request) });
    const columns = measuredColumns(measure, secondsSince(start));
    if (matches.length === 0) return { matches, status: "failed", errorMessage: NO_MATCH_MESSAGE, measure: columns };
    return { matches, status: "completed", errorMessage: null, measure: columns };
  } catch (error) {
    request.log.error({ error }, "Échec de l'appel à l'API de recherche visuelle (lancement)");
    const kind = error instanceof LensCallError ? error.kind : "serpapi_error";
    return { matches: [], status: "failed", errorMessage: TECHNICAL_FAILURE_MESSAGE, measure: failedColumns(kind, secondsSince(start)) };
  }
}

/** Enregistre l'issue de l'appel et sa mesure, et renvoie la recherche
 * complète ; null : résultat illisible ou non enregistré. */
async function saveOutcome(fastify: FastifyInstance, request: FastifyRequest, id: string, outcome: SearchOutcome, cropPct: number): Promise<ProductSearch | null> {
  const saved = await saveMatches(fastify, id, outcome.matches);
  const measure = saved ? outcome.measure : failedColumns("save_failed", outcome.measure.call_seconds);
  const { data: updated, error: updateError } = await fastify.supabaseAdmin
    .from("product_searches")
    .update({
      screenshot_url: null,
      status: saved ? outcome.status : "failed",
      error_message: saved ? outcome.errorMessage : TECHNICAL_FAILURE_MESSAGE,
      ...measure,
      crop_area_pct: cropPct,
    })
    .eq("id", id)
    .select("*")
    .single();
  const { data: matchRows, error: matchesError } = await fastify.supabaseAdmin.from("product_matches").select("*").eq("search_id", id);
  const search = parseSearchRow(updated);
  const matches = parseMatchRows(matchRows);
  if (updateError || matchesError || !search || !matches) {
    request.log.error({ updateError, matchesError }, "Échec d'enregistrement du résultat de la recherche");
    return null;
  }
  const affiliateUrlByMatchId = await fetchAffiliateUrls(fastify, matches.map((m) => m.id));
  // Recherche toute neuve : aucune proposition n'a encore pu être signalée.
  return toProductSearch(search, matches, affiliateUrlByMatchId, new Map());
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

    const rows = parseSearchRows(searches);
    if (!rows) {
      request.log.error("Historique des recherches illisible");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
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
    const matches = parseMatchRows(matchRows);
    if (!matches) {
      request.log.error("Meilleurs résultats de l'historique illisibles");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    const topMatchBySearch = new Map<string, MatchRow>();
    for (const match of matches) {
      if (!topMatchBySearch.has(match.search_id)) topMatchBySearch.set(match.search_id, match);
    }

    const topMatchIds = Array.from(topMatchBySearch.values()).map((m) => m.id);
    const affiliateUrlByMatchId = await fetchAffiliateUrls(fastify, topMatchIds);
    const feedbackByMatchId = await fetchFeedbackReasons(fastify, userId, topMatchIds);

    return reply.send(
      rows
        .map((row) => {
          const topMatch = topMatchBySearch.get(row.id);
          return topMatch ? toProductSearch(row, [topMatch], affiliateUrlByMatchId, feedbackByMatchId) : null;
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

    // Conservation de l'historique : 12 mois (lib/searchRetention.ts). Un
    // échec est journalisé sans bloquer la recherche demandée ; le nettoyage
    // sera refait à la recherche suivante.
    try {
      await purgeExpiredSearches(fastify, userId);
    } catch (purgeError) {
      request.log.error({ purgeError }, "Échec de la suppression des recherches de plus de 12 mois");
    }

    // Sans image : la raison précise, pour que l'app dise quoi faire.
    const previewIssue = preview && !preview.ok ? preview.issue : null;
    const row = parseSearchRow(inserted);
    if (!row) {
      request.log.error("Recherche préparée illisible");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    return reply.send({ ...toProductSearch(row, [], new Map(), new Map()), previewIssue });
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
      const form = await readRunForm(request, reply);
      if (!form) return;
      const query = form.input.query?.trim() || null;

      const { data: search } = await fastify.supabaseAdmin
        .from("product_searches")
        .select("*")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!search) {
        return reply.code(404).send({ error: "search_not_found", message: "Recherche introuvable." });
      }
      const row = parseSearchRow(search);
      if (!row) {
        request.log.error("Recherche illisible au lancement");
        return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue, réessayez." });
      }
      if (row.status !== "pending") {
        return reply.code(409).send({ error: "search_already_run", message: "Cette recherche a déjà été lancée." });
      }

      const prepared = await prepareRunImage(request, row, form);
      if ("refusal" in prepared) {
        if (prepared.refusal !== "image_required") await countRefusalBeforeCall(fastify, row);
        const refusal = RUN_REFUSALS[prepared.refusal];
        return reply.code(refusal.status).send(refusal.body);
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
      const imageUrl = await uploadForAnalysis(fastify, request, id, storagePath, prepared.image);
      if (!imageUrl) {
        return reply.code(500).send({ error: "upload_failed", message: "L'envoi de l'image a échoué, réessayez." });
      }

      // « Annuler » dans l'app coupe la connexion : si c'est déjà fait à ce
      // stade, on n'appelle pas SerpApi (aucun crédit consommé) et la
      // recherche redevient lançable. Passé ce point, le crédit est engagé
      // — l'app ne promet jamais de le rembourser.
      if (request.raw.socket?.destroyed) {
        await releaseSearch(fastify, id, storagePath);
        return;
      }

      // Plafond global et part de la personne (lot 4 quater,
      // lib/searchCapacity.ts) : un appel est réservé juste avant l'envoi.
      // Atteint, ou illisible : aucun appel à SerpApi, aucun crédit, et la
      // recherche redevient lançable.
      const capacity = await reserveSearch(fastify, request.log, userId, id).catch(() => null);
      if (!capacity || !capacity.allowed) {
        await releaseSearch(fastify, id, storagePath);
        if (capacity) return sendCapacityReached(reply, capacity);
        return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue, réessayez." });
      }

      fastify.countRateLimitHit(request, "searchCreate");
      const outcome = await runVisualSearch(fastify, request, imageUrl, query);
      await discardAnalysisImage(fastify, storagePath);
      const result = await saveOutcome(fastify, request, id, outcome, cropAreaPct(form.input.crop));
      // Résultat illisible ou non enregistré : une panne annoncée comme telle, jamais « aucune pièce ».
      if (!result) {
        return reply.code(500).send({ error: "search_save_failed", message: "Le résultat n'a pas pu être enregistré, réessayez." });
      }
      return reply.send(result);
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

    const { data: matchRows, error: matchesError } = await fastify.supabaseAdmin.from("product_matches").select("*").eq("search_id", id);
    const row = parseSearchRow(search);
    const matches = parseMatchRows(matchRows);
    if (matchesError || !row || !matches) {
      request.log.error({ matchesError }, "Recherche ou propositions illisibles");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    const matchIds = matches.map((m) => m.id);
    const affiliateUrlByMatchId = await fetchAffiliateUrls(fastify, matchIds);
    const feedbackByMatchId = await fetchFeedbackReasons(fastify, userId, matchIds);

    return reply.send(toProductSearch(row, matches, affiliateUrlByMatchId, feedbackByMatchId));
  });
}
