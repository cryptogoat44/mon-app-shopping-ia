// Recherches et propositions lues dans la base, validées (charte, règle 19 :
// aucune conversion « de confiance »), puis mises en forme pour l'app.
import { alertKeyString } from "./alertKeys.js";
import { z } from "zod";
import {
  COMPLEMENT_STATUSES,
  MATCH_ORIGINS,
  PLATFORM_SOURCES,
  RECOGNITION_METHODS,
  SEARCH_STATUSES,
  TEXT_SEARCH_STATUSES,
  type MatchFeedbackReason,
  type MatchOrigin,
  type OfferMark,
  type ProductSearch,
  type SearchComplement,
} from "@monapp/shared-types";
import { deferredPending, deferredStateOf } from "./deferredComplement.js";
import { parisDayStart } from "./matchFeedback.js";
import { FAILURE_KINDS } from "./searchMeasure.js";
import { reviewOffers, sectionOrder, type TrustOffer } from "./shopTrust.js";
import { searchVerdict } from "./verdict.js";

export const SEARCH_ROW = z.object({
  id: z.string(),
  user_id: z.string(),
  source_url: z.string().nullable(),
  source_platform: z.enum(PLATFORM_SOURCES),
  method: z.enum(RECOGNITION_METHODS),
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
  // Ordre des boutiques (0054) : la boutique officielle de la marque de la
  // pièce, reconnue à l'enregistrement de « Cette pièce dans d'autres
  // boutiques » (true seulement) ; vide ailleurs, absente sans 0054.
  brand_shop: z.boolean().nullable().optional(),
  // Stock affiché (0056) : ce que Google Lens disait au moment de la
  // recherche (true en stock, false épuisée) ; vide quand il ne disait rien,
  // ailleurs que dans la recherche visuelle et sur les lignes d'avant ;
  // absente sans 0056.
  in_stock: z.boolean().nullable().optional(),
  // Le verdict (0055) : palier du titre (0 marque et modèle, 1 marque sans le
  // modèle, 2 tout le reste : marque absente du titre, non donnée ou trop
  // courte pour être reconnue ; lib/lightSort.ts, verdictTier), noté à l'enregistrement de
  // « Cette pièce dans d'autres boutiques » ; vide ailleurs et sur les lignes
  // d'avant ; absente sans 0055 (lib/verdict.ts n'affirme alors rien).
  title_tier: z.number().int().min(0).max(2).nullable().optional(),
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

/** Une proposition rangée, telle que les règles des boutiques douteuses la lisent (lib/shopTrust.ts). */
export function trustOfferOf(row: Pick<MatchRow, "merchant_url" | "price_min" | "currency">): TrustOffer {
  return { merchantUrl: row.merchant_url, priceValue: priceOf(row.price_min), currency: row.currency };
}

/** Les propositions d'une recherche qu'on peut encore montrer (boutiques
 * douteuses, lib/shopTrust.ts), dans l'ordre reçu : sans les boutiques
 * masquées depuis, ni les offres très suspectes. */
export function keptMatchRows<T extends Pick<MatchRow, "merchant_url" | "price_min" | "currency">>(rows: readonly T[]): T[] {
  const reviews = reviewOffers(rows.map(trustOfferOf));
  return rows.filter((_, index) => !reviews[index]!.dropped);
}

/** Boutiques douteuses, à chaque relecture (lib/shopTrust.ts) : les règles
 * jugent toutes les propositions de la recherche ensemble (les prix se
 * comparent d'une section à l'autre) ; chaque section (Lens, boutiques, vos
 * mots) garde sa place et ses propositions, sans les retirées, avec leurs
 * mentions. L'ordre dans chaque section (sectionOrder) : seule « Cette pièce
 * dans d'autres boutiques » est rangée par les mentions (la boutique
 * officielle de la marque de la pièce en tête, notée à l'enregistrement :
 * brand_shop ; boutiques connues un peu remontées ; offres signalées à la
 * fin) ; la recherche visuelle et vos mots gardent l'ordre reçu. `demoted` :
 * l'offre est rangée en fin de section, là où les mentions rangent
 * seulement (« shopping »). */
function trustedMatches(matches: readonly MatchRow[]): { match: MatchRow; mark: OfferMark | null; demoted: boolean }[] {
  const sorted = [...matches].sort((a, b) => a.rank - b.rank);
  const reviews = reviewOffers(sorted.map(trustOfferOf));
  const sections = new Map<MatchOrigin, number[]>();
  sorted.forEach((match, index) => {
    const origin = match.origin ?? "lens";
    sections.set(origin, [...(sections.get(origin) ?? []), index]);
  });
  return [...sections].flatMap(([origin, indices]) =>
    sectionOrder(
      origin,
      indices,
      indices.map((index) => reviews[index]!),
      indices.map((index) => ({ brandShop: sorted[index]!.brand_shop === true }))
    ).map((index) => ({ match: sorted[index]!, mark: reviews[index]!.mark, demoted: origin === "shopping" && reviews[index]!.demoted }))
  );
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

/** Lien vidéo sans prix (décision du fondateur du 17 novembre 2026) : pour
 * une recherche partie d'un moment d'une vidéo TikTok ou Instagram, l'app
 * lance d'elle-même « Que cherchez-vous ? » avec la description tapée par la
 * personne quand aucune proposition n'a de prix, même si l'invitation n'a pas
 * été proposée (IA des boutiques coupée, en panne, à court de temps, ou
 * boutiques fiables mais sans prix). La route l'admet alors (en plus de
 * text_suggested), et seulement si :
 * - le complément a une issue enregistrée : la voie C a tourné sur cette
 *   recherche, et ses boutiques ne sont plus attendues (jamais pendant
 *   « pending » ou « running », où les deux étapes se marcheraient dessus) ;
 * - cette issue n'est pas « no_capacity » : plafond ou limite atteints,
 *   rien de plus n'est dépensé ;
 * - aucune proposition enregistrée, de n'importe quelle origine (Lens,
 *   boutiques), n'a de prix ;
 * - la recherche date du jour (heure de Paris) : jamais une ancienne
 *   recherche de l'historique.
 * Toutes les autres règles (terminée ou « rien trouvé », une seule fois,
 * budget de la photo, part du jour, plafond à la réservation) restent celles
 * de la route. L'app ne lance la recherche d'elle-même que pour un lien
 * vidéo ; une photo ou une vidéo du téléphone garde l'invitation d'avant. */
export function noPriceTextSearchAllowed(
  row: Pick<SearchRow, "complement_status" | "complement_deferred" | "complement_deferred_at" | "created_at">,
  matches: readonly Pick<MatchRow, "price_min">[],
  now: Date = new Date()
): boolean {
  const status = row.complement_status ?? null;
  if (status === null || status === "no_capacity") return false;
  if (deferredPending(deferredStateOf(row, now.getTime()))) return false;
  const createdAt = Date.parse(row.created_at);
  if (!Number.isFinite(createdAt) || createdAt < parisDayStart(now).getTime()) return false;
  return matches.every((match) => priceOf(match.price_min) === null);
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
 * C en service) ; faux par défaut, l'invitation n'est alors jamais annoncée.
 * `options.verdict` : le verdict (lib/verdict.ts) est calculé — à passer vrai
 * seulement quand la base a 0055 (sonde lib/verdictColumn.ts) et que
 * `matches` porte TOUTES les propositions de la recherche (lancement,
 * boutiques ensuite, relecture) ; jamais pour l'historique, qui n'en lit
 * qu'une. Faux par défaut : aucun verdict. */
export function toProductSearch(
  row: SearchRow,
  matches: MatchRow[],
  affiliateUrlByMatchId: Map<string, string>,
  feedbackByMatchId: Map<string, MatchFeedbackReason>,
  textSearchOn = false,
  options: { verdict?: boolean } = {}
): ProductSearch {
  const complement = complementOf(row, textSearchOn);
  const shown = trustedMatches(matches);
  const verdict = options.verdict === true ? searchVerdict(row, shown) : undefined;
  return {
    id: row.id,
    sourceUrl: row.source_url,
    sourcePlatform: row.source_platform,
    method: row.method,
    status: row.status,
    errorMessage: row.error_message,
    query: row.query,
    createdAt: row.created_at,
    // Refus du fournisseur dont la place a été rendue dans les trois plafonds.
    notCounted: row.failure_kind === "provider_refused",
    ...(complement ? { complement } : {}),
    // Boutiques douteuses (lib/shopTrust.ts) : retirées, mentions, ordre (rangé par les mentions dans « shopping » seulement).
    // Le verdict (0055) : seulement quand il est connu (absent : rien n'est affirmé).
    ...(verdict ? { verdict } : {}),
    matches: shown.map(({ match: m, mark, demoted }) => ({
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
        // Alertes prix et stock (lot 2) : « Plus disponible ? » seulement sur
        // une pièce qui a une clé (même calcul que la route du signalement).
        ...(alertKeyString(m.merchant_url, m.merchant_name) !== null ? { alertTrackable: true as const } : {}),
        // Boutiques douteuses : « Boutique officielle de la marque », « Boutique connue » ou « Prix inhabituellement bas » (absente sinon).
        ...(mark ? { offerMark: mark } : {}),
        // « shopping » seulement : rangée en fin de section (jamais affiché ; la grande carte prise dans la section ne la choisit pas).
        ...(demoted ? { demoted: true as const } : {}),
        // Stock affiché (0056) : seulement quand Google l'a dit (absent : inconnu).
        ...(typeof m.in_stock === "boolean" ? { inStock: m.in_stock } : {}),
      })),
  };
}
