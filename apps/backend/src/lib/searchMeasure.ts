// Colonnes de la mesure d'une recherche dans product_searches (migration
// 0025, fiabilité des résultats) : des nombres et des valeurs d'une liste
// fermée, jamais de contenu.
import type { CropRect } from "@monapp/shared-types";
import type { LensMeasure, LensSection } from "../services/lensMeasure.js";
import type { LensFailureKind } from "../services/visualSearch.js";

/** found : au moins une proposition gardée ; nothing_buyable : Google a
 * répondu, tout a été écarté ; empty_lens : Google n'a rien renvoyé (cadre
 * inutilisable, ou incident chez Google) ; failure : panne. */
export type SearchOutcomeCode = "found" | "nothing_buyable" | "empty_lens" | "failure";
export type FailureKind = LensFailureKind | "save_failed";

export interface MeasureColumns {
  outcome: SearchOutcomeCode;
  failure_kind: FailureKind | null;
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
  call_seconds: number;
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
export function failedColumns(kind: FailureKind, callSeconds: number): MeasureColumns {
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

/** Part de l'image retenue par le cadrage, arrondie à 10 % ; image entière : 100. */
export function cropAreaPct(crop: CropRect | undefined): number {
  if (!crop) return 100;
  return Math.min(100, Math.round(crop.width * crop.height * 10) * 10);
}
