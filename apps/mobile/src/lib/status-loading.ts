// Disponibilités lues sur le serveur (messagerie, collections, alertes prix et
// stock) : « sont-elles là ? ». Les écrans ne lisent que l'état gardé en
// mémoire, qui commence à « indisponible ». Longtemps, seule la barre
// d'onglets posait la question au serveur : un écran ouvert directement par
// son adresse, ou rechargé dans le navigateur (profil d'un membre, collection
// d'un ami, envie, Réglages…), n'a pas de barre d'onglets ; « Message »,
// « Collections », « En parler »… y restaient cachés.
//
// Ici, de quoi s'assurer que chaque disponibilité a été demandée, une seule
// fois par compte, quel que soit l'écran ouvert en premier :
// - `request` : demande au serveur, toujours (les relectures d'aujourd'hui :
//   barre d'onglets, après un message lu…) ; la demande est suivie ;
// - `ensure` : ne demande que ce qui n'a ni réponse ni demande en cours, et
//   rien sans compte connecté. Deux appels en même temps : une seule demande.
// Rien n'est affiché avant la réponse, et « indisponible » reste caché :
// l'état en mémoire n'est écrit que par la réponse du serveur (lib/api.ts).
// Logique pure (tests/status-loading.test.ts).

type StatusRequests = Record<string, () => Promise<unknown>>;

export interface StatusLoader<R extends StatusRequests> {
  /** Demande cette disponibilité au serveur, à chaque appel. */
  request<K extends keyof R>(kind: K): ReturnType<R[K]>;
  /** S'assure que tout a été demandé pour ce compte ; résolue quand tout a
   * répondu (ou échoué : hors ligne, ce sera redemandé au prochain appel). */
  ensure(userId: string | null | undefined): Promise<void>;
}

/** `onAccountChange` : appelée quand le compte connecté n'est plus celui
 * d'avant (autre compte, ou déconnexion) — de quoi remettre l'état gardé en
 * mémoire à « indisponible ». Revue de sécurité du 12 novembre 2026 : sans
 * cela, sur un ordinateur partagé, le compte suivant voyait un instant le
 * nombre de conversations non lues du compte précédent. */
export function createStatusLoader<R extends StatusRequests>(requests: R, onAccountChange: () => void = () => {}): StatusLoader<R> {
  const kinds = Object.keys(requests) as (keyof R)[];
  /** Demandes en cours, d'où qu'elles viennent. */
  const pending = new Map<keyof R, Set<Promise<unknown>>>(kinds.map((kind) => [kind, new Set<Promise<unknown>>()]));
  /** Le serveur a répondu (disponible ou non) : plus rien à demander. */
  const answered = new Set<keyof R>();
  let owner: string | null = null;
  /** Augmente à chaque changement de compte : une réponse partie pour un autre compte se reconnaît. */
  let account = 0;
  /** Une réponse de l'ancien compte est arrivée après la déconnexion. */
  let stale = false;

  function request<K extends keyof R>(kind: K): ReturnType<R[K]> {
    const running = pending.get(kind)!;
    const startedFor = account;
    const promise = requests[kind]!() as ReturnType<R[K]>;
    running.add(promise);
    promise.then(
      () => {
        running.delete(promise);
        if (startedFor === account) {
          answered.add(kind);
          return;
        }
        // Réponse demandée pour le compte précédent, arrivée après le
        // changement : elle vient d'être écrite en mémoire, mais ne vaut pas
        // pour le compte actuel. Redemandée pour lui (sauf demande déjà en
        // route) ; sans compte, la mémoire sera vidée à la prochaine connexion.
        if (owner === null) stale = true;
        else if (running.size === 0) request(kind);
      },
      // Sans réponse (hors ligne) : rien n'est connu, à redemander.
      () => {
        running.delete(promise);
      }
    );
    return promise;
  }

  function ensure(userId: string | null | undefined): Promise<void> {
    const next = userId || null;
    // Un autre compte sur le même appareil, ou plus de compte : ce qui est
    // gardé en mémoire est oublié, tout est à redemander, et les demandes
    // encore en route (parties pour l'ancien compte) ne comptent plus.
    if (owner !== null && owner !== next) {
      account += 1;
      answered.clear();
      for (const running of pending.values()) running.clear();
      onAccountChange();
    } else if (stale && next !== null) {
      onAccountChange();
    }
    if (next !== null) stale = false;
    owner = next;
    // Déconnecté : rien n'est demandé.
    if (next === null) return Promise.resolve();
    const awaited: Promise<unknown>[] = [];
    for (const kind of kinds) {
      if (answered.has(kind)) continue;
      const running = pending.get(kind)!;
      if (running.size === 0) request(kind);
      awaited.push(...running);
    }
    return Promise.allSettled(awaited).then(() => undefined);
  }

  return { request, ensure };
}
