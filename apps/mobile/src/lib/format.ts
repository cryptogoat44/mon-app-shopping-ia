// Dates, durées et prix selon la langue (lot 3). Une devise n'est jamais
// convertie : seul l'affichage change (« 120 € » / « €120 »).
// Imports relatifs : fichier testé par vitest.
import type { Locale } from "./preferences";

const INTL: Record<Locale, string> = { fr: "fr-FR", en: "en-US" };

export function formatLongDate(isoOrDay: string, locale: Locale): string {
  // « 2026-09-25 » seul est lu à midi pour ne jamais changer de jour selon le fuseau.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(isoOrDay) ? new Date(`${isoOrDay}T12:00:00`) : new Date(isoOrDay);
  return date.toLocaleDateString(INTL[locale], { day: "numeric", month: "long", year: "numeric" });
}

/** Date courte, mois abrégé : « 23 nov. 2026 » ; « Nov 23, 2026 ». Lue à midi,
 * comme formatLongDate (page look : prix et stock datés). */
export function formatShortDate(isoDay: string, locale: Locale): string {
  return new Date(`${isoDay}T12:00:00`).toLocaleDateString(INTL[locale], { day: "numeric", month: "short", year: "numeric" });
}

/** Jour et mois, sans l'année, pour une date proche : « 3 novembre », « 1er décembre » ;
 * « November 3 ». Lu à midi, comme formatLongDate, pour ne jamais changer de jour. */
export function formatDayMonth(isoDay: string, locale: Locale): string {
  const date = new Date(`${isoDay}T12:00:00`);
  const text = date.toLocaleDateString(INTL[locale], { day: "numeric", month: "long" });
  return locale === "fr" && date.getDate() === 1 ? text.replace(/^1 /, "1er ") : text;
}

/** Le mois d'une date, en toutes lettres : « novembre » ; « November ». Lu à midi. */
export function formatMonthName(isoDay: string, locale: Locale): string {
  return new Date(`${isoDay}T12:00:00`).toLocaleDateString(INTL[locale], { month: "long" });
}

/** Prix dans sa devise d'origine ; code devise inconnu : nombre suivi du code. */
export function formatPrice(amount: number, currency: string | null, locale: Locale): string {
  const digits = { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 };
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(INTL[locale], { style: "currency", currency, ...digits }).format(amount);
    } catch {
      // Code refusé par le moteur : repli ci-dessous.
    }
  }
  return `${amount.toLocaleString(INTL[locale], digits)} ${currency ?? ""}`.trim();
}

const AGO: Record<Locale, { now: string; min: (n: number) => string; hour: (n: number) => string; day: (n: number) => string }> = {
  fr: { now: "à l'instant", min: (n) => `il y a ${n} min`, hour: (n) => `il y a ${n} h`, day: (n) => `il y a ${n} j` },
  en: { now: "just now", min: (n) => `${n} min ago`, hour: (n) => `${n} h ago`, day: (n) => (n === 1 ? "1 day ago" : `${n} days ago`) },
};

export function timeAgo(iso: string, locale: Locale, now: number = Date.now()): string {
  const words = AGO[locale];
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return words.now;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return words.min(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return words.hour(hours);
  return words.day(Math.floor(hours / 24));
}
