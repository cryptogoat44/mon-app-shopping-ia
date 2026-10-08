// Plafond des recherches atteint (lot 4 quater) : le motif d'échec affiché par
// l'écran Résultat — plafond du jour ou du mois (tout le service), ou part
// de la personne pour la journée. Jamais de date (décision du fondateur,
// 2026-10-08). Imports relatifs : fichier testé par vitest.
import { parseSearchCapacityError, type SearchCapacityLimit } from "@monapp/shared-types";

export type CapacityFailReason = `capacity_${SearchCapacityLimit}`;

/** Corps d'une erreur 429 du serveur → motif d'échec ; null si ce n'est pas un plafond atteint. */
export function capacityFailReason(body: unknown): CapacityFailReason | null {
  const limit = parseSearchCapacityError(body);
  return limit ? `capacity_${limit}` : null;
}
