// Budget de temps d'un lancement avec la voie C (lot c, 2026-11-02), sans
// dépendance (fonctions pures, horloge injectable pour les tests).
// - T0 : juste après la lecture du formulaire du lancement ; l'envoi de la
//   photo par le réseau mobile n'est pas compté.
// - Le complément (IA puis Google Shopping) ne dépasse jamais T0 + 14 s, et
//   garde 1,5 s pour l'enregistrement.
// - Lens a son PROPRE plafond fixe de 12 s, jamais raccourci par le temps
//   passé avant lui : le complément ne coûte jamais le résultat de Lens.
// - Les appels à Supabase n'ont pas de délai : l'enregistrement est mesuré
//   (total_seconds, overBudget dans « Mesure complément »), pas borné.

/** Budget de la voie C, en millisecondes. Le complément ne tourne que si Lens
 * a été rapide (≈ 7 s au plus), ce que le fondateur doit savoir. */
export const VOIE_C_BUDGET = {
  /** Fin du complément : T0 + 14 s. */
  totalMs: 14_000,
  /** Gardé pour l'enregistrement, après le complément. */
  saveReserveMs: 1_500,
  /** Plafond fixe de Lens quand la voie C est allumée (15 s sinon, comme avant). */
  lensTimeoutMs: 12_000,
  /** L'IA : 3 s au plus ; lancée seulement si elle peut avoir 1 s. */
  aiMaxMs: 3_000,
  aiMinMs: 1_000,
  /** Google Shopping avec la requête de l'IA : 5 s au plus, 2,5 s au moins. */
  shoppingMaxMs: 5_000,
  shoppingMinMs: 2_500,
  /** Google Shopping avec vos mots (voie B) : 10 s au plus. */
  textShoppingMaxMs: 10_000,
  /** Chaque lecture du cache : au-delà, elle vaut « absent ». */
  cacheReadMs: 800,
} as const;

/** Recherches réelles au plus par photo (une ligne de recherche) : Lens (0 s'il
 * vient du cache, sinon 1) + boutiques avec la requête de l'IA (0 ou 1) + vos
 * mots (0 ou 1). Garanti par la ligne, jamais par le cache. */
export const MAX_CALLS_PER_PHOTO = 3;

export interface Deadline {
  /** Instant de départ (T0), en millisecondes. */
  readonly t0: number;
  readonly totalMs: number;
  /** Temps écoulé depuis T0. */
  elapsedMs(): number;
  /** Temps restant avant T0 + totalMs (négatif une fois dépassé). */
  remainingMs(): number;
  /** Délai d'une étape : min(maxMs, restant − keepMs), arrondi à la
   * milliseconde inférieure ; null sous 1 ms (l'appelant saute alors l'étape). */
  stepTimeoutMs(maxMs: number, keepMs: number): number | null;
}

export function startDeadline(t0: number, totalMs: number, now: () => number = Date.now): Deadline {
  const remainingMs = () => t0 + totalMs - now();
  return {
    t0,
    totalMs,
    elapsedMs: () => now() - t0,
    remainingMs,
    stepTimeoutMs(maxMs, keepMs) {
      const timeout = Math.floor(Math.min(maxMs, remainingMs() - keepMs));
      return timeout >= 1 ? timeout : null;
    },
  };
}

/** Recherches réelles encore permises pour cette photo (0 au moins). Un
 * 4ᵉ appel est toujours refusé. */
export function photoCallsLeft(lensCalled: boolean, shoppingCalls: number): number {
  return Math.max(0, MAX_CALLS_PER_PHOTO - (lensCalled ? 1 : 0) - shoppingCalls);
}
