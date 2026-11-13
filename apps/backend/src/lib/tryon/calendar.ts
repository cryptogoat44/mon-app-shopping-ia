// Calendrier de l'essayage virtuel : le mois civil et le jour dans le fuseau
// des réglages (TRYON_TIMEZONE, Europe/Paris par défaut), comme les compte
// la base (migration 0042 : to_char(instant at time zone fuseau, 'YYYY-MM')).
// Fonctions pures, horloge passée en paramètre : testées sans base.

/** Un jour du calendrier (mois de 1 à 12). */
export interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

interface WallClock extends CalendarDay {
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** L'heure qu'affiche une horloge de ce fuseau à cet instant. */
function wallClock(at: Date, timeZone: string): WallClock {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(at).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Le jour de cet instant dans le fuseau. */
export function dayIn(at: Date, timeZone: string): CalendarDay {
  const { year, month, day } = wallClock(at, timeZone);
  return { year, month, day };
}

/** « AAAA-MM » : le mois civil de cet instant dans le fuseau (celui de la base). */
export function monthKeyAt(at: Date, timeZone: string): string {
  const { year, month } = wallClock(at, timeZone);
  return `${year}-${pad(month)}`;
}

/** « AAAA-MM-JJ » : le jour de cet instant dans le fuseau. */
export function dayKeyAt(at: Date, timeZone: string): string {
  const { year, month, day } = wallClock(at, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** L'instant du minuit qui ouvre ce jour dans le fuseau. */
export function zonedMidnight(day: CalendarDay, timeZone: string): Date {
  const target = Date.UTC(day.year, day.month - 1, day.day);
  let guess = target;
  // L'écart avec UTC se corrige en un ou deux pas (deux pour un changement d'heure).
  for (let step = 0; step < 3; step += 1) {
    const clock = wallClock(new Date(guess), timeZone);
    const shown = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
    if (shown === target) break;
    guess += target - shown;
  }
  return new Date(guess);
}

/** Le début du mois civil suivant dans le fuseau : quand les essais gratuits repartent. */
export function nextMonthStart(at: Date, timeZone: string): Date {
  const { year, month } = wallClock(at, timeZone);
  return zonedMidnight(month === 12 ? { year: year + 1, month: 1, day: 1 } : { year, month: month + 1, day: 1 }, timeZone);
}
