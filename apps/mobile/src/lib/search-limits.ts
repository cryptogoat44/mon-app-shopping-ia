// Lot limites annoncées (2026-11-03) : les limites de recherche dites AVANT
// l'effort — Spotter en pause, part du jour épuisée, dernières recherches —
// à partir du compteur lu sans rien réserver (GET /api/searches/capacity),
// et précisées dans les messages de limite (le chiffre, l'heure de reprise).
// Lecture échouée ou illisible : rien n'est annoncé, rien n'est bloqué.
// Imports relatifs : fichier testé par vitest.
import type { SearchCapacityStatus } from "@monapp/shared-types";
import { t } from "../i18n";
import { formatDayMonth } from "./format";
import type { Locale } from "./preferences";
import { capacityMonthTip, type CapacityFailReason } from "./spot-capacity";

/** Le reste n'est annoncé qu'à 3 ou moins : un compteur toujours affiché
 * rappellerait la rareté à chaque visite. */
export const LOW_REMAINING = 3;

/** Un compteur plus récent que 20 s n'est pas relu (onglets ouverts tour à tour). */
export const FRESH_MS = 20_000;

const DAY_MS = 24 * 3_600_000;

export type LimitsNotice =
  | { kind: "paused"; reason: "day" | "month"; reopensAt: string }
  | { kind: "used_up"; limit: number; resetsAt: string }
  | { kind: "low"; remaining: number };

/** Ce qu'il faut annoncer maintenant, d'après le dernier compteur lu ; null :
 * rien (compteur inconnu, reste confortable, ou reprise déjà passée). */
export function limitsNotice(status: SearchCapacityStatus | null, now: number): LimitsNotice | null {
  if (!status) return null;
  const { service, user } = status;
  if (service.status === "paused" && Date.parse(service.reopensAt) > now) return { kind: "paused", reason: service.reason, reopensAt: service.reopensAt };
  // Minuit est passé depuis la lecture : la part est repartie de zéro.
  if (Date.parse(user.resetsAt) <= now) return null;
  if (user.remaining === 0) return { kind: "used_up", limit: user.limit, resetsAt: user.resetsAt };
  if (service.status === "open" && status.remainingToday >= 1 && status.remainingToday <= LOW_REMAINING) return { kind: "low", remaining: status.remainingToday };
  return null;
}

/** « Lancer » ne peut pas aboutir (Spotter en pause, ou part du jour épuisée) : le serveur refuserait. */
export function blocksLaunch(notice: LimitsNotice | null): boolean {
  return notice?.kind === "paused" || notice?.kind === "used_up";
}

/** Prochain instant où l'annonce change d'elle-même (minuit, renouvellement) ; null : aucun. */
export function nextBoundary(status: SearchCapacityStatus | null, now: number): number | null {
  if (!status) return null;
  const instants = [status.user.resetsAt, status.service.status === "paused" ? status.service.reopensAt : null];
  const future = instants.map((instant) => (instant ? Date.parse(instant) : Number.NaN)).filter((ms) => ms > now);
  return future.length > 0 ? Math.min(...future) : null;
}

// ---- Heure de reprise, à l'heure de l'appareil ----

export interface LocalTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Date et heure d'un instant sur une horloge locale. */
export type LocalClock = (ms: number) => LocalTime;

/** L'horloge de l'appareil : minuit à Paris devient 18 h à New York. */
export const deviceClock: LocalClock = (ms) => {
  const date = new Date(ms);
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes() };
};

export type ReopenWhen =
  | { kind: "midnight" }
  | { kind: "time"; time: string }
  | { kind: "tomorrow"; time: string }
  | { kind: "date"; date: string }
  | { kind: "dateTime"; date: string; time: string };

const pad = (value: number) => String(value).padStart(2, "0");

/** « 18 h », « 8 h 30 » ; « 6 PM », « 8:30 AM ». */
export function formatHour(hour: number, minute: number, locale: Locale): string {
  if (locale === "fr") return minute === 0 ? `${hour} h` : `${hour} h ${pad(minute)}`;
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${minute === 0 ? "" : `:${pad(minute)}`} ${hour < 12 ? "AM" : "PM"}`;
}

/** Quand la reprise tombe, vue d'ici : « minuit » cette nuit, une heure
 * aujourd'hui ou demain, sinon le jour (et l'heure, si ce n'est pas minuit). */
export function reopenWhen(instant: string, now: number, locale: Locale, clock: LocalClock = deviceClock): ReopenWhen {
  const at = clock(Date.parse(instant));
  const today = clock(now);
  const days = Math.round((Date.UTC(at.year, at.month - 1, at.day) - Date.UTC(today.year, today.month - 1, today.day)) / DAY_MS);
  const time = formatHour(at.hour, at.minute, locale);
  const date = formatDayMonth(`${at.year}-${pad(at.month)}-${pad(at.day)}`, locale);
  if (at.hour === 0 && at.minute === 0) return days <= 1 ? { kind: "midnight" } : { kind: "date", date };
  if (days <= 0) return { kind: "time", time };
  if (days === 1) return { kind: "tomorrow", time };
  return { kind: "dateTime", date, time };
}

type WhenWords = (typeof t)["searchLimits"]["until"];

function phrase(when: ReopenWhen, words: WhenWords): string {
  switch (when.kind) {
    case "midnight":
      return words.midnight;
    case "time":
      return words.time(when.time);
    case "tomorrow":
      return words.tomorrow(when.time);
    case "date":
      return words.date(when.date);
    case "dateTime":
      return words.dateTime(when.date, when.time);
  }
}

/** « Réessayez à partir de minuit. » */
function retryFrom(instant: string, now: number, locale: Locale, clock: LocalClock): string {
  return t.searchLimits.retryFrom(phrase(reopenWhen(instant, now, locale, clock), t.searchLimits.from));
}

/** Texte d'une annonce : un titre, et pour une pause ou une part épuisée, de quoi savoir quand revenir. */
export function noticeText(notice: LimitsNotice, now: number, locale: Locale, clock: LocalClock = deviceClock): { title: string; body: string | null } {
  switch (notice.kind) {
    case "paused": {
      const title = t.searchLimits.pausedTitle(phrase(reopenWhen(notice.reopensAt, now, locale, clock), t.searchLimits.until));
      // Les mots du fondateur pour ces plafonds (lot 4 quater) ; le mois redit le jour exact de la reprise.
      const body = notice.reason === "day" ? t.result.capacityDayTitle : `${t.result.capacityMonthTitle} ${retryFrom(notice.reopensAt, now, locale, clock)}`;
      return { title, body };
    }
    case "used_up":
      return { title: t.searchLimits.usedUpTitle(notice.limit), body: retryFrom(notice.resetsAt, now, locale, clock) };
    case "low":
      return { title: t.searchLimits.remaining(notice.remaining), body: null };
  }
}

/** Messages de limite (écran Résultat, « Que cherchez-vous ? ») : le chiffre
 * de la part et l'heure de reprise quand le dernier compteur lu les donne,
 * sinon les textes d'avant. Le mois garde sa date, donnée par le refus. */
export function capacityCopy(
  reason: CapacityFailReason,
  resumesOn: string | null | undefined,
  known: SearchCapacityStatus | null,
  now: number,
  locale: Locale,
  clock: LocalClock = deviceClock
): [string, string] {
  const resetsAt = known && Date.parse(known.user.resetsAt) > now ? known.user.resetsAt : null;
  const retry = resetsAt ? retryFrom(resetsAt, now, locale, clock) : null;
  switch (reason) {
    case "capacity_user":
      return [known ? t.searchLimits.usedUpTitle(known.user.limit) : t.result.capacityUserTitle, retry ?? t.result.capacityUserTip];
    case "capacity_day":
      return [t.result.capacityDayTitle, retry ?? t.result.capacityDayTip];
    case "capacity_month":
      return [t.result.capacityMonthTitle, capacityMonthTip(resumesOn, locale)];
  }
}

// ---- Compteur partagé : une lecture pour l'accueil et le cadrage ----

const launchListeners = new Set<() => void>();

/** Une recherche part (photo, vidéo, vos mots) : le compteur lu avant est périmé. */
export function searchLaunched(): void {
  for (const listener of launchListeners) listener();
}

export function onSearchLaunched(listener: () => void): () => void {
  launchListeners.add(listener);
  return () => launchListeners.delete(listener);
}

export interface LimitsStore {
  /** Dernier compteur lu pour ce compte ; null : jamais lu, illisible, ou lu pour un autre compte. */
  current(owner: string | null): SearchCapacityStatus | null;
  /** Dernier compteur lu (messages de limite, juste après un lancement de ce compte). */
  latest(): SearchCapacityStatus | null;
  /** Relit le compteur, sauf lecture de moins de 20 s (ou en cours) et aucune reprise passée depuis. */
  refresh(owner: string | null, force?: boolean): Promise<void>;
  /** La prochaine visite relira le compteur (une recherche vient de partir). */
  markStale(): void;
  subscribe(listener: () => void): () => void;
}

function boundaryPassed(status: SearchCapacityStatus | null, now: number): boolean {
  if (!status) return false;
  return Date.parse(status.user.resetsAt) <= now || (status.service.status === "paused" && Date.parse(status.service.reopensAt) <= now);
}

export function createLimitsStore(read: () => Promise<SearchCapacityStatus | null>, now: () => number = Date.now): LimitsStore {
  let owner: string | null = null;
  let status: SearchCapacityStatus | null = null;
  let lastAttempt = Number.NEGATIVE_INFINITY;
  // Change avec le compte : une lecture partie pour un autre compte est ignorée.
  let generation = 0;
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function publish(next: SearchCapacityStatus | null) {
    if (next === status) return;
    status = next;
    for (const listener of listeners) listener();
  }

  return {
    current: (who) => (who !== null && who === owner ? status : null),
    latest: () => status,
    markStale: () => {
      lastAttempt = Number.NEGATIVE_INFINITY;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh(who, force = false) {
      if (who === null) return Promise.resolve();
      if (who !== owner) {
        owner = who;
        generation += 1;
        lastAttempt = Number.NEGATIVE_INFINITY;
        inFlight = null;
        publish(null);
      }
      if (inFlight) return inFlight;
      const at = now();
      if (!force && at - lastAttempt < FRESH_MS && !boundaryPassed(status, at)) return Promise.resolve();
      lastAttempt = at;
      const mine = generation;
      const request = read()
        .catch(() => null)
        .then((next) => {
          if (mine !== generation) return;
          inFlight = null;
          // Illisible ou en échec : rien d'annoncé, rien de bloqué (jamais l'ancien compteur).
          publish(next);
        });
      inFlight = request;
      return request;
    },
  };
}
