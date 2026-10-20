/** Délais entre deux essais de chargement du profil au démarrage. Leur
 * somme (~1 min) couvre le réveil du backend sur l'offre gratuite de
 * Render, qui peut prendre jusqu'à une minute. */
export const PROFILE_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000] as const;

/** Durée maximale d'UN essai de chargement du profil (2026-10-16) : un appel
 * resté sans réponse est abandonné puis relancé, au lieu de laisser l'écran
 * figé (vu deux fois dans les vérifications à l'écran : plus de 30 s). */
export const PROFILE_ATTEMPT_TIMEOUT_MS = 15_000;

export class AttemptTimeoutError extends Error {
  constructor(ms: number) {
    super(`Aucune réponse après ${ms} ms.`);
  }
}

/** Lance `task` avec un signal d'abandon, et relève AttemptTimeoutError au
 * bout de `ms`, même si `task` ignore le signal. */
export async function withTimeout<T>(ms: number, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Le délai l'emporte d'abord : l'abandon qui suit ne change plus l'erreur.
      reject(new AttemptTimeoutError(ms));
      controller.abort();
    }, ms);
  });
  try {
    return await Promise.race([task(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface RetryOptions {
  /** Délai avant chaque nouvel essai ; leur nombre fixe le nombre de
   * relances (essais au total = délais + 1). */
  delaysMs: readonly number[];
  /** false pour abandonner immédiatement (ex. session expirée : réessayer
   * ne changerait rien). */
  shouldRetry?: (error: unknown) => boolean;
  /** Appelé juste avant chaque attente, avec le numéro de l'essai raté (0 = premier). */
  onRetry?: (attempt: number, error: unknown) => void;
  /** true pour arrêter sans rien lancer de plus (écran quitté, déconnexion...). */
  isCancelled?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export class RetryCancelledError extends Error {
  constructor() {
    super("Relances annulées.");
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Exécute `fn`, et la relance après chaque délai de `delaysMs` tant
 * qu'elle échoue. Relève la dernière erreur si tous les essais échouent. */
export async function retryWithDelays<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { delaysMs, shouldRetry = () => true, onRetry, isCancelled = () => false, sleep = defaultSleep } = options;

  for (let attempt = 0; ; attempt++) {
    if (isCancelled()) throw new RetryCancelledError();
    try {
      return await fn();
    } catch (error) {
      const delay = delaysMs[attempt];
      if (delay === undefined || !shouldRetry(error)) throw error;
      onRetry?.(attempt, error);
      await sleep(delay);
    }
  }
}
