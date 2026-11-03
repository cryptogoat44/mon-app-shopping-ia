// Un seul appel à la fois pour une même clé (lot c, voie C, 2026-11-02),
// sans dépendance. Deux lancements simultanés de la même image (« Annuler »
// puis relance immédiate, deux appareils) attendent l'appel déjà en cours au
// lieu d'en payer un second : la règle « jamais deux fois les mêmes recherches
// pour la même image » tient aussi pendant l'appel, pas seulement après
// l'écriture du cache.
// - Une simple table en mémoire des promesses en cours. Un échec est retiré
//   dès qu'il est réglé : il n'est jamais partagé avec un appel lancé après.
// - Une réussite peut rester un peu plus (`holdUntil`) : jusqu'à ce que la
//   promesse rendue par holdUntil soit réglée, par exemple l'écriture du cache
//   (bornée par l'appelant). Un lancement arrivé entre la fin de l'appel et
//   l'écriture reçoit alors la même réponse, au lieu de payer à nouveau la
//   même recherche. Personne n'attend cette écriture : seule l'entrée reste.
// - Limite connue : une seule instance de Render. Plusieurs instances
//   pourraient encore lancer le même appel en même temps (hors de ce lot).

const pending = new Map<string, Promise<unknown>>();

/** Lance `fn`, ou rejoint l'appel déjà en cours pour `key` (même résultat,
 * même erreur). `holdUntil` : après une réussite, l'entrée reste jusqu'à ce
 * que la promesse qu'il rend soit réglée (null : retirée tout de suite). */
export function singleFlight<T>(key: string, fn: () => Promise<T>, holdUntil?: (value: T) => PromiseLike<unknown> | null): Promise<T> {
  const current = pending.get(key);
  if (current) return current as Promise<T>;
  const promise: Promise<T> = (async () => fn())();
  const forget = () => {
    if (pending.get(key) === promise) pending.delete(key);
  };
  pending.set(key, promise);
  // Inscrit avant tout autre lecteur : sans maintien, l'entrée est retirée
  // avant que ceux qui attendent ne reçoivent le résultat.
  promise.then(
    (value) => {
      let hold: PromiseLike<unknown> | null = null;
      try {
        hold = holdUntil?.(value) ?? null;
      } catch {
        hold = null;
      }
      if (hold) Promise.resolve(hold).then(forget, forget);
      else forget();
    },
    forget
  );
  return promise;
}

/** Appels en cours (tests seulement). */
export function singleFlightPending(): number {
  return pending.size;
}
