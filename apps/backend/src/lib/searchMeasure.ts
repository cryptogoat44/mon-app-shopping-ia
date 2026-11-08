// Colonnes de la mesure d'une recherche dans product_searches (migration
// 0025, fiabilité des résultats ; causes d'échec complétées par 0027) : des
// nombres et des valeurs d'une liste fermée, jamais de contenu.
import type { ComplementStatus, CropRect, TextSearchStatus } from "@monapp/shared-types";
import type { LensMeasure, LensSection } from "../services/lensMeasure.js";
import type { ProviderFailureKind } from "../services/searchProvider.js";

/** found : au moins une proposition gardée ; nothing_buyable : Google a
 * répondu, tout a été écarté ; empty_lens : Google n'a rien renvoyé (cadre
 * inutilisable, ou incident chez Google) ; failure : panne. */
export type SearchOutcomeCode = "found" | "nothing_buyable" | "empty_lens" | "failure";

/** Causes d'échec acceptées par la base (colonne failure_kind, migrations 0025
 * et 0027). provider_refused : refus du fournisseur dont la place a été rendue
 * dans les trois plafonds ; interrupted : restée « en cours » plus de 2 minutes ;
 * serpapi_error : écrite seulement par le serveur d'avant 0027 (encore acceptée
 * pour un retour en arrière), jamais par celui-ci. */
export const FAILURE_KINDS = ["timeout", "provider_error", "provider_refused", "unreadable_response", "save_failed", "interrupted", "serpapi_error"] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];
/** Causes que ce serveur écrit. */
export type WrittenFailureKind = Exclude<FailureKind, "serpapi_error">;

/** Cause rangée pour une panne du fournisseur. Un refus n'est noté
 * provider_refused que si sa place a bien été rendue ; sinon provider_error :
 * il reste compté partout, par prudence (conception du 20 octobre). */
export function providerFailureKind(kind: ProviderFailureKind, placeReleased: boolean): WrittenFailureKind {
  switch (kind) {
    case "refused":
      return placeReleased ? "provider_refused" : "provider_error";
    case "timeout":
      return "timeout";
    case "error":
      return "provider_error";
    case "unreadable":
      return "unreadable_response";
  }
}

export interface MeasureColumns {
  outcome: SearchOutcomeCode;
  failure_kind: WrittenFailureKind | null;
  received_count: number | null;
  removed_incomplete: number | null;
  removed_social: number | null;
  removed_professional: number | null;
  removed_duplicates: number | null;
  kept_count: number | null;
  kept_with_price: number | null;
  kept_other_currency: number | null;
  distinct_sites: number | null;
  lens_sections: LensSection[] | null;
  google_state: "empty" | "other" | null;
  /** Durée de l'appel ; inconnue (null) pour une recherche interrompue. */
  call_seconds: number | null;
}

export function secondsSince(startMs: number): number {
  return Math.max(0, Math.round((Date.now() - startMs) / 1000));
}

export function measuredColumns(measure: LensMeasure, callSeconds: number): MeasureColumns {
  return {
    outcome: measure.kept > 0 ? "found" : measure.received === 0 ? "empty_lens" : "nothing_buyable",
    failure_kind: null,
    received_count: measure.received,
    removed_incomplete: measure.removedIncomplete,
    removed_social: measure.removedSocial,
    removed_professional: measure.removedProfessional,
    removed_duplicates: measure.removedDuplicates,
    kept_count: measure.kept,
    kept_with_price: measure.keptWithPrice,
    kept_other_currency: measure.keptOtherCurrency,
    distinct_sites: measure.distinctSites,
    lens_sections: measure.sections,
    google_state: measure.googleState,
    call_seconds: callSeconds,
  };
}

/** Panne : seuls son type et la durée de l'appel sont connus. */
export function failedColumns(kind: WrittenFailureKind, callSeconds: number | null): MeasureColumns {
  return {
    outcome: "failure",
    failure_kind: kind,
    received_count: null,
    removed_incomplete: null,
    removed_social: null,
    removed_professional: null,
    removed_duplicates: null,
    kept_count: null,
    kept_with_price: null,
    kept_other_currency: null,
    distinct_sites: null,
    lens_sections: null,
    google_state: null,
    call_seconds: callSeconds,
  };
}

/** Message de la ligne de journal de chaque recherche, lue par
 * `render-bride compteurs-ia` (scripts/lib/render-logs.ts). */
export const MEASURE_LOG_MESSAGE = "Mesure recherche";

/** Ligne « Mesure recherche » (petit lot, décision du fondateur du 2026-10-24) :
 * l'issue et des nombres, dont le rang d'origine chez Google des propositions
 * ajoutées par la règle des prix ; depuis 0027, le fournisseur et son code de
 * réponse. Jamais de titre, d'adresse ni d'identifiant (ni de la recherche, ni
 * du compte). */
export interface MeasureLogLine {
  /** Fournisseur ; null pour une recherche d'avant 0027 marquée interrompue. */
  provider: string | null;
  /** Code de réponse du fournisseur ; null sans réponse. */
  statusCode: number | null;
  outcome: SearchOutcomeCode;
  failureKind: WrittenFailureKind | null;
  received: number | null;
  kept: number | null;
  keptWithPrice: number | null;
  keptOtherCurrency: number | null;
  added: number;
  addedRanks: number[];
  callSeconds: number | null;
  /** Voie C (lot c) : la réponse de Lens vient du cache (aucun appel).
   * Absent quand la voie C est coupée : la ligne reste celle d'avant. */
  fromCache?: boolean;
}

/** Fournisseur d'une recherche et son code de réponse (null sans réponse). */
export interface ProviderReply {
  provider: string | null;
  statusCode: number | null;
}

/** `fromCache` : donné seulement quand la voie C a tourné (lot c). */
export function measureLogLine(columns: MeasureColumns, addedRanks: readonly number[], reply: ProviderReply, fromCache?: boolean): MeasureLogLine {
  const ranks = columns.outcome === "failure" ? [] : [...addedRanks];
  return {
    provider: reply.provider,
    statusCode: reply.statusCode,
    outcome: columns.outcome,
    failureKind: columns.failure_kind,
    received: columns.received_count,
    kept: columns.kept_count,
    keptWithPrice: columns.kept_with_price,
    keptOtherCurrency: columns.kept_other_currency,
    added: ranks.length,
    addedRanks: ranks,
    callSeconds: columns.call_seconds,
    ...(fromCache === undefined ? {} : { fromCache }),
  };
}

// ---- Voie C (lot c, 2026-11-02) : « Mesure complément » ----

/** Message de la ligne de journal de chaque complément (voie C), lue par
 * `render-bride compteurs-ia` (scripts/lib/render-logs.ts). */
export const COMPLEMENT_LOG_MESSAGE = "Mesure complément";

/** La promesse au fondateur : un lancement en moins de 15 secondes, mesurées
 * depuis T0 (formulaire lu) jusqu'à la fin de l'enregistrement. */
export const COMPLEMENT_PROMISE_MS = 15_000;

/** ai : « Cette pièce dans d'autres boutiques » (requête de l'IA, au
 * lancement) ; words : « Que cherchez-vous ? » (vos mots, voie B). */
export type ComplementSource = "ai" | "words";

/** Pourquoi l'IA n'a pas donné de requête sûre (liste fermée, la même que
 * services/shoppingQueryAi.ts). */
export const NO_QUERY_REASONS = ["empty", "invented", "brand_not_shared", "too_long", "operators"] as const;
export type NoQueryReason = (typeof NO_QUERY_REASONS)[number];

/** Échec de l'IA (liste fermée, la même que services/shoppingQueryAi.ts). */
export const AI_ERROR_KINDS = ["unavailable", "refused", "invalid_output"] as const;
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number];

/** Ce que le complément sait de lui-même (lib/voieC.ts) ; la route y ajoute
 * la durée totale, connue après l'enregistrement. Des nombres et des valeurs
 * de listes fermées seulement : jamais la requête, un titre, une marque, un
 * modèle, vos mots, une adresse ni un identifiant. */
export interface ComplementMeasure {
  source: ComplementSource;
  /** Issue ; null : le complément n'a pas tourné (panne de Lens, « Annuler »). */
  status: ComplementStatus | TextSearchStatus | null;
  queryFromCache: boolean;
  shoppingFromCache: boolean;
  /** Recherches Google Shopping envoyées (0 ou 1), un refus non facturé
   * compris : ce qui compte dans shopping_calls se lit dans les colonnes
   * (un refus dont la place a été rendue n'y compte pas). */
  calls: number;
  aiMs: number | null;
  shoppingMs: number | null;
  received: number | null;
  kept: number | null;
  keptWithPrice: number | null;
  /** Propositions de Google Shopping aux paliers 0 et 1 du tri léger. */
  tier0: number | null;
  tier1: number | null;
  googleLinks: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  aiErrorKind: AiErrorKind | null;
  noQueryReason: NoQueryReason | null;
  shoppingFailureKind: ProviderFailureKind | null;
}

/** Ligne « Mesure complément ». */
export interface ComplementLogLine {
  source: ComplementSource;
  status: ComplementStatus | TextSearchStatus | null;
  lensFromCache: boolean;
  queryFromCache: boolean;
  shoppingFromCache: boolean;
  calls: number;
  aiMs: number | null;
  shoppingMs: number | null;
  totalMs: number;
  /** Lancement de 15 secondes ou plus (enregistrement compris). */
  overBudget: boolean;
  /** Boutiques ensuite : complément fait par POST /api/searches/:id/complement,
   * après la réponse du lancement ; totalMs et overBudget se comptent alors
   * depuis l'arrivée de cette demande (la personne voit déjà les résultats Lens). */
  deferred: boolean;
  received: number | null;
  kept: number | null;
  keptWithPrice: number | null;
  tier0: number | null;
  tier1: number | null;
  googleLinks: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  aiErrorKind: AiErrorKind | null;
  noQueryReason: NoQueryReason | null;
  shoppingFailureKind: ProviderFailureKind | null;
}

/** `totalMs` : depuis T0 jusqu'à la fin de l'enregistrement ; `deferred` :
 * boutiques ensuite (T0 : l'arrivée de la demande du complément). */
export function complementLogLine(measure: ComplementMeasure, run: { lensFromCache: boolean; totalMs: number; deferred?: boolean }): ComplementLogLine {
  const totalMs = Math.max(0, Math.round(run.totalMs));
  return {
    source: measure.source,
    status: measure.status,
    lensFromCache: run.lensFromCache,
    queryFromCache: measure.queryFromCache,
    shoppingFromCache: measure.shoppingFromCache,
    calls: measure.calls,
    aiMs: measure.aiMs,
    shoppingMs: measure.shoppingMs,
    totalMs,
    overBudget: totalMs >= COMPLEMENT_PROMISE_MS,
    deferred: run.deferred === true,
    received: measure.received,
    kept: measure.kept,
    keptWithPrice: measure.keptWithPrice,
    tier0: measure.tier0,
    tier1: measure.tier1,
    googleLinks: measure.googleLinks,
    inputTokens: measure.inputTokens,
    outputTokens: measure.outputTokens,
    aiErrorKind: measure.aiErrorKind,
    noQueryReason: measure.noQueryReason,
    shoppingFailureKind: measure.shoppingFailureKind,
  };
}

/** Durée en secondes pour total_seconds (0 à 600, contrainte de 0028). */
export function totalSeconds(totalMs: number): number {
  return Math.min(600, Math.max(0, Math.round(totalMs / 1000)));
}

/** Part de l'image retenue par le cadrage, arrondie à 10 % ; image entière : 100. */
export function cropAreaPct(crop: CropRect | undefined): number {
  if (!crop) return 100;
  return Math.min(100, Math.round(crop.width * crop.height * 10) * 10);
}
