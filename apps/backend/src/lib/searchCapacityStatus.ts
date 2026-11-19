// Lot limites annoncées (2026-11-03) : ce que l'app montre AVANT l'effort —
// Spotter en pause (jusqu'à quand), ou les dernières recherches du jour —,
// tiré d'une simple lecture de serpapi_quota (rien n'est réservé). Fonctions
// pures, horloge passée en paramètre : testées sans base.
// Quotas par membre (lot quotas, 0053) : la part du mois de la personne
// (monthlyQuota) et, pour un compte gratuit, les plafonds globaux réduits de
// la réserve des abonnés, comme serpapi_quota_v2 les applique.
import type { SearchCapacityStatus, SearchMonthlyQuota } from "@monapp/shared-types";
import { MAX_CALLS_PER_PHOTO } from "./deadline.js";
import { reducedCap, type SearchTier } from "./memberQuotas.js";
import type { QuotaRow, SearchCaps } from "./searchCapacity.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// « 2026-11-03 00:00 » : la date et l'heure à Paris, comme la base les compte.
const PARIS_DATE_TIME = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Minuit, heure de Paris, du jour « AAAA-MM-JJ » : la base y fait commencer
 * ses journées et ses cycles mensuels. */
export function parisMidnight(day: string): Date {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  // Paris a 1 h d'avance sur UTC l'hiver, 2 h l'été : son minuit tombe à
  // 23 h ou à 22 h UTC la veille (jamais pendant un changement d'heure, fait à 1 h UTC).
  for (const hours of [1, 2]) {
    const at = new Date(utcMidnight - hours * HOUR_MS);
    if (PARIS_DATE_TIME.format(at) === `${day} 00:00`) return at;
  }
  throw new Error(`Minuit à Paris introuvable pour ${day}`);
}

/** Le minuit (heure de Paris) qui suit `now` : la part de chaque personne et
 * le plafond du jour repartent de zéro. */
export function nextParisMidnight(now: Date): Date {
  const today = PARIS_DATE_TIME.format(now).slice(0, 10);
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  return parisMidnight(tomorrow);
}

/** Le 1er du mois qui suit `now`, à Paris (« AAAA-MM-JJ ») : la part du mois
 * de chaque personne repart de zéro à son minuit (heure de Paris), quel que
 * soit le jour de renouvellement de SerpApi. */
export function nextParisMonthStart(now: Date): string {
  const [year, month] = PARIS_DATE_TIME.format(now).slice(0, 7).split("-").map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/** La part du mois telle que l'app la lit ; null : aucune part du mois (abonné sans garde-fou). */
export function monthlyQuotaOf(row: QuotaRow, tier: SearchTier, now: Date): SearchMonthlyQuota | null {
  if (tier.monthlyCap === null) return null;
  const used = row.user_month_count ?? 0;
  const resetsOn = row.month_resets_on ?? nextParisMonthStart(now);
  return { limit: tier.monthlyCap, used, remaining: Math.max(0, tier.monthlyCap - used), resetsOn, resetsAt: parisMidnight(resetsOn).toISOString() };
}

/** Recherches réelles qu'une photo peut coûter au plus : 1 sans la voie C ;
 * avec elle, Lens + les boutiques + vos mots (MAX_CALLS_PER_PHOTO). Pris au
 * plus haut dès que la voie C est allumée, même sans son étape IA : prudent. */
export function callsPerPhoto(voieCOn: boolean): number {
  return voieCOn ? MAX_CALLS_PER_PHOTO : 1;
}

/** État lu par l'app : la part de la personne, le service, et ce qu'il reste
 * vraiment à la personne aujourd'hui. Les mêmes comparaisons que serpapi_quota
 * (0022, 0027, 0028), le mois d'abord : sa pause dure jusqu'au renouvellement.
 * `tier` (0053) : les plafonds du service vus par cette personne (réduits de
 * la réserve des abonnés pour un compte gratuit), et sa part du mois ; sans
 * lui (base sans 0053), la réponse d'avant, sans monthlyQuota. */
export function capacityStatus(row: QuotaRow, caps: SearchCaps, perPhoto: number, now: Date, tier: SearchTier | null = null): SearchCapacityStatus {
  const resetsAt = nextParisMidnight(now).toISOString();
  const userRemaining = Math.max(0, caps.userDaily - row.user_day_count);
  const reserve = tier?.reservePercent ?? 0;
  const monthLeft = reducedCap(caps.monthly, reserve) - row.month_count;
  const dayLeft = reducedCap(caps.daily, reserve) - row.day_count;
  const service: SearchCapacityStatus["service"] =
    monthLeft <= 0
      ? { status: "paused", reason: "month", reopensAt: parisMidnight(row.next_renewal).toISOString() }
      : dayLeft <= 0
        ? { status: "paused", reason: "day", reopensAt: resetsAt }
        : { status: "open" };
  // Le service compte des APPELS, la part de la personne des PHOTOS. Seul le
  // premier appel d'une photo (Lens) est indispensable : les appels de la
  // voie C sont sautés, sans refus, quand le plafond est atteint. Avec N
  // appels restants, ceil(N / appels par photo) photos passent donc à coup
  // sûr, même si chacune prend le plus d'appels possible (sauf si d'autres
  // personnes les prennent avant) : jamais plus que ce qui peut passer.
  const callsLeft = Math.max(0, Math.min(monthLeft, dayLeft));
  const photosLeft = Math.ceil(callsLeft / Math.max(1, perPhoto));
  const user = { used: row.user_day_count, limit: caps.userDaily, remaining: userRemaining, resetsAt };
  if (!tier) return { user, service, remainingToday: Math.min(userRemaining, photosLeft) };
  // La part du mois borne aussi ce qui reste aujourd'hui.
  const monthlyQuota = monthlyQuotaOf(row, tier, now);
  return { user, service, remainingToday: Math.min(userRemaining, photosLeft, monthlyQuota?.remaining ?? Number.POSITIVE_INFINITY), monthlyQuota };
}
