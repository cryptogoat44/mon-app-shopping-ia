// « Récemment spottées » (lot « Retrouver ses pièces ») : les 20 dernières
// recherches réussies, le maximum du serveur (GET /api/searches, 6 par
// défaut). Avec 8 recherches par jour, 6 ne suffisaient pas : une pièce vue
// avant-hier avait disparu et il ne restait qu'à repayer une recherche, alors
// que le résultat est conservé 12 mois et se relit gratuitement.
// Imports relatifs : fichier testé par vitest.
import { t } from "../i18n";
import type { Locale } from "./preferences";

export const RECENT_SEARCHES_LIMIT = 20;

// Retours du build 2, lot « historique » : tout l'historique sur l'accueil
// de Spotter, par pages de 20 en descendant (`before`), et une recherche dans
// l'historique (`q` : le nom, la marque ou la boutique d'une pièce). Les deux
// paramètres sont facultatifs côté serveur (GET /api/searches).

/** Taille d'une page de l'historique (le maximum du serveur). */
export const HISTORY_PAGE_SIZE = RECENT_SEARCHES_LIMIT;
/** Recherche dans l'historique : de 2 à 60 caractères (sans les blancs autour). */
export const HISTORY_QUERY_MIN = 2;
export const HISTORY_QUERY_MAX = 60;
/** Délai après la dernière frappe avant de chercher. */
export const HISTORY_SEARCH_DELAY_MS = 350;

/** Le texte tapé, prêt à chercher ; null : trop court ou trop long (on montre alors tout l'historique). */
export function normalizeHistoryQuery(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length >= HISTORY_QUERY_MIN && trimmed.length <= HISTORY_QUERY_MAX ? trimmed : null;
}

/** Adresse de GET /api/searches. Chaque valeur est encodée : le « + » du
 * fuseau d'une date ne doit pas devenir une espace, ni les mots tapés casser l'adresse. */
export function recentSearchesPath(options: { limit?: number; before?: string | null; q?: string | null } = {}): string {
  const params: string[] = [];
  if (options.limit) params.push(`limit=${options.limit}`);
  if (options.before) params.push(`before=${encodeURIComponent(options.before)}`);
  if (options.q) params.push(`q=${encodeURIComponent(options.q)}`);
  return `/api/searches${params.length > 0 ? `?${params.join("&")}` : ""}`;
}

/** La proposition renvoyée correspond-elle aux mots ? Même règle que le
 * serveur (nom, marque ou boutique, sans tenir compte de la casse). Un
 * serveur plus ancien ignore `q` et renverrait tout l'historique : l'app le
 * reconnaît ainsi, et n'affiche jamais un résultat qui ne correspond pas. */
export function matchesHistoryQuery(match: { productName: string; brand: string | null; merchantName: string | null }, q: string): boolean {
  const needle = q.toLowerCase();
  return [match.productName, match.brand, match.merchantName].some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
}

/** Ajoute une page à la liste, sans les recherches déjà affichées (un
 * serveur plus ancien ignore `before` et renverrait la première page).
 * `added` : 0 — la page n'apporte rien de nouveau, c'est la fin. */
export function mergeHistoryPage<T extends { searchId: string }>(current: readonly T[], page: readonly T[]): { entries: T[]; added: number } {
  const seen = new Set(current.map((entry) => entry.searchId));
  const fresh = page.filter((entry) => {
    if (seen.has(entry.searchId)) return false;
    seen.add(entry.searchId);
    return true;
  });
  return { entries: fresh.length > 0 ? [...current, ...fresh] : [...current], added: fresh.length };
}

/** Curseur de la page suivante : la date de la dernière ligne affichée. */
export function historyCursor(entries: readonly { createdAt: string }[]): string | null {
  return entries.length > 0 ? entries[entries.length - 1]!.createdAt : null;
}

const INTL: Record<Locale, string> = { fr: "fr-FR", en: "en-US" };
const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Jour d'une recherche, à l'heure de l'appareil : « Aujourd'hui », « Hier »,
 * puis « lundi 2 novembre » — l'année seulement si ce n'est pas l'année en
 * cours. Une date un peu en avance (horloge de l'appareil) reste « Aujourd'hui ». */
export function recentDayLabel(iso: string, locale: Locale, now: Date = new Date()): string {
  return dayLabel(iso, locale, now, "long");
}

/** Lot « finitions de l'œil » (maquette « Écrin » 1) : la date courte écrite sur
 * les cases de « Récemment spottées », pour que la boutique reste lisible :
 * « Aujourd'hui », « Hier », puis « Lun. 23 nov. » (en anglais « Mon, Nov 23 »),
 * l'année seulement si ce n'est pas l'année en cours. VoiceOver lit la date
 * entière (recentDayLabel). */
export function recentDayShort(iso: string, locale: Locale, now: Date = new Date()): string {
  return dayLabel(iso, locale, now, "short");
}

function dayLabel(iso: string, locale: Locale, now: Date, form: "long" | "short"): string {
  const date = new Date(iso);
  // Arrondi : un jour de changement d'heure dure 23 ou 25 heures.
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (daysAgo <= 0) return t.retrouverPieces.today;
  if (daysAgo === 1) return t.retrouverPieces.yesterday;
  const sameYear = date.getFullYear() === now.getFullYear();
  const text = date.toLocaleDateString(INTL[locale], { weekday: form, day: "numeric", month: form, ...(sameYear ? {} : { year: "numeric" }) });
  const withFirst = locale === "fr" && date.getDate() === 1 ? text.replace(/ 1 /, " 1er ") : text;
  // Forme courte : « lun. » prend sa majuscule (« Lun. 23 nov. »), comme la maquette.
  return form === "short" ? withFirst.charAt(0).toUpperCase() + withFirst.slice(1) : withFirst;
}

/** Paramètres de l'écran Résultat pour rouvrir une recherche depuis
 * « Récemment spottées » (accueil et « Tout voir ») : la recherche, et la
 * proposition de sa vignette, que l'écran met en grand — sinon « prix
 * d'abord » pouvait en montrer une autre et replier celle-ci tout en bas
 * (relecture, F2 ; lib/price-first.ts, startProposalIndex). */
export function reopenParams(entry: { searchId: string; piece: { id: string } }): { searchId: string; matchId: string } {
  return { searchId: entry.searchId, matchId: entry.piece.id };
}
