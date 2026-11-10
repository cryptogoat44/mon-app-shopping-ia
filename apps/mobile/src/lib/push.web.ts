// Site : jamais de notification sur le téléphone — aucun module natif, aucun
// appel au serveur, rien n'est proposé et l'interrupteur des Réglages est
// caché. Les alertes prix et stock s'y règlent quand même (cloches,
// interrupteur) : leurs notifications n'arrivent que sur l'app iPhone.
// Version app iPhone : push.ts.
import type { PushDecision, PushPermission } from "./push-state";

export async function pushSupported(): Promise<boolean> {
  return false;
}

export async function pushPermission(): Promise<PushPermission> {
  return "denied";
}

export async function loadPushDecision(): Promise<PushDecision | null> {
  return null;
}

export async function savePushDecision(): Promise<void> {}

export function enablePush(): Promise<PushPermission> {
  return Promise.reject(new Error("push_unavailable"));
}

export async function disablePush(): Promise<void> {}

export async function syncPushDevice(): Promise<void> {}

export async function forgetPushToken(): Promise<void> {}

export async function refreshPushToken(): Promise<void> {}

export async function listenToNotifications(): Promise<() => void> {
  return () => {};
}
