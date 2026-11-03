// Élément partagé en attente (lot « partager vers Spotto »), vu des écrans :
// pas connecté, on dit qu'il s'ouvrira après la connexion ; connecté, la zone
// de l'app ramène le Spotter au premier plan, et le Spotter, affiché et libre,
// le prend pour l'ouvrir. La mise en attente elle-même : shared-item.ts.
import { useEffect, useSyncExternalStore } from "react";
import { useIsFocused, useRouter } from "expo-router";
import { t } from "../i18n";
import { useToast } from "./toast-context";
import { peekSharedItem, subscribeSharedItem, takeSharedItem, type SharedItem } from "./shared-item";

const nothingOnServer = () => null;

export function usePendingSharedItem(): SharedItem | null {
  return useSyncExternalStore(subscribeSharedItem, peekSharedItem, nothingOnServer);
}

/** Pas connecté : on dit une fois que l'élément s'ouvrira après la connexion
 * (un élément refusé, lui, ne s'ouvrira pas : son message vient après). */
export function useSharedItemWaitingNotice(waiting: boolean): void {
  const pending = usePendingSharedItem();
  const { showToast } = useToast();
  useEffect(() => {
    if (waiting && pending && pending.kind !== "refused") showToast(t.share.signInFirst);
  }, [waiting, pending, showToast]);
}

/** Zone connectée : un partage arrive pendant qu'un autre écran est affiché —
 * retour au Spotter, qui l'ouvrira : comme « Fermer » quand des écrans sont
 * empilés (parcours, réglages, fenêtre), sinon simple changement d'onglet
 * (le retour en arrière n'a pas de sens entre onglets). À la connexion, le
 * Spotter est déjà le premier écran : rien à faire. */
export function useSharedItemArrival(): void {
  const router = useRouter();
  useEffect(
    () =>
      subscribeSharedItem(() => {
        if (!peekSharedItem()) return;
        if (router.canDismiss()) router.dismissTo("/");
        else router.navigate("/");
      }),
    [router]
  );
}

/** Spotter affiché et libre (aucun import en cours) : il prend l'élément et l'ouvre, une seule fois. */
export function useSharedItemOpener(open: (item: SharedItem) => void, idle: boolean): void {
  const pending = usePendingSharedItem();
  const focused = useIsFocused();
  useEffect(() => {
    if (!pending || !focused || !idle) return;
    const item = takeSharedItem();
    if (item) open(item);
  }, [pending, focused, idle, open]);
}
