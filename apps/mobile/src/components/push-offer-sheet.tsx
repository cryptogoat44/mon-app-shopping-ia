import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { disablePush, enablePush, loadActivityDecisions, loadPushDecision, pushPermission, pushSupported } from "@/lib/push";
import { shouldOfferActivityPush, shouldOfferPush } from "@/lib/push-state";
import { useMessagesStatus } from "@/lib/use-messages-status";
import { useToast } from "@/lib/toast-context";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

// Lot notifications : la feuille qui explique, AVANT la fenêtre d'iOS, à quoi
// servent les notifications et ce qu'elles montrent (qui écrit, jamais le
// contenu). Seul « Activer les notifications » fait demander l'autorisation à
// iOS ; « Plus tard » ne demande rien et la feuille ne revient pas (les
// Réglages gardent l'interrupteur). Jamais au lancement de l'app.
// Lot alertes prix : la même explication pour les alertes (`kind`
// « alerts ») — dans cette feuille (Réglages), ou comme seconde étape de la
// feuille de la cloche (PushOfferPanel, components/wish-alert-sheet.tsx).
// Lot « découverte » : celle de l'activité (`kind` « activity ») : « Activer »
// allume les quatre sortes d'un coup, « Plus tard » est gardé pour les quatre.

/** Ce qu'une feuille propose : les messages, les alertes, ou l'activité (ses quatre sortes ensemble). */
export type PushOfferKind = "messages" | "alerts" | "activity";

export function PushOfferSheet({ visible, onClose, kind = "messages" }: { visible: boolean; onClose: (enabled: boolean) => void; kind?: PushOfferKind }) {
  const offer = usePushOfferAnswer(kind, onClose, visible);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={offer.dismiss}>
      <Pressable style={styles.backdrop} onPress={offer.dismiss} accessibilityRole="button" accessibilityLabel={t.push.offerClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <PushOfferPanel kind={kind} offer={offer} />
      </View>
    </Modal>
  );
}

type PushOfferAnswer = ReturnType<typeof usePushOfferAnswer>;

/** « Activer » et « Plus tard » de la feuille d'explication. `onClose(true)` :
 * notifications activées sur cet appareil. `dismiss` : fermer sans répondre
 * vaut « Plus tard » (sauf si iOS les a déjà refusées : rien de plus à dire). */
export function usePushOfferAnswer(kind: PushOfferKind, onClose: (enabled: boolean) => void, visible = true) {
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
      const permission = await enablePush(userId, kind);
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
    if (userId) disablePush(userId, kind).catch(() => {});
    onClose(false);
  }

  const denied = outcome === "denied" || outcome === "open_failed";
  const dismiss = () => (denied ? onClose(false) : later());
  return { busy, outcome, denied, accept, later, dismiss, close: () => onClose(false), openFailed: () => setOutcome("open_failed") };
}

/** Les textes d'une feuille. L'activité dit elle-même qu'on choisira dans
 * les Réglages : pas de phrase de plus. */
function offerTexts(kind: PushOfferKind): { title: string; body: string; hint: string | null; accept: string; later: string } {
  if (kind === "activity") return { title: t.activityPush.offerTitle, body: t.activityPush.offerBody, hint: null, accept: t.activityPush.enable, later: t.activityPush.later };
  const title = kind === "alerts" ? t.wishAlerts.pushOfferTitle : t.push.offerTitle;
  const body = kind === "alerts" ? t.wishAlerts.pushOfferBody : t.push.offerBody;
  return { title, body, hint: t.push.offerSettingsHint, accept: t.push.offerAccept, later: t.push.offerLater };
}

/** Le contenu de la feuille : à quoi servent les notifications, ce qu'elles
 * montrent, « Activer » et « Plus tard ». `saving` : la réponse donnée est en
 * train d'être enregistrée ailleurs (cloche) — plus aucune autre réponse. */
export function PushOfferPanel({ kind, offer, saving = false }: { kind: PushOfferKind; offer: PushOfferAnswer; saving?: boolean }) {
  const { outcome, denied, accept, later } = offer;
  const busy = offer.busy || saving;
  const texts = offerTexts(kind);
  return (
    <>
      <Text style={styles.title} accessibilityRole="header">
        {texts.title}
      </Text>
      <Text style={styles.body}>{texts.body}</Text>
      {texts.hint ? <Text style={styles.hint}>{texts.hint}</Text> : null}
      {denied ? <Text style={styles.body}>{kind === "activity" ? t.activityPush.denied : t.push.deniedHint}</Text> : null}
      {outcome === "failed" ? <ErrorMessage style={styles.hint}>{t.push.failed}</ErrorMessage> : null}
      {outcome === "open_failed" ? <ErrorMessage style={styles.hint}>{t.push.openSettingsFailed}</ErrorMessage> : null}
      <View style={styles.buttons}>
        {denied ? (
          <>
            <Pressable style={styles.button} onPress={offer.close} accessibilityRole="button">
              <Text style={styles.buttonLabel}>{t.push.offerClose}</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.primary]} onPress={() => void Linking.openSettings().catch(offer.openFailed)} accessibilityRole="link">
              <Text style={[styles.buttonLabel, styles.primaryLabel]}>{t.push.openSettings}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable style={styles.button} onPress={later} disabled={busy} accessibilityRole="button" testID="notifications-plus-tard">
              <Text style={styles.buttonLabel}>{texts.later}</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.primary]}
              onPress={() => void accept()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ busy }}
              testID="notifications-activer"
            >
              <Text style={[styles.buttonLabel, styles.primaryLabel]}>{busy ? t.push.enabling : texts.accept}</Text>
            </Pressable>
          </>
        )}
      </View>
    </>
  );
}

/** Propose la feuille une seule fois, au bon moment : après un message
 * envoyé ou reçu (écran d'une conversation), seulement sur l'iPhone, quand le
 * serveur a allumé les notifications et que la personne n'a encore rien
 * répondu. `offer()` ne fait rien dans les autres cas.
 * Lot « découverte » : `kind` « activity », la première fois que l'onglet
 * Activité montre une activité, quand le serveur propose l'activité et que la
 * personne n'a encore rien répondu pour aucune de ses quatre sortes. */
export function usePushOffer(kind: "messages" | "activity" = "messages"): { offer: () => void; sheet: ReactNode } {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const status = useMessagesStatus();
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const [visible, setVisible] = useState(false);
  const offered = useRef(false);

  // Stable (ne dépend que du compte et de la sorte) : l'écran peut l'appeler depuis ses relectures.
  const offer = useCallback(() => {
    const current = statusRef.current;
    if (offered.current || !userId || Platform.OS !== "ios") return;
    if (kind === "activity") {
      if (current.activityPush !== true) return;
      offered.current = true;
      Promise.all([pushSupported(), loadActivityDecisions(userId), pushPermission()])
        .then(([supported, decisions, permission]) => {
          if (shouldOfferActivityPush({ platform: Platform.OS, status: statusRef.current, supported }, decisions, permission)) setVisible(true);
        })
        .catch(() => {});
      return;
    }
    if (!current.enabled || current.push !== true) return;
    offered.current = true;
    Promise.all([pushSupported(), loadPushDecision(userId), pushPermission()])
      .then(([supported, decision, permission]) => {
        if (shouldOfferPush({ platform: Platform.OS, status: statusRef.current, supported }, decision, permission)) setVisible(true);
      })
      .catch(() => {});
  }, [userId, kind]);

  return { offer, sheet: <PushOfferSheet kind={kind} visible={visible} onClose={() => setVisible(false)} /> };
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
