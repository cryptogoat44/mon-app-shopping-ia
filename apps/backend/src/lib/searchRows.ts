// Recherches et propositions lues dans la base, validées (charte, règle 19 :
// aucune conversion « de confiance »), puis mises en forme pour l'app.
import { z } from "zod";
import {
  COMPLEMENT_STATUSES,
  MATCH_ORIGINS,
  PLATFORM_SOURCES,
  RECOGNITION_METHODS,
  SEARCH_STATUSES,
  TEXT_SEARCH_STATUSES,
  type MatchFeedbackReason,
  type ProductSearch,
  type SearchComplement,
} from "@monapp/shared-types";
import { deferredPending, deferredStateOf } from "./deferredComplement.js";
import { parisDayStart } from "./matchFeedback.js";
import { FAILURE_KINDS } from "./searchMeasure.js";

export const SEARCH_ROW = z.object({
  id: z.string(),
  user_id: z.string(),
  source_url: z.string().nullable(),
  source_platform: z.enum(PLATFORM_SOURCES),
  method: z.enum(RECOGNITION_METHODS),
  thumbnail_url: z.string().nullable(),
  screenshot_url: z.string().nullable(),
  status: z.enum(SEARCH_STATUSES),
  error_message: z.string().nullable(),
  query: z.string().nullable(),
  created_at: z.string(),
  refused_before_call: z.number().int().nonnegative(),
  failure_kind: z.enum(FAILURE_KINDS).nullable(),
  provider: z.string().nullable(),
  // Heure du lancement (0027) : vide tant que la recherche n'est pas partie.
  run_started_at: z.string().nullable(),
  // Voie C (0028, lot c) : toutes facultatives, pour qu'une base sans 0028
  // reste lisible (la voie C y reste coupée).
  complement_status: z.enum(COMPLEMENT_STATUSES).nullable().optional(),
  shopping_calls: z.number().int().nonnegative().optional(),
  lens_from_cache: z.boolean().optional(),
  served_from_cache: z.boolean().optional(),
  text_suggested: z.boolean().optional(),
  text_requested_at: z.string().nullable().optional(),
  text_status: z.enum(TEXT_SEARCH_STATUSES).nullable().optional(),
  total_seconds: z.number().int().nonnegative().nullable().optional(),
  // Boutiques ensuite (0031) : facultatives aussi, pour une base sans 0031.
  complement_deferred: z.enum(["pending", "running", "done"]).nullable().optional(),
  complement_deferred_at: z.string().nullable().optional(),
});
export type SearchRow = z.infer<typeof SEARCH_ROW>;

export const MATCH_ROW = z.object({
  id: z.string(),
  search_id: z.string(),
  rank: z.number().int(),
  product_name: z.string(),
  brand: z.string().nullable(),
  image_url: z.string(),
  image_hd_url: z.string().nullable(),
  // numeric : un nombre, ou un texte selon le pilote de la base.
  price_min: z.union([z.number(), z.string()]).nullable(),
  price_max: z.union([z.number(), z.string()]).nullable(),
  currency: z.string().nullable(),
  merchant_name: z.string().nullable(),
  merchant_url: z.string(),
  // Voie C (0028) : origine de la proposition ; absente avant 0028 (= « lens »).
  origin: z.enum(MATCH_ORIGINS).optional(),
  // Boutiques ensuite (0031) : place dans la réponse Lens avant le tri par
  // les mots, gardée seulement jusqu'au début de l'étape des boutiques.
  lens_rank: z.number().int().positive().nullable().optional(),
});
export type MatchRow = z.infer<typeof MATCH_ROW>;

const MATCH_ROWS = z.array(MATCH_ROW);
const SEARCH_ROWS = z.array(SEARCH_ROW);

/** Au-delà, une recherche encore « en cours » est interrompue (conception du
 * 21 octobre) : la recherche elle-même dure 15 secondes au plus. */
export const INTERRUPTED_AFTER_MS = 2 * 60_000;

/** Restée « en cours » plus de 2 minutes depuis son lancement (ou, pour une
 * recherche d'avant 0027, depuis sa création). */
export function isInterrupted(row: Pick<SearchRow, "status" | "run_started_at" | "created_at">, now: number): boolean {
  if (row.status !== "processing") return false;
  const startedAt = Date.parse(row.run_started_at ?? row.created_at);
  return Number.isFinite(startedAt) && now - startedAt > INTERRUPTED_AFTER_MS;
}

/** null : ligne absente ou illisible. */
export function parseSearchRow(data: unknown): SearchRow | null {
  const parsed = SEARCH_ROW.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function parseSearchRows(data: unknown): SearchRow[] | null {
  const parsed = SEARCH_ROWS.safeParse(data ?? []);
  return parsed.success ? parsed.data : null;
}

export function parseMatchRows(data: unknown): MatchRow[] | null {
  const parsed = MATCH_ROWS.safeParse(data ?? []);
  return parsed.success ? parsed.data : null;
}

function priceOf(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

/** « Que cherchez-vous ? » peut-il encore être compté ? Une recherche servie
 * entièrement par le cache (served_from_cache) n'a compté dans aucune part de
 * 8 ; la voie B, un appel réel, la fait compter comme une photo… mais
 * serpapi_quota ne compte une recherche que le jour (de Paris) de sa
 * création. Servie par le cache un jour précédent : jamais comptée dans une
 * part de 8 (celle de son jour est close) ; la voie B n'y est plus possible.
 * Les autres recherches : toujours possible (leur part s'est décidée à leur
 * lancement, d'après leur jour de création ; préparée un jour précédent, une
 * recherche prend au lancement la date du lancement, lib/launchDating.ts).
 * Un message envoyé juste après minuit reçoit donc un refus (l'invitation
 * disparaît ; la photo peut être relancée) ; l'invitation n'est pas proposée
 * au lancement quand elle serait refusée, et la route revérifie l'heure après
 * la réservation. */
export function textSearchCountable(row: Pick<SearchRow, "served_from_cache" | "created_at">, now: Date = new Date()): boolean {
  if (row.served_from_cache !== true) return true;
  const createdAt = Date.parse(row.created_at);
  return Number.isFinite(createdAt) && createdAt >= parisDayStart(now).getTime();
}

/** Complément de la voie C, lu dans la ligne : absent quand aucune de ses
 * colonnes n'est remplie (voie C coupée, recherche plus ancienne, base sans
 * 0028). L'invitation « Que cherchez-vous ? » n'est plus proposée une fois la
 * recherche par vos mots lancée, ni quand elle ne peut pas l'être
 * (`textSearchOn` faux : voie C coupée depuis, la route répondrait 404 ;
 * recherche servie par le cache un jour précédent, voir textSearchCountable,
 * la route répondrait 409) ; l'issue et les sections, elles, restent. La
 * requête de l'IA n'est jamais enregistrée : une recherche relue n'en dit
 * rien. Boutiques ensuite (0031) : `pending` tant que les boutiques peuvent
 * encore arriver (étape en attente depuis moins de 5 minutes, ou en cours),
 * voie C en service ; absent sinon. */
export function complementOf(row: SearchRow, textSearchOn: boolean, now: Date = new Date()): SearchComplement | undefined {
  const status = row.complement_status ?? null;
  const textStatus = row.text_status ?? null;
  const textRequested = row.text_requested_at != null;
  const deferred = deferredStateOf(row, now.getTime());
  const ran =
    status !== null || textStatus !== null || textRequested || row.text_suggested === true || (row.shopping_calls ?? 0) > 0 || row.lens_from_cache === true || deferred !== "none";
  if (!ran) return undefined;
  const pending = textSearchOn && deferredPending(deferred);
  return { status, suggestText: textSearchOn && row.text_suggested === true && !textRequested && textSearchCountable(row, now), textStatus, ...(pending ? { pending: true } : {}) };
}

/** `textSearchOn` : « Que cherchez-vous ? » peut être lancé maintenant (voie
 * C en service) ; faux par défaut, l'invitation n'est alors jamais annoncée. */
export function toProductSearch(
  row: SearchRow,
  matches: MatchRow[],
  affiliateUrlByMatchId: Map<string, string>,
  feedbackByMatchId: Map<string, MatchFeedbackReason>,
  textSearchOn = false
): ProductSearch {
  const complement = complementOf(row, textSearchOn);
  return {
    id: row.id,
    sourceUrl: row.source_url,
    sourcePlatform: row.source_platform,
    method: row.method,
    thumbnailUrl: row.thumbnail_url,
    status: row.status,
    errorMessage: row.error_message,
    query: row.query,
    createdAt: row.created_at,
    // Refus du fournisseur dont la place a été rendue dans les trois plafonds.
    notCounted: row.failure_kind === "provider_refused",
    ...(complement ? { complement } : {}),
    matches: [...matches]
      .sort((a, b) => a.rank - b.rank)
      .map((m) => ({
        id: m.id,
        rank: m.rank,
        productName: m.product_name,
        brand: m.brand,
        imageUrl: m.image_url,
        imageHdUrl: m.image_hd_url,
        priceMin: priceOf(m.price_min),
        priceMax: priceOf(m.price_max),
        currency: m.currency,
        merchantName: m.merchant_name,
        merchantUrl: m.merchant_url,
        // Repli sur merchant_url si le lien affilié manque (échec d'écriture
        // ponctuel dans saveMatches) — toujours une URL valide à ouvrir.
        affiliateUrl: affiliateUrlByMatchId.get(m.id) ?? m.merchant_url,
        feedbackReason: feedbackByMatchId.get(m.id) ?? null,
        // Voie C : seulement pour « shopping » et « words » (absente = « lens »).
        ...(m.origin && m.origin !== "lens" ? { origin: m.origin } : {}),
      })),
  };
}
