import { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, Switch, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { WishAlertState } from "@monapp/shared-types";
import { color, font, radius, serifFont, size, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { updateWishAlert } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { loadPushDecision, pushPermission, pushSupported, savePushDecision, syncPushDevice } from "@/lib/push";
import { alertsPushStep } from "@/lib/push-state";
import { useToast } from "@/lib/toast-context";
import { useWishAlertsStatus } from "@/lib/use-wish-alerts-status";
import {
  activeKinds,
  alertKindLabel,
  bellButtonText,
  bellLabel,
  bellOn,
  choiceChanged,
  choiceOf,
  currencySymbol,
  initialTarget,
  isAlertsUnavailable,
  parseTargetPrice,
  pushNote,
  pushNoteText,
  switchTurnsOn,
  targetPriceText,
  visibleAlertKinds,
  watchErrorMessage,
  watchRequest,
  type AlertChoice,
} from "@/lib/wish-alerts";
import { BellIcon } from "@/components/icons";
import { ErrorMessage } from "@/components/error-message";
import { PushOfferPanel, usePushOfferAnswer } from "@/components/push-offer-sheet";
import { themedStyles } from "@/theme/themed-styles";

// Lot 2 — alertes prix et stock : la cloche d'une envie (liste des Envies,
// collections, fiche) et sa feuille. Règles : lib/wish-alerts.ts.
// - « Baisse de prix » et « Retour en stock » ; « Épuisé » reste caché
//   (SOLD_OUT_ALERTS_VISIBLE) ;
// - la cloche qui allume l'interrupteur général (première cloche) passe
//   d'abord, sur l'iPhone, par l'explication des notifications (seconde
//   étape de la feuille, la même que pour les messages) ; quelle que soit la
//   réponse, l'alerte est enregistrée ;
// - notifications pas encore allumées sur le serveur : on le dit ; sur le
//   site, elles n'arrivent que sur l'app iPhone ;
// - un seul enregistrement à la fois : pendant qu'il part, l'explication des
//   notifications n'accepte plus de réponse (« Plus tard » défairait l'accord
//   que la personne vient de donner) et rien ne ferme la feuille ;
// - nouvelle version (0041) : sous « Baisse de prix », « Prévenez-moi si le
//   prix passe sous [ ] € », pré-rempli avec le seuil enregistré ou le
//   dernier prix vu (le serveur les dit) ; la personne peut le baisser ; vide,
//   le premier prix vu servira de seuil. Le champ n'apparaît que si la devise
//   du membre est connue.

/** La cloche d'une envie dans une liste : un bouton rond, posé sur le coin
 * de la vignette (zone tactile de 44 points avec la marge). Pleine quand une
 * alerte est allumée. */
export function WishAlertBell({ title, state, onPress, style }: { title: string; state: WishAlertState | null; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const on = bellOn(state);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={[styles.bell, on ? styles.bellOn : null, style]}
      accessibilityRole="button"
      accessibilityLabel={bellLabel(title, state)}
      accessibilityState={{ selected: on }}
      testID="cloche-envie"
    >
      <BellIcon size={16} tint={on ? color.blanc : color.encre} strokeWidth={1.6} filled={on} />
    </Pressable>
  );
}

/** La cloche sur la fiche d'une envie : un bouton avec ce qui est suivi. */
export function WishAlertButton({ title, state, onPress, style }: { title: string; state: WishAlertState | null; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const on = bellOn(state);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.button, style]}
      accessibilityRole="button"
      accessibilityLabel={bellLabel(title, state)}
      accessibilityState={{ selected: on }}
      testID="cloche-fiche-envie"
    >
      <BellIcon size={18} tint={color.vert} strokeWidth={1.6} filled={on} />
      <Text style={styles.buttonLabel} numberOfLines={2}>
        {bellButtonText(state)}
      </Text>
    </Pressable>
  );
}

/** La feuille de la cloche. `onSaved` : la cloche enregistrée par le serveur. */
export function WishAlertSheet({
  wish,
  state,
  visible,
  onClose,
  onSaved,
}: {
  wish: { id: string; title: string } | null;
  state: WishAlertState | null;
  visible: boolean;
  onClose: () => void;
  onSaved: (state: WishAlertState) => void;
}) {
  const insets = useSafeAreaInsets();
  const status = useWishAlertsStatus();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { showToast } = useToast();
  const [choice, setChoice] = useState<AlertChoice>(() => choiceOf(state));
  const initial = useRef<AlertChoice>(choiceOf(state));
  const locale = getActiveLocale();
  const [targetText, setTargetText] = useState(() => targetPriceText(initialTarget(state), locale));
  const initialTargetText = useRef(targetPriceText(initialTarget(state), locale));
  const [step, setStep] = useState<"choose" | "push">("choose");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Un seul envoi à la fois, vu tout de suite (l'état React n'arrive qu'au rendu suivant).
  const sending = useRef(false);
  // Seconde étape : « Activer » ou « Plus tard », puis l'alerte est enregistrée.
  const offer = usePushOfferAnswer("alerts", () => void send(), step === "push");

  // Chaque ouverture repart de la cloche enregistrée, sans erreur affichée.
  useEffect(() => {
    if (!visible) return;
    const saved = choiceOf(state);
    initial.current = saved;
    setChoice(saved);
    const text = targetPriceText(initialTarget(state), locale);
    initialTargetText.current = text;
    setTargetText(text);
    setStep("choose");
    setError(null);
    setSaving(false);
    sending.current = false;
  }, [visible, wish?.id]);

  /** Sur l'iPhone : faut-il d'abord l'explication des notifications ? */
  async function pushStepNow(): Promise<"offer" | "adopt" | "none"> {
    if (!userId || Platform.OS !== "ios") return "none";
    try {
      const [supported, messages, alerts, permission] = await Promise.all([pushSupported(), loadPushDecision(userId, "messages"), loadPushDecision(userId, "alerts"), pushPermission()]);
      return alertsPushStep({ platform: Platform.OS, status, supported }, { messages, alerts }, permission);
    } catch {
      return "none";
    }
  }

  async function save() {
    if (!wish || saving) return;
    if (switchTurnsOn(choice, status) && userId) {
      setSaving(true);
      const next = await pushStepNow();
      setSaving(false);
      if (next === "offer") {
        setStep("push");
        return;
      }
      // L'appareil reçoit déjà les notifications : elles valent aussi pour les alertes.
      if (next === "adopt") await savePushDecision(userId, "on", "alerts").catch(() => {});
    }
    await send();
  }

  async function send() {
    if (!wish || sending.current) return;
    sending.current = true;
    const target = parseTargetPrice(targetText);
    if (choice.price_drop && targetFieldShown && target === "invalid") {
      sending.current = false;
      setError(t.wishAlerts.targetInvalid);
      setStep("choose");
      return;
    }
    // Seuil inchangé : rien n'est envoyé (le serveur garde le sien ou le pré-remplit) ; vidé : null.
    const changedTarget = targetFieldShown && targetText !== initialTargetText.current && target !== "invalid" ? target : undefined;
    const request = watchRequest(choice, status, undefined, changedTarget);
    setSaving(true);
    setError(null);
    try {
      const saved = await updateWishAlert(wish.id, request);
      if (saved) onSaved(saved);
      // Interrupteur allumé : l'appareil est enregistré si la personne a dit oui.
      if (request.enableAlerts && userId) syncPushDevice(userId).catch(() => {});
      // Réponse illisible : le choix envoyé fait foi pour le message.
      const on = saved ? bellOn(saved) : activeKinds(choice).length > 0;
      showToast(on ? t.wishAlerts.saved : t.wishAlerts.removed);
      onClose();
    } catch (e) {
      // Alertes devenues indisponibles : tout est caché, la feuille aussi.
      if (isAlertsUnavailable(e)) {
        onClose();
        return;
      }
      setError(watchErrorMessage(e));
      setStep("choose");
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }

  // Pendant l'enregistrement : ni fermeture, ni réponse à l'explication.
  const dismiss = () => (saving ? undefined : step === "push" ? offer.dismiss() : onClose());
  const turnsOn = switchTurnsOn(choice, status);
  const targetCurrency = state?.targetCurrency ?? state?.lastCurrency ?? null;
  const targetFieldShown = targetCurrency !== null;
  const targetChanged = choice.price_drop && targetFieldShown && targetText !== initialTargetText.current;
  const targetInvalid = choice.price_drop && targetFieldShown && parseTargetPrice(targetText) === "invalid";
  const canSave = !saving && !targetInvalid && (choiceChanged(initial.current, choice) || turnsOn || targetChanged);
  const note = pushNoteText(pushNote(status, Platform.OS));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismiss}>
      <Pressable style={styles.backdrop} onPress={dismiss} accessibilityRole="button" accessibilityLabel={t.common.close} />
      <View style={[styles.sheet, { paddingBottom: space.xl + insets.bottom }]}>
        <View style={styles.grab} />
        {step === "push" ? (
          <PushOfferPanel kind="alerts" offer={offer} saving={saving} />
        ) : (
          <>
            <Text style={styles.title} accessibilityRole="header">
              {t.wishAlerts.sheetTitle}
            </Text>
            {wish ? (
              <Text style={styles.pieceTitle} numberOfLines={2}>
                {wish.title}
              </Text>
            ) : null}
            <Text style={styles.intro}>{t.wishAlerts.sheetIntro}</Text>
            {visibleAlertKinds().map((kind) => (
              <View key={kind} style={styles.option}>
                <View style={styles.optionText}>
                  <Text style={styles.optionLabel}>{alertKindLabel(kind)}</Text>
                  <Text style={styles.optionHint}>{t.wishAlerts.kindHints[kind]}</Text>
                </View>
                <Switch
                  value={choice[kind]}
                  onValueChange={(on) => setChoice((current) => ({ ...current, [kind]: on }))}
                  disabled={saving}
                  accessibilityLabel={alertKindLabel(kind)}
                  accessibilityHint={t.wishAlerts.kindHints[kind]}
                  trackColor={{ true: color.vert, false: color.filet }}
                  testID={`alerte-${kind}`}
                />
              </View>
            ))}
            {choice.price_drop && targetFieldShown ? (
              <View style={styles.target}>
                <View style={styles.targetRow}>
                  <Text style={styles.targetLabel}>{t.wishAlerts.targetLabel}</Text>
                  <TextInput
                    style={styles.targetInput}
                    value={targetText}
                    onChangeText={(text) => {
                      setTargetText(text);
                      setError(null);
                    }}
                    keyboardType="decimal-pad"
                    inputMode="decimal"
                    maxLength={12}
                    editable={!saving}
                    accessibilityLabel={t.wishAlerts.targetFieldLabel(currencySymbol(targetCurrency))}
                    testID="seuil-baisse-prix"
                  />
                  <Text style={styles.targetLabel}>{currencySymbol(targetCurrency)}</Text>
                </View>
                <Text style={styles.optionHint}>{targetText === "" ? t.wishAlerts.targetHintNone : t.wishAlerts.targetHintLast}</Text>
                {targetInvalid ? <ErrorMessage style={styles.error}>{t.wishAlerts.targetInvalid}</ErrorMessage> : null}
              </View>
            ) : null}
            {turnsOn ? <Text style={styles.note}>{t.wishAlerts.switchTurnsOn}</Text> : null}
            {note ? <Text style={styles.note}>{note}</Text> : null}
            {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}
            <View style={styles.row}>
              <Pressable style={styles.secondary} onPress={onClose} disabled={saving} accessibilityRole="button">
                <Text style={styles.secondaryLabel}>{t.wishAlerts.cancel}</Text>
              </Pressable>
              <Pressable
                style={[styles.primary, canSave ? null : styles.primaryOff]}
                onPress={() => void save()}
                disabled={!canSave}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSave, busy: saving }}
                testID="enregistrer-alerte"
              >
                <Text style={[styles.primaryLabel, canSave ? null : styles.primaryLabelOff]}>{saving ? t.wishAlerts.saving : t.wishAlerts.save}</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  bell: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    backgroundColor: color.porcelaine,
    borderWidth: 1,
    borderColor: color.filet,
    alignItems: "center",
    justifyContent: "center",
  },
  bellOn: { backgroundColor: color.vert, borderColor: color.vert },
  button: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
  },
  buttonLabel: { flexShrink: 1, color: color.vert, fontSize: font.secondary, fontWeight: "600", textAlign: "center" },
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: {
    backgroundColor: color.porcelaine,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    gap: space.sm,
    width: "100%",
    maxWidth: size.contentMaxWidth,
    alignSelf: "center",
  },
  grab: { width: size.sheetHandle.width, height: size.sheetHandle.height, borderRadius: radius.full, backgroundColor: color.filet, alignSelf: "center", marginBottom: space.xs },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre },
  pieceTitle: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  intro: { fontSize: font.secondary, color: color.acier, lineHeight: 20 },
  option: { minHeight: size.touchTarget, flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.xs },
  optionText: { flex: 1 },
  optionLabel: { fontSize: font.body, color: color.encre },
  optionHint: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
  note: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
  target: { gap: space.xs, paddingBottom: space.xs },
  targetRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm },
  targetLabel: { fontSize: font.secondary, color: color.encre },
  targetInput: {
    minHeight: size.touchTarget,
    minWidth: 96,
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
    fontSize: font.body,
    color: color.encre,
    textAlign: "right",
  },
  error: { fontSize: font.caption },
  row: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space.sm, marginTop: space.sm },
  secondary: { minHeight: size.touchTarget, minWidth: size.touchTarget, paddingHorizontal: space.md, alignItems: "center", justifyContent: "center" },
  secondaryLabel: { fontSize: font.secondary, fontWeight: "600", color: color.acier },
  primary: { minHeight: size.touchTarget, minWidth: size.touchTarget, paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: color.vert, alignItems: "center", justifyContent: "center" },
  primaryOff: { backgroundColor: color.inactif },
  primaryLabel: { fontSize: font.secondary, fontWeight: "600", color: color.blanc },
  primaryLabelOff: { color: color.surInactif },
}));
