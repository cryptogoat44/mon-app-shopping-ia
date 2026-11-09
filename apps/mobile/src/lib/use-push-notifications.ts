import { useEffect } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "./auth-context";
import { listenToNotifications, refreshPushToken } from "./push";
import { conversationHref } from "./push-state";
import { useMessagesStatus } from "./use-messages-status";

/** Lot notifications (app iPhone, une fois connecté) : une notification
 * touchée ouvre sa conversation, même quand elle a lancé l'app ; et le jeton
 * de l'appareil est rafraîchi à l'ouverture si la personne a déjà accepté.
 * Ne demande JAMAIS l'autorisation d'iOS : seul « Activer » la demande
 * (components/push-offer-sheet.tsx). */
export function usePushNotifications(): void {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { enabled, push } = useMessagesStatus();

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let stop: () => void = () => {};
    let cancelled = false;
    listenToNotifications((id) => router.push(conversationHref(id)))
      .then((unsubscribe) => {
        if (cancelled) unsubscribe();
        else stop = unsubscribe;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stop();
    };
  }, [router]);

  useEffect(() => {
    if (Platform.OS !== "ios" || !userId || !enabled || push !== true) return;
    refreshPushToken(userId).catch(() => {});
  }, [userId, enabled, push]);
}
