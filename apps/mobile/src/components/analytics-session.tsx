import { useEffect } from "react";
import { Platform } from "react-native";
import { fetchConsentStatus } from "@/lib/api";
import { setAnalyticsPlatform, setAnalyticsUser } from "@/lib/analytics";
import { setErrorTrackingUser } from "@/lib/error-tracking";
import { useAuth } from "@/lib/auth-context";
import { hasAnalyticsConsent } from "@/lib/policy-notice";

// Compte suivi par les statistiques d'usage et par Sentry : selon le
// consentement du compte (rien avant de l'avoir lu ; coupé à la
// déconnexion). Placé HORS des écrans que le changement de langue ou de
// thème remonte (lot 3) : sinon la collecte autorisée se coupait un instant
// à chaque changement, et l'événement suivant était perdu.
export function AnalyticsSession() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    setAnalyticsPlatform(Platform.OS);
    setAnalyticsUser(null, false);
    setErrorTrackingUser(userId);
    if (!userId) return;
    let cancelled = false;
    fetchConsentStatus()
      .then((statuses) => {
        if (!cancelled) setAnalyticsUser(userId, hasAnalyticsConsent(statuses));
      })
      .catch(() => {
        // Lecture impossible (réseau) : rien n'est collecté ; nouvel essai au prochain lancement.
      });
    return () => {
      cancelled = true;
      setAnalyticsUser(null, false);
      setErrorTrackingUser(null);
    };
  }, [userId]);

  return null;
}
