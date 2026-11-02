import type { SpotResult } from "./types";

// Relais en mémoire entre l'écran Analyse et l'écran Résultat, le temps du
// prototype (données fictives, pas de persistance nécessaire). À remplacer
// par une vraie requête par identifiant quand le backend sera rebranché.
let lastResult: SpotResult | null = null;

export function setLastSpotResult(result: SpotResult): void {
  lastResult = result;
}

export function getLastSpotResult(): SpotResult | null {
  return lastResult;
}

/** Voie B (lot c) : copie en mémoire périmée (« déjà lancée », propositions
 * des mots peut-être encore en route) — l'écran rouvert relira la recherche
 * sur le serveur. */
export function clearLastSpotResult(): void {
  lastResult = null;
}
