// Plafond des recherches atteint (lot 4 quater) : le motif d'échec affiché par
// l'écran Résultat — plafond du jour ou du mois (tout le service), ou part de
// la personne pour la journée — et, pour le mois, le jour de la reprise : le
// prochain renouvellement du quota chez SerpApi (décision du fondateur,
// 2026-10-11). Imports relatifs : fichier testé par vitest.
import { parseSearchCapacityError, type SearchCapacityLimit } from "@monapp/shared-types";
import { t } from "../i18n";
import { formatDayMonth } from "./format";
import type { Locale } from "./preferences";

export type CapacityFailReason = `capacity_${SearchCapacityLimit}`;

export interface CapacityFailure {
  reason: CapacityFailReason;
  /** Plafond du mois : jour de la reprise (« AAAA-MM-JJ »), sinon null. */
  resumesOn: string | null;
}

/** Corps d'une erreur 429 du serveur → motif d'échec ; null si ce n'est pas un plafond atteint. */
export function capacityFailure(body: unknown): CapacityFailure | null {
  const reached = parseSearchCapacityError(body);
  return reached ? { reason: `capacity_${reached.limit}`, resumesOn: reached.resumesOn } : null;
}

/** « Réessayez à partir du 3 novembre. » ; date inconnue : « Réessayez dans quelques jours. » */
export function capacityMonthTip(resumesOn: string | null | undefined, locale: Locale): string {
  return resumesOn ? t.result.capacityMonthTip(formatDayMonth(resumesOn, locale)) : t.result.capacityMonthLater;
}
