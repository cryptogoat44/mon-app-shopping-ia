// Un seul appel à la fois pour une même clé (lot c, voie C, 2026-11-02),
// sans dépendance. Deux lancements simultanés de la même image (« Annuler »
// puis relance immédiate, deux appareils) attendent l'appel déjà en cours au
// lieu d'en payer un second : la règle « jamais deux fois les mêmes recherches
// pour la même image » tient aussi pendant l'appel, pas seulement après
// l'écriture du cache.
// - Une simple table en mémoire des promesses en cours ; une entrée est
//   retirée dès que sa promesse est réglée (réussite ou échec) : un échec
//   n'est jamais partagé avec un appel lancé après.
// - Limite connue : une seule instance de Render. Plusieurs instances
//   pourraient encore lancer le même appel en même temps (hors de ce lot).

const pending = new Map<string, Promise<unknown>>();

/** Lance `fn`, ou rejoint l'appel déjà en cours pour `key` (même résultat,
 * même erreur). */
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const current = pending.get(key);
  if (current) return current as Promise<T>;
  const promise: Promise<T> = (async () => fn())().finally(() => {
    if (pending.get(key) === promise) pending.delete(key);
  });
  pending.set(key, promise);
  return promise;
}

/** Appels en cours (tests seulement). */
export function singleFlightPending(): number {
  return pending.size;
}
