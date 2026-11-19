// Plafond des recherches atteint (lot 4 quater) : le motif d'échec affiché par
// l'écran Résultat — plafond du jour ou du mois (tout le service), ou part de
// la personne pour la journée — et, pour le mois, le jour de la reprise : le
// prochain renouvellement du quota chez SerpApi (décision du fondateur,
// 2026-10-11). Lot quotas (0053) : la part du mois de la personne
// (« capacity_user_month »), avec le 1er du mois suivant. Imports relatifs :
// fichier testé par vitest.
import { parseSearchCapacityError, parseSearchMonthlyQuotaError, type SearchCapacityLimit } from "@monapp/shared-types";
import { t } from "../i18n";
import { formatDayMonth, formatMonthName } from "./format";
import type { Locale } from "./preferences";

export type CapacityFailReason = `capacity_${SearchCapacityLimit}` | "capacity_user_month";

export interface CapacityFailure {
  reason: CapacityFailReason;
  /** Plafond du mois (du service ou de la personne) : jour de la reprise (« AAAA-MM-JJ »), sinon null. */
  resumesOn: string | null;
}

/** Corps d'une erreur 429 du serveur → motif d'échec ; null si ce n'est pas un plafond atteint. */
export function capacityFailure(body: unknown): CapacityFailure | null {
  const monthly = parseSearchMonthlyQuotaError(body);
  if (monthly) return { reason: "capacity_user_month", resumesOn: monthly.resumesOn };
  const reached = parseSearchCapacityError(body);
  return reached ? { reason: `capacity_${reached.limit}`, resumesOn: reached.resumesOn } : null;
}

/** Le jour d'avant (« AAAA-MM-JJ ») : le mois qui vient de finir quand `day` est un 1er. */
function dayBefore(day: string): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** Part du mois épuisée : « Vous avez utilisé vos 100 recherches de novembre. »
 * et « Elles reviennent le 1er décembre. » (mois et date dans la langue de
 * l'app) ; limite ou date inconnues : sans elles. */
export function monthlyQuotaCopy(limit: number | null, resetsOn: string | null, locale: Locale): [string, string] {
  const title = limit !== null && resetsOn ? t.monthlyQuota.usedUp(limit, formatMonthName(dayBefore(resetsOn), locale)) : t.monthlyQuota.usedUpUnknown;
  return [title, resetsOn ? t.monthlyQuota.backOn(formatDayMonth(resetsOn, locale)) : t.monthlyQuota.backSoon];
}

/** « Réessayez à partir du 3 novembre. » ; date inconnue : « Réessayez dans quelques jours. » */
export function capacityMonthTip(resumesOn: string | null | undefined, locale: Locale): string {
  return resumesOn ? t.result.capacityMonthTip(formatDayMonth(resumesOn, locale)) : t.result.capacityMonthLater;
}
