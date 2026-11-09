import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { disablePush, enablePush, loadPushDecision, pushPermission, pushSupported } from "@/lib/push";
import { shouldOfferPush } from "@/lib/push-state";
import { useMessagesStatus } from "@/lib/use-messages-status";
import { useToast } from "@/lib/toast-context";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

// Lot notifications : la feuille qui explique, AVANT la fenêtre d'iOS, à quoi
// servent les notifications et ce qu'elles montrent (qui écrit, jamais le
// contenu). Seul « Activer les notifications » fait demander l'autorisation à
// iOS ; « Plus tard » ne demande rien et la feuille ne revient pas (les
// Réglages gardent l'interrupteur). Jamais au lancement de l'app.
export function PushOfferSheet({ visible, onClose }: { visible: boolean; onClose: (enabled: boolean) => void }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<"denied" | "failed" | "open_failed" | null>(null);

  useEffect(() => {
    if (visible) setOutcome(null);
  }, [visible]);

  async function accept() {
    if (!userId || busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      const permission = await enablePush(userId);
      if (permission === "granted") {
        showToast(t.push.enabled);
        onClose(true);
      } else {
        setOutcome("denied");
      }
    } catch {
      setOutcome("failed");
    } finally {
      setBusy(false);
    }
  }

  function later() {
    if (userId) disablePush(userId).catch(() => {});
    onClose(false);
  }

  const denied = outcome === "denied" || outcome === "open_failed";
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => (denied ? onClose(false) : later())}>
      <Pressable style={styles.backdrop} onPress={() => (denied ? onClose(false) : later())} accessibilityRole="button" accessibilityLabel={t.push.offerClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title} accessibilityRole="header">
          {t.push.offerTitle}
        </Text>
        <Text style={styles.body}>{t.push.offerBody}</Text>
        <Text style={styles.hint}>{t.push.offerSettingsHint}</Text>
        {denied ? <Text style={styles.body}>{t.push.deniedHint}</Text> : null}
        {outcome === "failed" ? <ErrorMessage style={styles.hint}>{t.push.failed}</ErrorMessage> : null}
        {outcome === "open_failed" ? <ErrorMessage style={styles.hint}>{t.push.openSettingsFailed}</ErrorMessage> : null}
        <View style={styles.buttons}>
          {denied ? (
            <>
              <Pressable style={styles.button} onPress={() => onClose(false)} accessibilityRole="button">
                <Text style={styles.buttonLabel}>{t.push.offerClose}</Text>
              </Pressable>
              <Pressable
                style={[styles.button, styles.primary]}
                onPress={() => void Linking.openSettings().catch(() => setOutcome("open_failed"))}
                accessibilityRole="link"
              >
                <Text style={[styles.buttonLabel, styles.primaryLabel]}>{t.push.openSettings}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable style={styles.button} onPress={later} disabled={busy} accessibilityRole="button" testID="notifications-plus-tard">
                <Text style={styles.buttonLabel}>{t.push.offerLater}</Text>
              </Pressable>
              <Pressable
                style={[styles.button, styles.primary]}
                onPress={() => void accept()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityState={{ busy }}
                testID="notifications-activer"
              >
                <Text style={[styles.buttonLabel, styles.primaryLabel]}>{busy ? t.push.enabling : t.push.offerAccept}</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

/** Propose la feuille une seule fois, au bon moment : après un message
 * envoyé ou reçu (écran d'une conversation), seulement sur l'iPhone, quand le
 * serveur a allumé les notifications et que la personne n'a encore rien
 * répondu. `offer()` ne fait rien dans les autres cas. */
export function usePushOffer(): { offer: () => void; sheet: ReactNode } {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const status = useMessagesStatus();
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const [visible, setVisible] = useState(false);
  const offered = useRef(false);

  // Stable (ne dépend que du compte) : l'écran peut l'appeler depuis ses relectures.
  const offer = useCallback(() => {
    const current = statusRef.current;
    if (offered.current || !userId || Platform.OS !== "ios" || !current.enabled || current.push !== true) return;
    offered.current = true;
    Promise.all([pushSupported(), loadPushDecision(userId), pushPermission()])
      .then(([supported, decision, permission]) => {
        if (shouldOfferPush({ platform: Platform.OS, status: statusRef.current, supported }, decision, permission)) setVisible(true);
      })
      .catch(() => {});
  }, [userId]);

  return { offer, sheet: <PushOfferSheet visible={visible} onClose={() => setVisible(false)} /> };
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: { backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.sm },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.xs },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre },
  body: { fontSize: font.secondary, color: color.encre, lineHeight: 20 },
  hint: { fontSize: font.secondary, color: color.acier, lineHeight: 19 },
  buttons: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  button: { flex: 1, minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center", paddingHorizontal: space.sm },
  primary: { backgroundColor: color.vert, borderColor: color.vert },
  buttonLabel: { fontSize: font.secondary, fontWeight: "600", color: color.encre, textAlign: "center" },
  primaryLabel: { color: color.blanc },
}));
