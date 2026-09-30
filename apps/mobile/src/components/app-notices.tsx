import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { POLICY_UPDATE_NOTICE } from "@monapp/shared-types";
import { fetchConsentStatus, recordAnalyticsChoice } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { parseSeenNotices, seenNoticesKey, shouldAskAnalytics, shouldShowNotice } from "@/lib/policy-notice";
import { t } from "@/i18n";
import { NoticeBanner } from "@/components/notice-banner";

// Messages discrets de l'app connectée, un seul à la fois :
// 1. information après une mise à jour de la politique sans nouvelle
//    acceptation (une fois par compte et par appareil) ;
// 2. demande « statistiques d'usage » aux comptes qui n'ont jamais choisi
//    (une seule fois : le choix, accord ou refus, est gardé sur le serveur).
// Une lecture impossible (réseau) n'affiche rien. La collecte de statistiques
// selon le consentement est réglée par AnalyticsSession (lot 3).

type Notice = "policy" | "analytics";

export function AppNotices() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [queue, setQueue] = useState<Notice[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQueue([]);
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const statuses = await fetchConsentStatus();
        if (cancelled) return;
        const next: Notice[] = [];
        const seen = parseSeenNotices(await AsyncStorage.getItem(seenNoticesKey(userId)).catch(() => null));
        if (shouldShowNotice(statuses, seen, POLICY_UPDATE_NOTICE)) next.push("policy");
        if (shouldAskAnalytics(statuses)) next.push("analytics");
        if (!cancelled) setQueue(next);
      } catch {
        // Lecture impossible (réseau) : rien cette fois-ci, nouvel essai au prochain lancement.
      }
    })();
    return () => {
      cancelled = true;
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
      setError(t.settings.analyticsFailed);
    } finally {
      setSaving(false);
    }
  }

  if (current === "policy") {
    return (
      <NoticeBanner
        message={t.legal.updateNotice}
        actions={[
          {
            label: t.legal.updateNoticeRead,
            role: "link",
            emphasis: true,
            onPress: () => {
              markPolicySeen();
              router.push("/confidentialite");
            },
          },
          { label: t.legal.updateNoticeDismiss, accessibilityLabel: t.legal.updateNoticeDismissLabel, role: "button", onPress: markPolicySeen },
        ]}
      />
    );
  }
  if (current === "analytics") {
    return (
      <NoticeBanner
        message={t.legal.analyticsPrompt}
        error={error}
        actions={[
          { label: t.legal.analyticsPromptNo, role: "button", disabled: saving, onPress: () => answerAnalytics(false) },
          { label: t.legal.analyticsPromptYes, role: "button", emphasis: true, disabled: saving, onPress: () => answerAnalytics(true) },
        ]}
      />
    );
  }
  return null;
}
