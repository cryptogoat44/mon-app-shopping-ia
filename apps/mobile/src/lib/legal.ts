// Logique pure des documents juridiques (Lot Q, bloc 5) : dates, versions,
// repérage des champs laissés au fondateur. Imports relatifs : ce fichier
// est testé par vitest, qui ne connaît pas l'alias « @/ ».
import type { ConsentStatus, LegalDocumentType, VersionedConsentType } from "@monapp/shared-types";
import { PLACEHOLDER_PATTERN } from "../legal/types";

export function formatLongDate(isoOrDay: string): string {
  // « 2026-09-25 » seul est lu à midi pour ne jamais changer de jour selon le fuseau.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(isoOrDay) ? new Date(`${isoOrDay}T12:00:00`) : new Date(isoOrDay);
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

/** « projet-2026-09-25 » → { isDraft: true, day: "2026-09-25" }. */
export function parseLegalVersion(version: string): { isDraft: boolean; day: string | null } {
  const day = version.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  return { isDraft: version.startsWith("projet-"), day };
}

export interface TextPart {
  text: string;
  placeholder: boolean;
}

/** Découpe un texte en morceaux, en isolant les « [À compléter : …] »,
 * « [À décider : …] » et « [À vérifier : …] » pour les mettre en évidence. */
export function splitPlaceholders(text: string): TextPart[] {
  return text
    .split(PLACEHOLDER_PATTERN)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, placeholder: PLACEHOLDER_PATTERN.test(part) }));
}

/** Statut d'un consentement, ou null s'il est absent. */
export function consentFor(statuses: readonly ConsentStatus[], type: VersionedConsentType): ConsentStatus | null {
  return statuses.find((status) => status.type === type) ?? null;
}

/** Ce qu'il reste à accepter pour être à jour sur un document. Les
 * conditions d'utilisation vont avec la déclaration d'âge : les comptes qui
 * ne l'ont pas encore faite la confirment en même temps (décision du
 * fondateur, 2026-09-25). */
export function pendingConsents(statuses: readonly ConsentStatus[], document: LegalDocumentType): VersionedConsentType[] {
  const required: VersionedConsentType[] = document === "terms" ? ["terms", "age_declaration"] : [document];
  return required.filter((type) => !consentFor(statuses, type)?.isCurrent);
}
