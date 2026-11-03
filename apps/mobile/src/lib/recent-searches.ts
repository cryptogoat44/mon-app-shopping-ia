// « Récemment spottées » (lot « Retrouver ses pièces ») : les 20 dernières
// recherches réussies, le maximum du serveur (GET /api/searches, 6 par
// défaut). Avec 8 recherches par jour, 6 ne suffisaient pas : une pièce vue
// avant-hier avait disparu et il ne restait qu'à repayer une recherche, alors
// que le résultat est conservé 12 mois et se relit gratuitement.
// Imports relatifs : fichier testé par vitest.
import { t } from "../i18n";
import type { Locale } from "./preferences";

export const RECENT_SEARCHES_LIMIT = 20;

const INTL: Record<Locale, string> = { fr: "fr-FR", en: "en-US" };
const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Jour d'une recherche, à l'heure de l'appareil : « Aujourd'hui », « Hier »,
 * puis « lundi 2 novembre » — l'année seulement si ce n'est pas l'année en
 * cours. Une date un peu en avance (horloge de l'appareil) reste « Aujourd'hui ». */
export function recentDayLabel(iso: string, locale: Locale, now: Date = new Date()): string {
  const date = new Date(iso);
  // Arrondi : un jour de changement d'heure dure 23 ou 25 heures.
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (daysAgo <= 0) return t.retrouverPieces.today;
  if (daysAgo === 1) return t.retrouverPieces.yesterday;
  const sameYear = date.getFullYear() === now.getFullYear();
  const text = date.toLocaleDateString(INTL[locale], { weekday: "long", day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) });
  return locale === "fr" && date.getDate() === 1 ? text.replace(/ 1 /, " 1er ") : text;
}
