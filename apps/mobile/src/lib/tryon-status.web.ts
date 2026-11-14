// Essayage virtuel photo (site) : disponibilité lue sur le serveur, gardée en
// mémoire et partagée entre le bouton « Essayer » des fiches et la ligne des
// Réglages. Elle commence à « éteint » ; seule une réponse enabled: true du
// serveur, lisible en entier, montre quelque chose. Demandée une fois par
// compte (lib/status-loading.ts) ; changement de compte ou déconnexion :
// retour à « éteint », rien du compte précédent n'est montré au suivant
// (revue de sécurité du 12 novembre 2026). Fichier .web : jamais dans l'app
// iPhone. Logique sans écran, testée (tests/tryon-api.test.ts).
import type { TryonAgeGate, TryonConsentState, TryonRemaining, TryonStatus } from "@monapp/shared-types";
import { createStatusLoader } from "./status-loading";
import { isNetworkError } from "./network-error";
import { fetchTryonStatus } from "./tryon-api.web";
import { TRYON_OFF } from "./tryon-read.web";

let current: TryonStatus = TRYON_OFF;
const listeners = new Set<(status: TryonStatus) => void>();

function sameStatus(a: TryonStatus, b: TryonStatus): boolean {
  if (!a.enabled || !b.enabled) return a.enabled === b.enabled;
  return (
    a.ageGate === b.ageGate &&
    a.consent.required === b.consent.required &&
    a.consent.version === b.consent.version &&
    a.remaining.free === b.remaining.free &&
    a.remaining.bonus === b.remaining.bonus &&
    a.remaining.nextReset === b.remaining.nextReset
  );
}

export function tryonStatus(): TryonStatus {
  return current;
}

/** Nouvel état : les écrans abonnés sont prévenus s'il change. */
export function setTryonStatus(next: TryonStatus): void {
  if (sameStatus(current, next)) return;
  current = next;
  for (const listener of listeners) listener(current);
}

export function onTryonStatus(listener: (status: TryonStatus) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Réponse d'une action (porte d'âge, consentement, essai) : l'état connu
 * suit sans relire le statut. Sans effet quand l'essayage est éteint. */
export function updateTryonStatus(change: { ageGate?: TryonAgeGate; consent?: TryonConsentState; remaining?: TryonRemaining }): void {
  if (!current.enabled) return;
  setTryonStatus({ ...current, ...change });
}

async function loadTryonStatus(): Promise<TryonStatus> {
  let status: TryonStatus;
  try {
    status = await fetchTryonStatus();
  } catch (e) {
    // Hors ligne : l'état connu reste, redemandé plus tard. Toute autre
    // erreur (route absente d'un ancien serveur, session expirée) : éteint.
    if (isNetworkError(e)) throw e;
    status = TRYON_OFF;
  }
  setTryonStatus(status);
  return status;
}

const loader = createStatusLoader({ tryon: loadTryonStatus }, () => setTryonStatus(TRYON_OFF));

/** Demandé une fois par compte, quel que soit l'écran ouvert en premier. */
export function ensureTryonStatus(userId: string | null | undefined): Promise<void> {
  return loader.ensure(userId);
}

/** Relu à chaque ouverture de l'essayage (état frais : âge, consentement, essais restants). */
export function refreshTryonStatus(): Promise<TryonStatus> {
  return loader.request("tryon");
}
