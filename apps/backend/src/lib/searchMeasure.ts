// Colonnes de la mesure d'une recherche dans product_searches (migration
// 0025, fiabilité des résultats ; causes d'échec complétées par 0027) : des
// nombres et des valeurs d'une liste fermée, jamais de contenu.
import type { CropRect } from "@monapp/shared-types";
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
}

/** Fournisseur d'une recherche et son code de réponse (null sans réponse). */
export interface ProviderReply {
  provider: string | null;
  statusCode: number | null;
}

export function measureLogLine(columns: MeasureColumns, addedRanks: readonly number[], reply: ProviderReply): MeasureLogLine {
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
  };
}

/** Part de l'image retenue par le cadrage, arrondie à 10 % ; image entière : 100. */
export function cropAreaPct(crop: CropRect | undefined): number {
  if (!crop) return 100;
  return Math.min(100, Math.round(crop.width * crop.height * 10) * 10);
}
