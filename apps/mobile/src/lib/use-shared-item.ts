// Élément partagé en attente (lot « partager vers Spotto »), vu des écrans :
// pas connecté, on dit qu'il s'ouvrira après la connexion ; connecté, la zone
// de l'app ramène le Spotter au premier plan quand rien ne se perd, et le
// Spotter, affiché et libre, le prend pour l'ouvrir. Les décisions (logique
// pure, testée) et la mise en attente : shared-item.ts.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useIsFocused, useNavigationContainerRef, useRouter } from "expo-router";
import { useToast } from "./toast-context";
import { onSharedItemArrival, onSharedItemSignedOut, peekSharedItem, sharedMessageDurationMs, subscribeSharedItem, takeSharedItem, type SharedItem } from "./shared-item";

const nothingOnServer = () => null;

export function usePendingSharedItem(): SharedItem | null {
  return useSyncExternalStore(subscribeSharedItem, peekSharedItem, nothingOnServer);
}

/** Message du partage : il arrive au retour d'une autre app, on le laisse
 * affiché le temps de le lire (2,2 s pour une confirmation ordinaire). */
function useSharedMessage(): (message: string) => void {
  const { showToast } = useToast();
  return useCallback((message: string) => showToast(message, { durationMs: sharedMessageDurationMs(message) }), [showToast]);
}

/** Pas connecté : on dit une fois que l'élément s'ouvrira après la connexion ;
 * un élément refusé, lui, est dit tout de suite. */
export function useSharedItemWaitingNotice(waiting: boolean): void {
  const pending = usePendingSharedItem();
  const say = useSharedMessage();
  useEffect(() => {
    if (waiting && pending) onSharedItemSignedOut(say);
  }, [waiting, pending, say]);
}

/** Zone connectée : un partage arrive pendant qu'un autre écran est affiché.
 * Rien à perdre (onglets, pages de simple lecture) : retour au Spotter, qui
 * l'ouvrira — comme « Fermer » quand des écrans sont empilés, sinon simple
 * changement d'onglet. Recherche en cours, saisie, écran hors de la zone : on
 * reste, on dit que l'élément (même refusé) attend le Spotter, qui l'ouvrira à
 * la prochaine visite (shared-item.ts, onSharedItemArrival).
 * Les écrans ouverts sont lus au moment de l'arrivée (état de navigation). */
export function useSharedItemArrival(): void {
  const router = useRouter();
  const navigation = useNavigationContainerRef();
  const say = useSharedMessage();
  useEffect(
    () =>
      subscribeSharedItem(() =>
        onSharedItemArrival(navigation.isReady() ? navigation.getRootState() : null, {
          backToSpotter: () => {
            if (router.canDismiss()) router.dismissTo("/");
            else router.navigate("/");
          },
          say,
        })
      ),
    [router, navigation, say]
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
