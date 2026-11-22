// Temps d'attente des statistiques d'usage (lot « mesure du parcours ») :
// une horloge qui ne recule pas (performance.now quand elle existe : un
// réglage de l'heure pendant l'attente ne fausse rien), remplacée dans les
// tests pour des durées exactes. Seules les différences comptent : jamais
// une heure envoyée. Imports relatifs : fichier testé par vitest.

type Clock = () => number;

const systemClock: Clock = () => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now());

let clock: Clock = systemClock;

/** L'instant présent, en millisecondes (origine quelconque). */
export function waitNow(): number {
  return clock();
}

/** Millisecondes écoulées depuis `start` (lu avec waitNow). */
export function waitSince(start: number): number {
  return clock() - start;
}

/** Tests uniquement : horloge simulée ; null rend celle du système. */
export function __setWaitClock(next: Clock | null): void {
  clock = next ?? systemClock;
}
