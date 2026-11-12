import { useEffect } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "./auth-context";
import { fetchWishAlertsStatus } from "./api";
import { listenToNotifications, refreshPushToken } from "./push";
import { notificationHref } from "./push-state";
import { useMessagesStatus } from "./use-messages-status";
import { useWishAlertsStatus } from "./use-wish-alerts-status";

/** Lot notifications (app iPhone, une fois connecté) : une notification
 * touchée ouvre sa conversation, même quand elle a lancé l'app ; et le jeton
 * de l'appareil est rafraîchi à l'ouverture si la personne a déjà accepté.
 * Lot alertes prix : une alerte touchée ouvre la fiche de l'envie (ou vos
 * Envies pour une alerte groupée) ; le jeton est aussi rafraîchi pour les
 * alertes (interrupteur des Réglages allumé, notifications acceptées).
 * Ne demande JAMAIS l'autorisation d'iOS : seul « Activer » la demande
 * (components/push-offer-sheet.tsx). */
export function usePushNotifications(): void {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { enabled, push } = useMessagesStatus();
  const alerts = useWishAlertsStatus();

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let stop: () => void = () => {};
    let cancelled = false;
    listenToNotifications((target) => router.push(notificationHref(target)))
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

  // Les alertes (disponibles ? interrupteur ?) : lues une fois par compte, pour le jeton.
  useEffect(() => {
    if (userId) fetchWishAlertsStatus().catch(() => {});
  }, [userId]);

  const messagesPush = enabled && push === true;
  const alertsPush = alerts.available && alerts.enabled && alerts.push;
  useEffect(() => {
    if (Platform.OS !== "ios" || !userId || (!messagesPush && !alertsPush)) return;
    refreshPushToken(userId).catch(() => {});
  }, [userId, messagesPush, alertsPush]);
}
