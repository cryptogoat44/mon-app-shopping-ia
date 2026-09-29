import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { POLICY_UPDATE_NOTICE } from "@monapp/shared-types";
import { fetchConsentStatus, recordAnalyticsChoice } from "@/lib/api";
import { setAnalyticsPlatform, setAnalyticsUser } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { hasAnalyticsConsent, parseSeenNotices, seenNoticesKey, shouldAskAnalytics, shouldShowNotice } from "@/lib/policy-notice";
import { fr } from "@/i18n/fr";
import { NoticeBanner } from "@/components/notice-banner";

// Messages discrets de l'app connectée, un seul à la fois :
// 1. information après une mise à jour de la politique sans nouvelle
//    acceptation (une fois par compte et par appareil) ;
// 2. demande « statistiques d'usage » aux comptes qui n'ont jamais choisi
//    (une seule fois : le choix, accord ou refus, est gardé sur le serveur).
// Règle aussi la collecte de statistiques selon le consentement du compte
// (rien avant d'avoir lu ce consentement ; coupée à la déconnexion).
// Une lecture impossible (réseau) n'affiche rien et ne collecte rien.

type Notice = "policy" | "analytics";

export function AppNotices() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [queue, setQueue] = useState<Notice[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAnalyticsPlatform(Platform.OS);
    setAnalyticsUser(null, false);
    setQueue([]);
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const statuses = await fetchConsentStatus();
        if (cancelled) return;
        setAnalyticsUser(userId, hasAnalyticsConsent(statuses));
        const next: Notice[] = [];
        const seen = parseSeenNotices(await AsyncStorage.getItem(seenNoticesKey(userId)).catch(() => null));
        if (shouldShowNotice(statuses, seen, POLICY_UPDATE_NOTICE)) next.push("policy");
        if (shouldAskAnalytics(statuses)) next.push("analytics");
        if (!cancelled) setQueue(next);
      } catch {
        // Voir plus haut : rien cette fois-ci, nouvel essai au prochain lancement.
      }
    })();
    return () => {
      cancelled = true;
      // Sortie de l'app connectée (déconnexion, compte supprimé) : collecte coupée.
      setAnalyticsUser(null, false);
    };
  }, [userId]);

  const current = queue[0];
  const next = () => {
    setError(null);
    setQueue((items) => items.slice(1));
  };

  async function markPolicySeen() {
    next();
    if (!userId) return;
    try {
      const key = seenNoticesKey(userId);
      const seen = parseSeenNotices(await AsyncStorage.getItem(key));
      await AsyncStorage.setItem(key, JSON.stringify([...new Set([...seen, POLICY_UPDATE_NOTICE.id])]));
    } catch {
      // Stockage indisponible : l'information pourra réapparaître une fois.
    }
  }

  async function answerAnalytics(granted: boolean) {
    setSaving(true);
    setError(null);
    try {
      await recordAnalyticsChoice(granted);
      next();
    } catch {
      setError(fr.settings.analyticsFailed);
    } finally {
      setSaving(false);
    }
  }

  if (current === "policy") {
    return (
      <NoticeBanner
        message={fr.legal.updateNotice}
        actions={[
          {
            label: fr.legal.updateNoticeRead,
            role: "link",
            emphasis: true,
            onPress: () => {
              markPolicySeen();
              router.push("/confidentialite");
            },
          },
          { label: fr.legal.updateNoticeDismiss, accessibilityLabel: fr.legal.updateNoticeDismissLabel, role: "button", onPress: markPolicySeen },
        ]}
      />
    );
  }
  if (current === "analytics") {
    return (
      <NoticeBanner
        message={fr.legal.analyticsPrompt}
        error={error}
        actions={[
          { label: fr.legal.analyticsPromptNo, role: "button", disabled: saving, onPress: () => answerAnalytics(false) },
          { label: fr.legal.analyticsPromptYes, role: "button", emphasis: true, disabled: saving, onPress: () => answerAnalytics(true) },
        ]}
      />
    );
  }
  return null;
}
