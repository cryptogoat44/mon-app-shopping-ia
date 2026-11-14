// Porte d'âge de l'essayage virtuel (réservé aux 18 ans et plus). La date de
// naissance n'est jamais gardée, ni journalisée : le serveur en déduit
// « adult » ou « minor », dans le fuseau des réglages (Europe/Paris), et
// la base ne garde que ce statut et sa date (tryon_set_age, une seule fois).
// Né un 29 février : majeur le 1er mars des années non bissextiles (le plus
// strict ; un 18e anniversaire ne tombe d'ailleurs jamais une année bissextile).
// Fonctions pures : testées sans base.
import type { CalendarDay } from "./calendar.js";

export type AgeStatus = "adult" | "minor";

/** Âge minimal de l'essayage. */
export const TRYON_MINIMUM_AGE = 18;
const EARLIEST_BIRTH_YEAR = 1900;
const BIRTH_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function compareDays(a: CalendarDay, b: CalendarDay): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/** « AAAA-MM-JJ », une vraie date du calendrier depuis 1900 ; sinon null. */
export function parseBirthDate(text: string): CalendarDay | null {
  const match = BIRTH_DATE.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < EARLIEST_BIRTH_YEAR) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Le jour où l'on devient majeur. */
function adulthoodDay(birth: CalendarDay): CalendarDay {
  const year = birth.year + TRYON_MINIMUM_AGE;
  if (birth.month === 2 && birth.day === 29 && !isLeapYear(year)) return { year, month: 3, day: 1 };
  return { year, month: birth.month, day: birth.day };
}

/** « adult » à partir du 18e anniversaire inclus, « minor » avant ; null
 * pour une date invalide (pas une vraie date, dans le futur, avant 1900). */
export function ageStatusFor(birthDate: string, today: CalendarDay): AgeStatus | null {
  const birth = parseBirthDate(birthDate);
  if (!birth || compareDays(birth, today) > 0) return null;
  return compareDays(today, adulthoodDay(birth)) >= 0 ? "adult" : "minor";
}
