// Délais de l'app (lot « mesure du parcours », server_first_response) : une
// requête que l'APP cesse d'attendre n'est pas une requête annulée par la
// personne (« Annuler », écran quitté). Chaque délai de l'app abandonne sa
// requête par abortForTimeout, qui marque d'abord le signal : authorizedFetch
// (api.ts) compte alors un échec, à la durée où l'app a cessé d'attendre.
// Un WeakSet plutôt que AbortSignal.reason, pas sûr partout en React Native ;
// rien n'est gardé une fois le signal oublié. Imports relatifs : vitest.

const timedOut = new WeakSet<AbortSignal>();

/** Abandonne la requête de `controller` : son délai est dépassé. */
export function abortForTimeout(controller: AbortController): void {
  timedOut.add(controller.signal);
  controller.abort();
}

/** Abandonnée par un délai de l'app, et non par la personne ? */
export function wasTimedOut(signal: AbortSignal): boolean {
  return timedOut.has(signal);
}
