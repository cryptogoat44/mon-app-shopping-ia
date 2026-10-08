// Plafond global des recherches atteint (lot 4 quater) : titre et conseil de
// l'écran Résultat. Jamais de promesse fausse : « demain » seulement pour le
// plafond du jour ; pour les 31 jours glissants, la date de reprise donnée par
// le serveur. Imports relatifs : fichier testé par vitest.
import type { SearchCapacityReached } from "@monapp/shared-types";
import { getActiveLocale, t } from "../i18n";
import { formatLongDate } from "./format";

export function capacityCopy(capacity: SearchCapacityReached | undefined): [string, string] {
  if (capacity?.period === "day") return [t.result.capacityDayTitle, t.result.capacityDayTip];
  if (capacity?.retryAt) return [t.result.capacityMonthTitle, t.result.capacityMonthTip(formatLongDate(capacity.retryAt, getActiveLocale()))];
  // Date inconnue : rien de plus précis que ce qui est sûr.
  return [capacity ? t.result.capacityMonthTitle : t.result.capacityDayTitle, t.result.capacityLaterTip];
}
