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
