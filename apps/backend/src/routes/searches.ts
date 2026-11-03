import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  SEARCH_FAILURE_MESSAGES,
  SEARCH_QUERY_MAX_LENGTH,
  TEXT_SEARCH_ERRORS,
  type MatchOrigin,
  type PlatformSource,
  type ProductSearch,
  type SearchStatus,
} from "@monapp/shared-types";
import { env } from "../env.js";
import { detectPlatform, fetchOfficialPreview } from "../services/oembed.js";
import { IMAGE_SEARCH_PROVIDER, searchProductsByImageUrl, type VisualMatch } from "../services/visualSearch.js";
import { ProviderFailure, type TextSearchProvider } from "../services/searchProvider.js";
import { serpApiTextProvider } from "../services/serpapi.js";
import { aiInputKey, askShoppingQuery } from "../services/shoppingQueryAi.js";
import type { ShoppingMatch } from "../services/textSearch.js";
import { isInterrupted, parseMatchRows, parseSearchRow, parseSearchRows, textSearchCountable, toProductSearch, type MatchRow, type SearchRow } from "../lib/searchRows.js";
import {
  COMPLEMENT_LOG_MESSAGE,
  complementLogLine,
  cropAreaPct,
  failedColumns,
  MEASURE_LOG_MESSAGE,
  measuredColumns,
  measureLogLine,
  providerFailureKind,
  secondsSince,
  type MeasureColumns,
} from "../lib/searchMeasure.js";
import { fetchFeedbackReasons } from "../lib/matchFeedback.js";
import { isFileTooLargeError } from "../lib/multipartErrors.js";
import { purgeExpiredSearches } from "../lib/searchRetention.js";
import { launchDating } from "../lib/launchDating.js";
import { fetchAffiliateUrls } from "../lib/affiliateLinks.js";
import { searchLocaleFor } from "../lib/locale.js";
import { INVALID_ID, idParamsSchema, parseInput } from "../lib/validation.js";
import { ImageSourceError, downloadThumbnail, prepareImageForAnalysis } from "../lib/imageProcessing.js";
import {
  releaseReservation,
  reserveSearch,
  searchCapacityBeforeComplementAi,
  sendCapacityReached,
  type SearchReservation,
} from "../lib/searchCapacity.js";
import { observeBreakerAfter, observeBreakerAtLaunch } from "../lib/searchBreaker.js";
import { sortByWords } from "../lib/wordSort.js";
import { assertNoUserImage, voieCAiEnabled } from "../lib/aiSwitches.js";
import { photoCallsLeft, startDeadline, VOIE_C_BUDGET } from "../lib/deadline.js";
import { lightSort } from "../lib/lightSort.js";
import { cacheKey, imageHash, purgeExpiredCache, readCache, writeCache } from "../lib/searchCache.js";
import {
  complementAfterSaveFailure,
  launchColumns,
  lensStep,
  runComplement,
  runTextComplement,
  sanitizeShoppingQuery,
  voieCActive,
  type CachePorts,
  type ComplementPorts,
  type ComplementResult,
  type LensAnswer,
  type TextComplementPorts,
} from "../lib/voieC.js";
import { consumeRateLimit, RATE_LIMITED_MESSAGE } from "../plugins/rateLimit.js";

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
  // Les mots tapés sous la photo : jamais envoyés à Google Lens (petit lot,
  // 2026-10-25 : avec l'image, ils faisaient baisser les résultats), jamais
  // enregistrés ; ils servent seulement à trier les propositions (petit lot 2,
  // décision du fondateur du 2026-10-27, lib/wordSort.ts).
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

/** Voie C (lot c) : range les propositions d'un complément — origine
 * « shopping » (la même pièce dans d'autres boutiques) ou « words » (vos
 * mots) — après le rang `afterRank`, en une seule insertion qui renvoie leurs
 * identifiants, puis leurs liens pour ces seules lignes. Les propositions Lens,
 * déjà rangées par saveMatches (inchangé), ne sont jamais touchées. Renvoie le
 * nombre rangé ; null : insertion refusée ou illisible (journalisée sans
 * contenu : ni titre, ni adresse, ni identifiant). */
async function saveComplementRows(
  fastify: FastifyInstance,
  searchId: string,
  matches: readonly ShoppingMatch[],
  origin: Exclude<MatchOrigin, "lens">,
  afterRank: number
): Promise<number | null> {
  if (matches.length === 0) return 0;
  const { data, error } = await fastify.supabaseAdmin
    .from("product_matches")
    .insert(matches.map((m, index) => ({ ...toMatchRow(searchId, m, afterRank + index + 1), origin })))
    .select("id, merchant_url");
  const inserted = INSERTED_MATCH_ROWS.safeParse(data);
  if (error || !inserted.success) {
    fastify.log.error({ origin, code: error?.code ?? null }, "Échec d'enregistrement des propositions du complément");
    return null;
  }
  // Liens « direct », comme pour Lens (voir saveMatches).
  const { error: linksError } = await fastify.supabaseAdmin.from("affiliate_links").insert(
    inserted.data.map((m) => ({
      product_match_id: m.id,
      network: "direct",
      affiliate_url: m.merchant_url,
    }))
  );
  if (linksError) fastify.log.error({ origin, code: linksError.code ?? null }, "Échec d'enregistrement des affiliate_links du complément");
  return inserted.data.length;
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
  const { error } = await fastify.supabaseAdmin.from("product_searches").update({ status: "pending", run_started_at: null }).eq("id", id);
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
  /** Rang d'origine chez Google des propositions ajoutées par la règle des prix (journal de mesure). */
  addedRanks: number[];
  /** Code de réponse du fournisseur ; null sans réponse (délai dépassé, réseau coupé). */
  providerStatusCode: number | null;
  /** Voie C : la réponse facturée de Lens (trouvé, rien d'achetable, vide),
   * AVANT le tri par les mots de la photo, à garder dans le cache ; null : panne. */
  answer: LensAnswer | null;
}

/** L'appel au fournisseur (une recherche réelle) : des propositions, rien, ou
 * une panne — chacun annoncé comme tel, et mesuré. Un refus annoncé par le
 * fournisseur n'est pas facturé : sa place est rendue (`reservationId`, 0027).
 * `timeoutMs` (voie C) : plafond fixe de l'appel, armé juste avant lui ; sans
 * lui, l'appel reste exactement celui d'avant (15 s). Jamais l'« Annuler » de
 * la personne : un arrêt serait noté comme un délai dépassé du fournisseur,
 * et compté par le disjoncteur. */
async function runVisualSearch(
  fastify: FastifyInstance,
  request: FastifyRequest,
  imageUrl: string,
  reservationId: number,
  timeoutMs?: number
): Promise<SearchOutcome> {
  const start = Date.now();
  try {
    const locale = searchLocaleFor(request);
    const options = timeoutMs === undefined ? { locale } : { locale, signal: AbortSignal.timeout(timeoutMs) };
    const { matches, measure, addedRanks, statusCode } = await searchProductsByImageUrl(fastify, imageUrl, options);
    const found = { matches, measure: measuredColumns(measure, secondsSince(start)), addedRanks, providerStatusCode: statusCode, answer: { matches, measure, addedRanks } };
    if (matches.length === 0) return { ...found, status: "failed", errorMessage: NO_MATCH_MESSAGE };
    return { ...found, status: "completed", errorMessage: null };
  } catch (error) {
    request.log.error({ error }, "Échec de l'appel à l'API de recherche visuelle (lancement)");
    const failure = error instanceof ProviderFailure ? error : null;
    const released = failure?.kind === "refused" ? await releaseReservation(fastify, request.log, reservationId) : false;
    const kind = failure ? providerFailureKind(failure.kind, released) : "provider_error";
    return {
      matches: [],
      status: "failed",
      errorMessage: TECHNICAL_FAILURE_MESSAGE,
      measure: failedColumns(kind, secondsSince(start)),
      addedRanks: [],
      providerStatusCode: failure?.statusCode ?? null,
      answer: null,
    };
  }
}

/** Voie C : la réponse de Lens lue dans le cache, rangée comme celle d'un
 * appel. Aucun appel : durée 0, aucun code de réponse. */
function outcomeFromCache(answer: LensAnswer): SearchOutcome {
  const found = { matches: answer.matches, measure: measuredColumns(answer.measure, 0), addedRanks: answer.addedRanks, providerStatusCode: null, answer };
  if (answer.matches.length === 0) return { ...found, status: "failed", errorMessage: NO_MATCH_MESSAGE };
  return { ...found, status: "completed", errorMessage: null };
}

/** Ce qui arrive au lancement jusqu'à la réponse de Lens : les propositions
 * (ou la panne) mesurées, ou un arrêt avant l'appel — déjà traité, la
 * recherche est redevenue lançable — dont la réponse reste à envoyer. */
type LensCall =
  | { kind: "searched"; outcome: SearchOutcome }
  | { kind: "upload_failed" }
  | { kind: "cancelled" }
  | { kind: "capacity"; reservation: Extract<SearchReservation, { allowed: false }> | null };

/** Le chemin d'avant la voie C, jusqu'à la réponse de Lens : image déposée,
 * connexion vérifiée, place réservée, UN appel, image effacée. `timeoutMs` :
 * voir runVisualSearch. */
async function callLens(
  fastify: FastifyInstance,
  request: FastifyRequest,
  launch: { id: string; userId: string; image: Buffer },
  timeoutMs?: number
): Promise<LensCall> {
  const { id, userId } = launch;
  const storagePath = `${userId}/${id}.jpg`;
  const imageUrl = await uploadForAnalysis(fastify, request, id, storagePath, launch.image);
  if (!imageUrl) return { kind: "upload_failed" };

  // « Annuler » dans l'app coupe la connexion : si c'est déjà fait à ce
  // stade, on n'appelle pas le fournisseur (aucune recherche consommée) et la
  // recherche redevient lançable. Passé ce point, la recherche est engagée
  // — l'app ne promet jamais de la rembourser.
  if (request.raw.socket?.destroyed) {
    await releaseSearch(fastify, id, storagePath);
    return { kind: "cancelled" };
  }

  // Plafond global et part de la personne (lot 4 quater,
  // lib/searchCapacity.ts) : une place est réservée juste avant l'envoi.
  // Atteint, ou illisible : aucun appel au fournisseur, aucun crédit, et la
  // recherche redevient lançable.
  const reservation = await reserveSearch(fastify, request.log, userId, id).catch(() => null);
  if (!reservation || !reservation.allowed) {
    await releaseSearch(fastify, id, storagePath);
    return { kind: "capacity", reservation };
  }

  fastify.countRateLimitHit(request, "searchCreate");
  const outcome = await runVisualSearch(fastify, request, imageUrl, reservation.reservationId, timeoutMs);
  await discardAnalysisImage(fastify, storagePath);
  return { kind: "searched", outcome };
}

/** Réponse d'un lancement arrêté avant l'appel (rien n'a été consommé). */
function sendWithoutCall(reply: FastifyReply, call: Exclude<LensCall, { kind: "searched" }>): FastifyReply | undefined {
  switch (call.kind) {
    case "upload_failed":
      return reply.code(500).send({ error: "upload_failed", message: "L'envoi de l'image a échoué, réessayez." });
    case "cancelled":
      // La connexion est déjà coupée : aucune réponse à envoyer.
      return undefined;
    case "capacity":
      if (call.reservation) return sendCapacityReached(reply, call.reservation);
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue, réessayez." });
  }
}

const SAVE_FAILED = { error: "search_save_failed", message: "Le résultat n'a pas pu être enregistré, réessayez." } as const;

/** Écrit les colonnes finales de la recherche, puis la relit avec ses
 * propositions et leurs liens ; null : résultat illisible ou non enregistré. */
async function writeOutcome(fastify: FastifyInstance, request: FastifyRequest, id: string, columns: Record<string, unknown>): Promise<ProductSearch | null> {
  const { data: updated, error: updateError } = await fastify.supabaseAdmin.from("product_searches").update(columns).eq("id", id).select("*").single();
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

/** Enregistre l'issue de l'appel et sa mesure, et renvoie la recherche
 * complète ; null : résultat illisible ou non enregistré. La ligne « Mesure
 * recherche » est écrite d'abord : elle reste, même si l'enregistrement échoue. */
async function saveOutcome(fastify: FastifyInstance, request: FastifyRequest, id: string, outcome: SearchOutcome, cropPct: number): Promise<ProductSearch | null> {
  const saved = await saveMatches(fastify, id, outcome.matches);
  const measure = saved ? outcome.measure : failedColumns("save_failed", outcome.measure.call_seconds);
  const reply = { provider: IMAGE_SEARCH_PROVIDER.name, statusCode: outcome.providerStatusCode };
  // Journal racine (sans le contexte de la requête) : ni identifiant de requête, ni chemin, ni compte.
  fastify.log.info(measureLogLine(measure, outcome.addedRanks, reply), MEASURE_LOG_MESSAGE);
  return writeOutcome(fastify, request, id, {
    screenshot_url: null,
    status: saved ? outcome.status : "failed",
    error_message: saved ? outcome.errorMessage : TECHNICAL_FAILURE_MESSAGE,
    ...measure,
    crop_area_pct: cropPct,
    provider: reply.provider,
    provider_status_code: reply.statusCode,
  });
}

// ---------------------------------------------------------------------
// Voie C (lot c, 2026-11-02) : les résultats Lens, complétés par « Cette
// pièce dans d'autres boutiques » (requête écrite par l'IA à partir des
// titres Lens, puis Google Shopping) et « Que cherchez-vous ? » (vos mots,
// POST /api/searches/:id/text). Le cœur est dans lib/voieC.ts (ports, sans
// réseau propre) ; ici, seulement le branchement sur les vrais modules.
// Interrupteur VOIE_C_ENABLED coupé, ou 0028 absente : le chemin d'avant,
// tel quel.
// ---------------------------------------------------------------------

/** Recherche par texte (Google Shopping), par le même fournisseur que Lens. */
const TEXT_SEARCH_PROVIDER: TextSearchProvider = serpApiTextProvider;

interface VoieCLaunch {
  id: string;
  userId: string;
  /** T0 : formulaire du lancement lu (l'envoi de la photo n'est pas compté). */
  t0: number;
  /** Image préparée (recadrée, réduite) : son empreinte est la clé du cache. */
  image: Buffer;
  input: RunInput;
  /** Création de la recherche (au « préparer ») : décide si « Que
   * cherchez-vous ? » pourra être compté (textSearchCountable). */
  createdAt: string;
}

/** Ports du cache (lib/searchCache.ts), base et journal de la requête liés. */
function cachePorts(fastify: FastifyInstance, request: FastifyRequest): CachePorts {
  return {
    readCache: (key, schema, signal) => readCache(fastify.supabaseAdmin, key, schema, request.log, signal),
    writeCache: (key, step, payload) => writeCache(fastify.supabaseAdmin, key, step, payload, request.log),
    cacheKey,
  };
}

/** Ports du complément au lancement, branchés sur l'IA, Google Shopping, le
 * plafond des recherches et les limites. */
function complementPorts(fastify: FastifyInstance, request: FastifyRequest, launch: Pick<VoieCLaunch, "id" | "userId">): ComplementPorts {
  return {
    ...cachePorts(fastify, request),
    // Texte seulement ; la garde refuse toute image tant que l'envoi d'une
    // photo à Anthropic est coupé (ANTHROPIC_PHOTO_ENABLED).
    askQuery: (items, locale, signal) => askShoppingQuery(items, locale, { apiKey: env.ANTHROPIC_API_KEY ?? "", signal, assertNoImage: assertNoUserImage }),
    aiInputKey: (items, locale) => aiInputKey(items, locale),
    sortShopping: lightSort,
    searchText: (query, locale, signal) => TEXT_SEARCH_PROVIDER.searchByText(query, locale, signal),
    reserve: () => reserveSearch(fastify, request.log, launch.userId, launch.id, "shopping"),
    release: (reservationId) => releaseReservation(fastify, request.log, reservationId, "shopping"),
    capacityLeft: async () => (await searchCapacityBeforeComplementAi(fastify, request.log, launch.userId, launch.id)).allowed,
    consumeAiLimit: () => consumeRateLimit(request, "shoppingQueryAiGlobal"),
    socketDestroyed: () => Boolean(request.raw.socket?.destroyed),
    now: () => Date.now(),
    log: request.log,
  };
}

/** Ports de « Que cherchez-vous ? » : Google Shopping et le retour d'une place. */
function textComplementPorts(fastify: FastifyInstance, request: FastifyRequest): TextComplementPorts {
  return {
    searchText: (query, locale, signal) => TEXT_SEARCH_PROVIDER.searchByText(query, locale, signal),
    release: (reservationId) => releaseReservation(fastify, request.log, reservationId, "shopping"),
    now: () => Date.now(),
    log: request.log,
  };
}

/** Lens non enregistré (une panne) : jamais d'invitation « Que
 * cherchez-vous ? » sur une recherche en panne. */
function withoutSuggestion(complement: ComplementResult): ComplementResult {
  return {
    ...complement,
    columns: { ...complement.columns, text_suggested: false },
    reply: { ...complement.reply, suggestText: false },
  };
}

/** Enregistre un lancement de la voie C et renvoie la recherche complète
 * (null : illisible ou non enregistrée) avec le complément tel qu'enregistré.
 * - Les propositions Lens passent par saveMatches, INCHANGÉ (insertion, puis
 *   liens créés en relisant la recherche, avant toute ligne du complément).
 * - Celles du complément ensuite, à part, rangées après le dernier rang
 *   possible de Lens : leur échec (issue « shopping_failed ») ne touche jamais
 *   aux propositions Lens.
 * - « Terminée » dès qu'une proposition, de n'importe quelle origine, est
 *   enregistrée ; sinon, comme avant.
 * - Les colonnes de la voie C ne sont écrites qu'ici. Lens venu du cache :
 *   run_started_at est vidé, le disjoncteur ignore alors cette issue copiée.
 * - Lignes de journal : « Mesure recherche » d'abord (avec fromCache), puis
 *   « Mesure complément », avec la durée totale depuis T0. */
async function saveVoieCOutcome(
  fastify: FastifyInstance,
  request: FastifyRequest,
  launch: VoieCLaunch,
  outcome: SearchOutcome,
  run: { lensFromCache: boolean; complement: ComplementResult }
): Promise<{ search: ProductSearch | null; complement: ComplementResult }> {
  const saved = await saveMatches(fastify, launch.id, outcome.matches);
  let complement = run.complement;
  let complementSaved = 0;
  if (!saved) {
    complement = complement.matches.length > 0 ? complementAfterSaveFailure(complement) : withoutSuggestion(complement);
  } else if (complement.matches.length > 0) {
    const count = await saveComplementRows(fastify, launch.id, complement.matches, "shopping", outcome.matches.length);
    if (count === null) complement = complementAfterSaveFailure(complement);
    else complementSaved = count;
  }

  const measure = saved ? outcome.measure : failedColumns("save_failed", outcome.measure.call_seconds);
  const provider = { provider: IMAGE_SEARCH_PROVIDER.name, statusCode: outcome.providerStatusCode };
  // Journal racine (sans le contexte de la requête) : ni identifiant de requête, ni chemin, ni compte.
  fastify.log.info(measureLogLine(measure, outcome.addedRanks, provider, run.lensFromCache), MEASURE_LOG_MESSAGE);
  const search = await writeOutcome(fastify, request, launch.id, {
    screenshot_url: null,
    status: !saved ? "failed" : complementSaved > 0 ? "completed" : outcome.status,
    error_message: !saved ? TECHNICAL_FAILURE_MESSAGE : complementSaved > 0 ? null : outcome.errorMessage,
    ...measure,
    crop_area_pct: cropAreaPct(launch.input.crop),
    provider: provider.provider,
    provider_status_code: provider.statusCode,
    ...launchColumns(run.lensFromCache, complement, Date.now() - launch.t0),
    ...(run.lensFromCache ? { run_started_at: null } : {}),
  });
  fastify.log.info(complementLogLine(complement.measure, { lensFromCache: run.lensFromCache, totalMs: Date.now() - launch.t0 }), COMPLEMENT_LOG_MESSAGE);
  return { search, complement };
}

/** Lancement avec la voie C (interrupteur allumé, 0028 vue).
 * 1. Lens : un seul appel à la fois pour la même image ; le cache d'abord
 *    (800 ms au plus), sinon le chemin d'avant, avec 12 s FIXES armées juste
 *    avant l'appel. L'« Annuler » de la personne n'arrête jamais Lens.
 * 2. Tri par les mots de la photo, inchangé : la meilleure proposition reste
 *    Lens nᵒ 1.
 * 3. Le complément (lib/voieC.ts, runComplement) : il ne lève jamais
 *    d'erreur ; toute issue autre que « shown » laisse les résultats Lens seuls.
 * 4. Enregistrement (saveVoieCOutcome), puis la réponse : la recherche, avec
 *    le complément (la requête de l'IA n'existe que dans cette réponse). */
async function launchWithVoieC(fastify: FastifyInstance, request: FastifyRequest, reply: FastifyReply, launch: VoieCLaunch) {
  const locale = searchLocaleFor(request);
  const lens = await lensStep(cachePorts(fastify, request), {
    imageHash: imageHash(launch.image),
    locale,
    call: () => callLens(fastify, request, launch, VOIE_C_BUDGET.lensTimeoutMs),
    // Seules les réponses facturées (trouvé, rien d'achetable, vide) vont dans
    // le cache ; jamais une panne, un refus ou un arrêt avant l'appel.
    answerOf: (call) => (call.kind === "searched" ? call.outcome.answer : null),
  });

  let searched: SearchOutcome;
  if (lens.lensFromCache) {
    // Réponse de Lens venue du cache (ou d'un appel identique en cours) :
    // aucun dépôt, aucune réservation, aucun appel. Chaque lancement servi
    // ainsi écrit encore une recherche et ses propositions : sa propre limite
    // (30 par heure), au-delà un 429 comme toute limite.
    if (!consumeRateLimit(request, "searchCacheServed")) {
      await markPending(fastify, launch.id);
      return reply.code(429).send({ error: "rate_limited", message: RATE_LIMITED_MESSAGE });
    }
    if (request.raw.socket?.destroyed) {
      await markPending(fastify, launch.id);
      return;
    }
    searched = outcomeFromCache(lens.answer);
  } else {
    const call = lens.result;
    if (call.kind !== "searched") return sendWithoutCall(reply, call);
    searched = call.outcome;
  }

  // Les mots remontent en tête les propositions dont le nom les contient ; rien n'est retiré.
  const byWords = sortByWords(searched.matches, launch.input.query);
  const complement = await runComplement(complementPorts(fastify, request, launch), {
    // Ordre de Google, avant le tri par les mots : ceux-ci ne partent nulle part.
    lens: searched.matches,
    lensFailed: searched.measure.outcome === "failure",
    lensCalled: !lens.lensFromCache,
    shoppingCalls: 0,
    locale,
    deadline: startDeadline(launch.t0, VOIE_C_BUDGET.totalMs),
    aiEnabled: voieCAiEnabled(),
  });
  // Limite horaire : comptée une fois par lancement avec au moins un appel
  // réel. Lens venu du cache mais Google Shopping appelé : c'est ici.
  if (lens.lensFromCache && complement.measure.calls > 0) fastify.countRateLimitHit(request, "searchCreate");
  // « Que cherchez-vous ? » n'est proposé que s'il pourra être compté : une
  // recherche servie entièrement par le cache, préparée avant minuit (heure
  // de Paris) et lancée après, ne compte dans aucune part de 8 ; la route le
  // refuserait (409), et l'invitation disparaîtrait sans un mot.
  const servedFromCache = lens.lensFromCache && complement.columns.shopping_calls === 0;
  const offered = textSearchCountable({ served_from_cache: servedFromCache, created_at: launch.createdAt }) ? complement : withoutSuggestion(complement);
  const saved = await saveVoieCOutcome(fastify, request, launch, { ...searched, matches: byWords.matches }, { lensFromCache: lens.lensFromCache, complement: offered });
  // Le disjoncteur ne juge que les vrais appels à Lens.
  if (!lens.lensFromCache) await observeBreakerAfter(fastify, "image", IMAGE_SEARCH_PROVIDER.name, launch.id);
  // Résultat illisible ou non enregistré : une panne annoncée comme telle, jamais « aucune pièce ».
  if (!saved.search) return reply.code(500).send(SAVE_FAILED);
  return reply.send({ ...saved.search, sortedByWords: byWords.sorted, complement: saved.complement.reply });
}

// ---- « Que cherchez-vous ? » (voie B, POST /api/searches/:id/text) ----

const textSearchSchema = z.object({
  // Vos mots : jamais enregistrés, jamais journalisés, jamais mis en cache.
  words: z.string().max(SEARCH_QUERY_MAX_LENGTH),
});

const INVALID_WORDS = { error: "invalid_body", message: "Décrivez la pièce en quelques mots." } as const;

// L'app se fie au code (TEXT_SEARCH_ERRORS) et montre ses propres textes ;
// ces messages, déjà traduits (lib/messages.ts), ne servent que de repli.
const TEXT_SEARCH_REFUSALS = {
  unavailable: { status: 404, body: { error: TEXT_SEARCH_ERRORS.unavailable, message: "Page introuvable." } },
  notAllowed: { status: 409, body: { error: TEXT_SEARCH_ERRORS.notAllowed, message: "Requête invalide." } },
  alreadyUsed: { status: 409, body: { error: TEXT_SEARCH_ERRORS.alreadyUsed, message: "Cette recherche a déjà été lancée." } },
} as const;

function sendTextRefusal(reply: FastifyReply, refusal: keyof typeof TEXT_SEARCH_REFUSALS): FastifyReply {
  const { status, body } = TEXT_SEARCH_REFUSALS[refusal];
  return reply.code(status).send(body);
}

/** Admissible : terminée, ou « rien trouvé » (jamais une panne, ni une
 * recherche pas encore lancée), l'invitation « Que cherchez-vous ? » a été
 * proposée (text_suggested : seul cas où l'app l'offre ; jamais sur une
 * ancienne recherche de l'historique), la recherche peut encore être comptée
 * dans une part de 8 (servie par le cache un jour précédent : jamais comptée
 * dans une part de 8, celle de son jour est close ; la voie B n'y est plus
 * possible, voir textSearchCountable), et le budget de la photo permet encore
 * une recherche réelle (3 au plus : Lens s'il a été appelé, plus les
 * recherches Google Shopping déjà comptées). Garanti par la ligne, jamais
 * par le cache. */
function textSearchAllowed(row: SearchRow, now: Date = new Date()): boolean {
  const finished = row.status === "completed" || (row.status === "failed" && row.error_message === NO_MATCH_MESSAGE);
  return finished && textSearchCountable(row, now) && row.text_suggested === true && photoCallsLeft(row.lens_from_cache !== true, row.shopping_calls ?? 0) >= 1;
}

/** Verrou de la voie B : une seule recherche avec vos mots par recherche
 * (text_requested_at, en une instruction conditionnelle). false : déjà demandée.
 * Dans la même instruction, la recherche cesse d'être « servie par le cache » :
 * elle va faire un appel réel, et compte dès maintenant dans la part de 8 par
 * personne (serpapi_quota), y compris pour un autre lancement simultané. */
async function lockTextSearch(fastify: FastifyInstance, id: string): Promise<boolean> {
  const { data } = await fastify.supabaseAdmin
    .from("product_searches")
    .update({ text_requested_at: new Date().toISOString(), served_from_cache: false })
    .eq("id", id)
    .is("text_requested_at", null)
    .select("id");
  return Boolean(data && data.length > 0);
}

/** Aucun appel finalement (annulation, plafond atteint ou illisible) : la
 * recherche avec vos mots redevient possible, et « servie par le cache »
 * reprend sa valeur d'avant le verrou. */
async function unlockTextSearch(fastify: FastifyInstance, row: SearchRow): Promise<void> {
  const { error } = await fastify.supabaseAdmin
    .from("product_searches")
    .update({ text_requested_at: null, served_from_cache: row.served_from_cache === true })
    .eq("id", row.id);
  if (error) fastify.log.error({ code: error.code ?? null }, "Verrou de la recherche avec vos mots non remis");
}

/** La recherche complète, comme GET /api/searches/:id la renvoie
 * (propositions, liens, signalements de la personne) ; null : illisible. */
async function readSearchForReply(fastify: FastifyInstance, request: FastifyRequest, id: string, userId: string): Promise<ProductSearch | null> {
  const { data: search } = await fastify.supabaseAdmin.from("product_searches").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  const { data: matchRows, error: matchesError } = await fastify.supabaseAdmin.from("product_matches").select("*").eq("search_id", id);
  const row = parseSearchRow(search);
  const matches = parseMatchRows(matchRows);
  if (matchesError || !row || !matches) {
    request.log.error({ code: matchesError?.code ?? null }, "Recherche ou propositions illisibles après la recherche avec vos mots");
    return null;
  }
  const matchIds = matches.map((m) => m.id);
  const affiliateUrlByMatchId = await fetchAffiliateUrls(fastify, matchIds);
  const feedbackByMatchId = await fetchFeedbackReasons(fastify, userId, matchIds);
  // Appelée seulement par la route « Que cherchez-vous ? », voie C en service.
  return toProductSearch(row, matches, affiliateUrlByMatchId, feedbackByMatchId, true);
}

/** La recherche à lancer : celle de la personne, encore en attente. null :
 * l'erreur est déjà envoyée (introuvable, illisible ou déjà lancée). */
async function readPendingSearch(fastify: FastifyInstance, request: FastifyRequest, reply: FastifyReply, id: string, userId: string): Promise<SearchRow | null> {
  const { data: search } = await fastify.supabaseAdmin.from("product_searches").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!search) {
    void reply.code(404).send({ error: "search_not_found", message: "Recherche introuvable." });
    return null;
  }
  const row = parseSearchRow(search);
  if (!row) {
    request.log.error("Recherche illisible au lancement");
    void reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue, réessayez." });
    return null;
  }
  if (row.status !== "pending") {
    void reply.code(409).send({ error: "search_already_run", message: "Cette recherche a déjà été lancée." });
    return null;
  }
  return row;
}

/** Verrou : passe de "pending" à "processing" en une seule instruction
 * conditionnelle, et note l'heure du lancement (0027 : recherche interrompue,
 * disjoncteurs). Deux lancements simultanés (double appui, réseau lent) ne
 * peuvent pas consommer deux crédits : le second ne trouve plus de ligne
 * "pending" (audit Lot Q, ROB-03). Créée un jour précédent (heure de Paris),
 * la recherche prend aussi l'heure du lancement comme date de création, dans
 * la même instruction, pour compter dans la part du jour où elle part
 * (lib/launchDating.ts). Renvoie sa date de création après le verrou ; null :
 * déjà lancée. */
async function lockForRun(fastify: FastifyInstance, row: Pick<SearchRow, "id" | "created_at">): Promise<string | null> {
  const dating = launchDating(row.created_at, new Date());
  const { data: locked } = await fastify.supabaseAdmin
    .from("product_searches")
    .update({ status: "processing", ...dating })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id");
  return locked && locked.length > 0 ? (dating.created_at ?? row.created_at) : null;
}

/** Recherche restée « en cours » plus de 2 minutes (coupure, serveur
 * redémarré) : marquée interrompue au moment où on la relit, sans tâche
 * périodique (conception acceptée le 21 octobre). Sa place reste comptée.
 * L'image analysée, si elle était restée, est effacée (RGPD). Terminée
 * entre-temps : relue telle quelle. null : illisible. */
async function markInterrupted(fastify: FastifyInstance, row: SearchRow): Promise<SearchRow | null> {
  const measure = failedColumns("interrupted", null);
  const { data, error } = await fastify.supabaseAdmin
    .from("product_searches")
    .update({ screenshot_url: null, status: "failed", error_message: TECHNICAL_FAILURE_MESSAGE, ...measure })
    .eq("id", row.id)
    .eq("status", "processing")
    .select("*");
  if (error) {
    fastify.log.error({ error }, "Recherche interrompue non marquée");
    return row;
  }
  if (data && data.length > 0) {
    await discardAnalysisImage(fastify, `${row.user_id}/${row.id}.jpg`);
    fastify.log.info(measureLogLine(measure, [], { provider: row.provider, statusCode: null }), MEASURE_LOG_MESSAGE);
    return parseSearchRow(data[0]);
  }
  const { data: current } = await fastify.supabaseAdmin.from("product_searches").select("*").eq("id", row.id).maybeSingle();
  return parseSearchRow(current);
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
    // « Que cherchez-vous ? » annoncé seulement si la voie C est en service (coupée : jamais sondée).
    const textSearchOn = await voieCActive(fastify);

    return reply.send(
      rows
        .map((row) => {
          const topMatch = topMatchBySearch.get(row.id);
          return topMatch ? toProductSearch(row, [topMatch], affiliateUrlByMatchId, feedbackByMatchId, textSearchOn) : null;
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
    // sera refait à la recherche suivante. Cache de la voie C : ses entrées
    // expirées (24 h) sont supprimées ici aussi, QUEL QUE SOIT l'interrupteur,
    // pour que la durée tienne même quand plus rien n'y écrit (table absente
    // avant 0028 : ignoré sans bruit). D'abord, et hors du try : il ne lève
    // jamais d'erreur, et un échec de l'historique ne le saute donc jamais.
    await purgeExpiredCache(fastify.supabaseAdmin, request.log);
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

  // Temps 2 — LANCER (une seule fois par recherche ; 1 à 3 recherches par
  // photo, voir la voie C plus haut) : formulaire multipart avec, au choix,
  // une image importée (champ "file" — photo ou capture au bon moment de la
  // vidéo) ou, à défaut, la vignette officielle préparée au temps 1 ; plus la
  // zone choisie ("crop", JSON en proportions 0–1). Un texte ("query") envoyé
  // par une ancienne version de l'app est ignoré. Le serveur recadre lui-même : identique sur
  // le web et sur iPhone, et sans les restrictions du navigateur sur les
  // images d'un autre site.
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
      // T0 de la voie C : le formulaire est lu (l'envoi de la photo par le réseau mobile n'est pas compté).
      const t0 = Date.now();
      const row = await readPendingSearch(fastify, request, reply, id, userId);
      if (!row) return;

      // Disjoncteur de la recherche par image, en observation (mise en ligne 1) : il ne bloque rien.
      await observeBreakerAtLaunch(fastify, "image", IMAGE_SEARCH_PROVIDER.name);
      const prepared = await prepareRunImage(request, row, form);
      if ("refusal" in prepared) {
        if (prepared.refusal !== "image_required") await countRefusalBeforeCall(fastify, row);
        const refusal = RUN_REFUSALS[prepared.refusal];
        return reply.code(refusal.status).send(refusal.body);
      }

      if (!(await lockForRun(fastify, row))) {
        return reply.code(409).send({ error: "search_already_run", message: "Cette recherche a déjà été lancée." });
      }

      // Voie C (lot c) : interrupteur allumé ET migration 0028 vue. Sinon,
      // exactement le chemin d'avant : Lens seul, 15 s, aucune colonne nouvelle.
      if (await voieCActive(fastify)) {
        return launchWithVoieC(fastify, request, reply, { id, userId, t0, image: prepared.image, input: form.input, createdAt: row.created_at });
      }

      const call = await callLens(fastify, request, { id, userId, image: prepared.image });
      if (call.kind !== "searched") return sendWithoutCall(reply, call);
      // Les mots remontent en tête les propositions dont le nom les contient ; rien n'est retiré.
      const byWords = sortByWords(call.outcome.matches, form.input.query);
      const outcome = { ...call.outcome, matches: byWords.matches };
      const result = await saveOutcome(fastify, request, id, outcome, cropAreaPct(form.input.crop));
      await observeBreakerAfter(fastify, "image", IMAGE_SEARCH_PROVIDER.name, id);
      // Résultat illisible ou non enregistré : une panne annoncée comme telle, jamais « aucune pièce ».
      if (!result) return reply.code(500).send(SAVE_FAILED);
      return reply.send({ ...result, sortedByWords: byWords.sorted });
    }
  );

  // « Que cherchez-vous ? » (voie B, lot c) : UNE recherche Google Shopping
  // avec vos mots, ajoutée à la MÊME recherche (ce n'est pas une relance), une
  // seule fois, dans le budget de la photo (3 recherches au plus). Les
  // propositions arrivent sous « Résultats pour vos mots » (origine « words ») ;
  // une recherche « rien trouvé » qui en reçoit devient terminée (elle apparaît
  // alors dans « Récemment spottées »). Vos mots ne sont ni enregistrés, ni
  // journalisés, ni mis en cache. Voie C coupée : la route n'existe pas (404).
  fastify.post(
    "/api/searches/:id/text",
    {
      preHandler: [fastify.requireAuth, fastify.rateLimitCheck("searchCreate")],
      config: { rateLimitName: "searchCreate" },
    },
    async (request, reply) => {
      // Budget : le délai de Google Shopping se compte depuis l'arrivée de la demande.
      const t0 = Date.now();
      if (!(await voieCActive(fastify))) return sendTextRefusal(reply, "unavailable");
      const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
      if (!params) return;
      const body = parseInput(textSearchSchema, request.body ?? {}, reply, INVALID_WORDS);
      if (!body) return;
      // Opérateurs de Google retirés (site:, -mot, OR, guillemets…) : vos mots, rien d'autre.
      const words = sanitizeShoppingQuery(body.words);
      if (words === "") return reply.code(400).send(INVALID_WORDS);
      const { id } = params;
      const userId = request.user!.id;

      const { data: search } = await fastify.supabaseAdmin.from("product_searches").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
      if (!search) return reply.code(404).send({ error: "search_not_found", message: "Recherche introuvable." });
      const row = parseSearchRow(search);
      const { data: matchRows, error: matchesError } = await fastify.supabaseAdmin.from("product_matches").select("*").eq("search_id", id);
      const existing = parseMatchRows(matchRows);
      if (!row || matchesError || !existing) {
        request.log.error({ code: matchesError?.code ?? null }, "Recherche ou propositions illisibles avant la recherche avec vos mots");
        return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue, réessayez." });
      }
      // Déjà demandée d'abord : la seconde demande dit « déjà lancée », même si
      // le budget de la photo est maintenant épuisé.
      if (row.text_requested_at) return sendTextRefusal(reply, "alreadyUsed");
      if (!textSearchAllowed(row)) return sendTextRefusal(reply, "notAllowed");
      if (!(await lockTextSearch(fastify, id))) return sendTextRefusal(reply, "alreadyUsed");

      // « Annuler » avant l'appel : rien n'est consommé, le verrou est remis.
      if (request.raw.socket?.destroyed) {
        await unlockTextSearch(fastify, row);
        return;
      }
      // Une place réservée juste avant l'envoi (étape « shopping ») ; la
      // recherche en cours reste hors de la part de la personne : ce n'est pas
      // une nouvelle photo. Refusée : le verrou est remis, et le plafond est
      // annoncé (une action explicite de la personne).
      const reservation = await reserveSearch(fastify, request.log, userId, id, "shopping").catch(() => null);
      if (!reservation || !reservation.allowed) {
        await unlockTextSearch(fastify, row);
        if (reservation) return sendCapacityReached(reply, reservation);
        return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue, réessayez." });
      }
      // Minuit (heure de Paris) passé entre le contrôle et la réservation : la
      // part de 8 se décide à la réservation, au jour nouveau, qui ne compte
      // pas cette recherche servie par le cache. Rien n'est envoyé, la place
      // est rendue et le verrou remis.
      if (!textSearchCountable(row)) {
        await releaseReservation(fastify, request.log, reservation.reservationId, "shopping");
        await unlockTextSearch(fastify, row);
        return sendTextRefusal(reply, "notAllowed");
      }
      fastify.countRateLimitHit(request, "searchCreate");

      const text = await runTextComplement(textComplementPorts(fastify, request), {
        words,
        existing: existing.map((m) => ({ merchantUrl: m.merchant_url })),
        locale: searchLocaleFor(request),
        deadline: startDeadline(t0, VOIE_C_BUDGET.totalMs),
        reservationId: reservation.reservationId,
      });
      const lastRank = existing.reduce((max, m) => Math.max(max, m.rank), 0);
      const saved = await saveComplementRows(fastify, id, text.matches, "words", lastRank);
      const textStatus = saved === null ? "shopping_failed" : text.textStatus;
      // « Rien trouvé » complété par vos mots : terminée. Les colonnes de la
      // mesure de Lens restent celles du lancement. Un appel réel compté : la
      // recherche n'est plus « servie par le cache » et compte dans la part de
      // 8 par personne. Sinon (aucun appel, ou refus non facturé dont la place
      // a été rendue : text.calls = 0), shopping_calls et « servie par le
      // cache » reprennent leur valeur d'avant le verrou ; la voie B, elle,
      // reste utilisée (une seule tentative).
      const completes = row.status === "failed" && (saved ?? 0) > 0;
      const { error: updateError } = await fastify.supabaseAdmin
        .from("product_searches")
        .update({
          text_status: textStatus,
          shopping_calls: (row.shopping_calls ?? 0) + text.calls,
          text_suggested: false,
          served_from_cache: text.calls === 0 && row.served_from_cache === true,
          ...(completes ? { status: "completed", error_message: null } : {}),
        })
        .eq("id", id);
      const measure = saved === null ? { ...text.measure, status: textStatus, kept: 0, keptWithPrice: 0 } : text.measure;
      fastify.log.info(complementLogLine(measure, { lensFromCache: row.lens_from_cache === true, totalMs: Date.now() - t0 }), COMPLEMENT_LOG_MESSAGE);
      if (updateError) {
        request.log.error({ code: updateError.code ?? null }, "Issue de la recherche avec vos mots non enregistrée");
        return reply.code(500).send(SAVE_FAILED);
      }
      const result = await readSearchForReply(fastify, request, id, userId);
      if (!result) return reply.code(500).send(SAVE_FAILED);
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

    const read = parseSearchRow(search);
    const row = read && isInterrupted(read, Date.now()) ? await markInterrupted(fastify, read) : read;
    const { data: matchRows, error: matchesError } = await fastify.supabaseAdmin.from("product_matches").select("*").eq("search_id", id);
    const matches = parseMatchRows(matchRows);
    if (matchesError || !row || !matches) {
      request.log.error({ matchesError }, "Recherche ou propositions illisibles");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    const matchIds = matches.map((m) => m.id);
    const affiliateUrlByMatchId = await fetchAffiliateUrls(fastify, matchIds);
    const feedbackByMatchId = await fetchFeedbackReasons(fastify, userId, matchIds);
    // Voie C coupée depuis l'enregistrement : l'issue et les sections restent,
    // l'invitation « Que cherchez-vous ? » n'est plus annoncée (la route répondrait 404).
    const textSearchOn = await voieCActive(fastify);

    return reply.send(toProductSearch(row, matches, affiliateUrlByMatchId, feedbackByMatchId, textSearchOn));
  });
}
