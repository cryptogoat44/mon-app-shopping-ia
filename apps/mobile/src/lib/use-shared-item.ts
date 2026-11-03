// Élément partagé en attente (lot « partager vers Spotto »), vu des écrans :
// pas connecté, on dit qu'il s'ouvrira après la connexion ; connecté, la zone
// de l'app ramène le Spotter au premier plan quand rien ne se perd, et le
// Spotter, affiché et libre, le prend pour l'ouvrir. Les décisions (logique
// pure, testée) et la mise en attente : shared-item.ts.
import { useEffect, useSyncExternalStore } from "react";
import { useIsFocused, useNavigationContainerRef, useRouter } from "expo-router";
import { useToast } from "./toast-context";
import { onSharedItemArrival, onSharedItemSignedOut, peekSharedItem, subscribeSharedItem, takeSharedItem, type SharedItem } from "./shared-item";

const nothingOnServer = () => null;

export function usePendingSharedItem(): SharedItem | null {
  return useSyncExternalStore(subscribeSharedItem, peekSharedItem, nothingOnServer);
}

/** Pas connecté : on dit une fois que l'élément s'ouvrira après la connexion ;
 * un élément refusé, lui, est dit tout de suite. */
export function useSharedItemWaitingNotice(waiting: boolean): void {
  const pending = usePendingSharedItem();
  const { showToast } = useToast();
  useEffect(() => {
    if (waiting && pending) onSharedItemSignedOut(showToast);
  }, [waiting, pending, showToast]);
}

/** Zone connectée : un partage arrive pendant qu'un autre écran est affiché.
 * Rien à perdre (onglets, pages de simple lecture) : retour au Spotter, qui
 * l'ouvrira — comme « Fermer » quand des écrans sont empilés, sinon simple
 * changement d'onglet. Recherche en cours, saisie, écran hors de la zone : on
 * reste, et l'élément attend le Spotter (shared-item.ts, onSharedItemArrival).
 * Les écrans ouverts sont lus au moment de l'arrivée (état de navigation). */
export function useSharedItemArrival(): void {
  const router = useRouter();
  const navigation = useNavigationContainerRef();
  const { showToast } = useToast();
  useEffect(
    () =>
      subscribeSharedItem(() =>
        onSharedItemArrival(navigation.isReady() ? navigation.getRootState() : null, {
          backToSpotter: () => {
            if (router.canDismiss()) router.dismissTo("/");
            else router.navigate("/");
          },
          say: showToast,
        })
      ),
    [router, navigation, showToast]
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
