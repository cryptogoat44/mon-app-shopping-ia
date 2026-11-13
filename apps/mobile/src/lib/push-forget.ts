// « Oubli en attente » d'un appareil (lot « durcissement des alertes », revue
// de sécurité alertes-03 et app-06) : sans module natif ni écran, testé par
// vitest (tests/push.test.ts) ; branché par lib/push.ts (app iPhone).
//
// Le problème : l'appareil n'était oublié sur le serveur que par la
// déconnexion faite sur CE téléphone, avec du réseau. Session fermée
// ailleurs (mot de passe changé, « Se déconnecter » sur un autre appareil),
// ou déconnexion sans réseau : le téléphone restait enregistré et continuait
// d'afficher les notifications du compte.
//
// La règle : dès que la session de cet appareil se termine (ou que l'oubli
// normal échoue), son jeton est noté « à oublier » ; l'app demande alors au
// serveur de l'oublier par le jeton seul (POST /api/push-token/forget, sans
// session : avoir le jeton, c'est être cet appareil), tout de suite, puis à
// chaque ouverture et à chaque retour au premier plan, jusqu'à ce que le
// serveur réponde. À la connexion suivante, cet oubli passe AVANT tout nouvel
// enregistrement de l'appareil (jamais l'inverse : il effacerait le nouvel
// enregistrement). Un enregistrement réussi du même jeton le remplace.
// Le rangement de l'appareil peut échouer (mode privé, stockage plein) :
// chaque lecture et écriture est protégée, rien ne plante.
import { isExpoPushToken } from "@monapp/shared-types";

/** Jeton d'Expo de cet appareil, à oublier sur le serveur dès que possible. */
export const PENDING_FORGET_KEY = "spotto.push-token.a-oublier";

/** Le rangement de l'appareil (AsyncStorage dans l'app). */
export interface ForgetStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Le jeton en attente d'oubli, ou null (rien, illisible, ou pas un jeton d'Expo). */
export async function pendingForget(store: ForgetStore): Promise<string | null> {
  try {
    const token = await store.getItem(PENDING_FORGET_KEY);
    return isExpoPushToken(token) ? token : null;
  } catch {
    return null;
  }
}

/** Note ce jeton « à oublier ». false : rien n'a pu être noté. */
export async function rememberForget(store: ForgetStore, token: string): Promise<boolean> {
  if (!isExpoPushToken(token)) return false;
  try {
    await store.setItem(PENDING_FORGET_KEY, token);
    return true;
  } catch {
    return false;
  }
}

/** Oublie la note (le serveur a répondu, ou ce jeton vient d'être enregistré de nouveau). */
export async function clearForget(store: ForgetStore, onlyToken?: string): Promise<void> {
  try {
    if (onlyToken !== undefined && (await store.getItem(PENDING_FORGET_KEY)) !== onlyToken) return;
    await store.removeItem(PENDING_FORGET_KEY);
  } catch {
    // Rien à faire : le prochain essai réessaiera.
  }
}

/** Demande au serveur d'oublier le jeton noté, s'il y en a un. true : plus
 * rien en attente ; false : le serveur n'a pas répondu (la note reste, pour
 * le prochain essai). `forget` : l'appel au serveur (sans session). */
export async function flushForget(store: ForgetStore, forget: (token: string) => Promise<void>): Promise<boolean> {
  const token = await pendingForget(store);
  if (!token) return true;
  try {
    await forget(token);
  } catch {
    return false;
  }
  await clearForget(store, token);
  return true;
}

/** File d'attente d'une seule place : oublis et enregistrements de l'appareil
 * passent l'un après l'autre, dans l'ordre demandé (un oubli lancé avant un
 * enregistrement ne peut jamais arriver après lui au serveur). */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = last.then(task, task);
    last = run.catch(() => undefined);
    return run;
  };
}
