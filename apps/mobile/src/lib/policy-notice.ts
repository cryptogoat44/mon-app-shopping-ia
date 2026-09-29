// Information unique après une mise à jour de document qui ne demande pas de
// nouvelle acceptation (décision du fondateur, 2026-09-29 : le lieu
// d'hébergement relève de l'information, pas du consentement).
// Imports relatifs : ce fichier est testé par vitest.
import type { ConsentStatus, LegalDocumentType } from "@monapp/shared-types";

export interface PolicyNotice {
  id: string;
  document: LegalDocumentType;
  version: string;
}

/** Vrai si la personne doit voir l'information : elle n'a pas accepté la
 * version qui l'accompagne (compte antérieur à la mise à jour) et ne l'a
 * pas encore vue sur cet appareil. Un compte créé après la mise à jour a
 * accepté la nouvelle version : il n'a rien à apprendre. */
export function shouldShowNotice(statuses: readonly ConsentStatus[], seenIds: readonly string[], notice: PolicyNotice): boolean {
  if (seenIds.includes(notice.id)) return false;
  const accepted = statuses.find((status) => status.type === notice.document);
  return accepted?.version !== notice.version;
}

/** Demande « statistiques d'usage » : une seule fois, tant qu'aucun choix
 * (accord ou refus) n'a été enregistré pour ce compte. Le choix est gardé
 * sur le serveur : la demande ne revient sur aucun appareil. */
export function shouldAskAnalytics(statuses: readonly ConsentStatus[]): boolean {
  const analytics = statuses.find((status) => status.type === "analytics");
  return !analytics?.decidedAt;
}

/** Consentement « statistiques d'usage » en vigueur (accord, texte actuel). */
export function hasAnalyticsConsent(statuses: readonly ConsentStatus[]): boolean {
  return statuses.find((status) => status.type === "analytics")?.isCurrent === true;
}

/** Clé de stockage propre à chaque compte (un appareil partagé). */
export function seenNoticesKey(userId: string): string {
  return `spotto.informations-vues.${userId}`;
}

/** Lit la liste enregistrée ; toute valeur illisible compte comme vide. */
export function parseSeenNotices(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
