import type { SpotResult } from "./types";

// Relais en mémoire entre l'écran Analyse et l'écran Résultat : le résultat
// d'un lancement, lu UNE fois par l'écran Résultat, qui l'oublie aussitôt
// (app/(app)/spot/result.tsx). Tout retour sur l'écran — Précédent ou Suivant
// du navigateur, « Récemment spottées » — relit la recherche sur le serveur,
// à jour (voie B lancée, propositions de vos mots arrivées, signalements).
let lastResult: SpotResult | null = null;

export function setLastSpotResult(result: SpotResult): void {
  lastResult = result;
}

export function getLastSpotResult(): SpotResult | null {
  return lastResult;
}

/** Oublie la copie : l'écran rouvert relira la recherche sur le serveur. */
export function clearLastSpotResult(): void {
  lastResult = null;
}

// Ce que seule la réponse du lancement contient, et que le serveur
// n'enregistre pas : « Triées selon vos mots » et la requête des boutiques
// (« Recherche : “…” »). Gardés le temps de la session, pour qu'une
// recherche rouverte les affiche encore ; jamais écrits sur l'appareil.
type LaunchExtras = { sortedByWords: boolean; query: string | null };
const launchExtras = new Map<string, LaunchExtras>();
const LAUNCH_EXTRAS_MAX = 20;

/** Garde les mentions du lancement de ce résultat (20 recherches au plus). */
export function rememberLaunchExtras(result: SpotResult): void {
  if (!result.searchId) return;
  const extras: LaunchExtras = { sortedByWords: result.sortedByWords === true, query: result.complement?.query ?? null };
  if (!extras.sortedByWords && extras.query === null) return;
  launchExtras.delete(result.searchId);
  launchExtras.set(result.searchId, extras);
  if (launchExtras.size > LAUNCH_EXTRAS_MAX) {
    const oldest = launchExtras.keys().next().value;
    if (oldest !== undefined) launchExtras.delete(oldest);
  }
}

/** Le résultat relu sur le serveur, avec les mentions de son lancement
 * quand elles sont connues dans cette session. */
export function withLaunchExtras(result: SpotResult): SpotResult {
  const extras = result.searchId ? launchExtras.get(result.searchId) : undefined;
  if (!extras) return result;
  const complement = result.complement && result.complement.query === null && extras.query !== null ? { ...result.complement, query: extras.query } : result.complement;
  return {
    ...result,
    ...(extras.sortedByWords ? { sortedByWords: true } : {}),
    ...(complement ? { complement } : {}),
  };
}
