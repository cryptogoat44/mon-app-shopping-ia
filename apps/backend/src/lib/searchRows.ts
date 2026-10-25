// Recherches et propositions lues dans la base, validées (charte, règle 19 :
// aucune conversion « de confiance »), puis mises en forme pour l'app.
import { z } from "zod";
import { PLATFORM_SOURCES, RECOGNITION_METHODS, SEARCH_STATUSES, type MatchFeedbackReason, type ProductSearch } from "@monapp/shared-types";
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

export function toProductSearch(
  row: SearchRow,
  matches: MatchRow[],
  affiliateUrlByMatchId: Map<string, string>,
  feedbackByMatchId: Map<string, MatchFeedbackReason>
): ProductSearch {
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
      })),
  };
}
