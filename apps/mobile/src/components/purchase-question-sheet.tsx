import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { VaultCategory } from "@monapp/shared-types";
import { color, font, radius, serifFont, serifLineHeight, size, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { track } from "@/lib/analytics";
import { afterSheetClose } from "@/lib/after-sheet-close";
import { vaultItemRoute, type NoStep, type YesOutcome } from "@/lib/purchase-question";
import type { PendingQuestion } from "@/lib/use-purchase-question";
import { useReduceMotion } from "@/lib/use-hero-reveal";
import { VAULT_CATEGORIES } from "@/lib/vault-labels";
import { ErrorMessage } from "@/components/error-message";
import { SpotImage } from "@/components/spot-image";
import { themedStyles } from "@/theme/themed-styles";

// Parcours 3 : « Vous l'avez achetée ? » au retour de la boutique
// (lib/purchase-question.ts, décision B1 du fondateur). Même style que
// « Dans quelle catégorie ? ». Une seule feuille, dont le contenu change
// d'étape : deux fenêtres modales l'une sur l'autre s'affichent mal sur
// iPhone. « Oui » → la catégorie, la pièce au Vault, puis « La partager dans
// votre fil ? » (« Partager… » ouvre seulement la fiche de la pièce : rien
// n'est publié sans « Partager dans mon fil »). « Non » → garder la pièce et
// suivre son prix, ou suivre son prix, ou rien (la feuille se ferme). Le
// fond, « Fermer » ou le geste de retour valent « Plus tard ».

/** Ce que l'écran fait pour la pièce visée (écran Résultat ou fiche d'une Envie). */
export interface PurchaseQuestionActions {
  /** « Oui » puis la catégorie : la pièce au Vault. */
  addToVault(category: VaultCategory): Promise<YesOutcome>;
  /** Ce que « Non, pas encore » propose (lib/purchase-question.ts, noStepFor). */
  noStep(): NoStep;
  /** « Garder » : l'alerte allumée (true) ou non (false) ; null : l'Envie n'a pas pu être créée. */
  keep(): Promise<boolean | null>;
  /** « Activer l'alerte » : true si elle est allumée. */
  turnOnAlert(): Promise<boolean>;
  /** « Couper l'alerte » : true si elle est coupée. */
  turnOffAlert(): Promise<boolean>;
}

type DoneMessage = "kept" | "keptWithAlert" | "alertOn" | "alertOff";

type Step =
  | { kind: "ask" }
  | { kind: "category" }
  | { kind: "adding" }
  | { kind: "addFailed"; category: VaultCategory }
  | { kind: "added"; vaultItemId: string; alreadyInVault: boolean }
  | { kind: "offerKeep"; withAlert: boolean; busy: boolean; failed: boolean }
  | { kind: "offerFollow"; busy: boolean; failed: boolean }
  | { kind: "done"; message: DoneMessage; busy: boolean; failed: boolean };

function doneText(message: DoneMessage): string {
  if (message === "keptWithAlert") return t.firstTry.keptWithAlert;
  if (message === "kept") return t.firstTry.kept;
  if (message === "alertOn") return t.wishAlerts.saved;
  return t.firstTry.alertTurnedOff;
}

function isBusy(step: Step): boolean {
  return step.kind === "adding" || ((step.kind === "offerKeep" || step.kind === "offerFollow" || step.kind === "done") && step.busy);
}

export function PurchaseQuestionSheet({ question, actions, onClose }: { question: PendingQuestion | null; actions: PurchaseQuestionActions | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const [step, setStep] = useState<Step>({ kind: "ask" });
  // La dernière question, gardée pendant que la feuille se referme.
  const [shown, setShown] = useState<PendingQuestion | null>(question);
  // Une nouvelle question repart de la première étape dès son premier
  // affichage (jamais l'étape de la précédente, même un instant).
  if (question && question !== shown) {
    setShown(question);
    setStep({ kind: "ask" });
  }
  // Une seule réponse comptée par question ; `run` : la question en cours
  // (une réponse du serveur arrivée pour une autre est ignorée).
  const answered = useRef(false);
  const run = useRef(0);
  // « Partager… » : la fiche de la pièce s'ouvre une fois la feuille fermée (lib/after-sheet-close.ts).
  const afterClose = useMemo(() => afterSheetClose(Platform.OS === "web"), []);
  useEffect(() => () => afterClose.cancel(), [afterClose]);

  useEffect(() => {
    if (!question) return;
    run.current += 1;
    answered.current = false;
    // La question est annoncée par VoiceOver (iPhone), après ce qu'il lit déjà.
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibilityWithOptions(t.result.purchaseQuestion.announcement(question.target.title), { queue: true });
  }, [question]);

  const target = shown?.target ?? null;
  const busy = isBusy(step);

  function answer(action: "yes" | "no" | "later") {
    if (answered.current || !question) return;
    answered.current = true;
    track("purchase_question", { action, context: question.context });
  }

  /** Le fond, « Fermer », le geste de retour : « Plus tard » à la première étape. */
  function dismiss() {
    if (busy) return;
    if (step.kind === "ask") answer("later");
    onClose();
  }

  function sayYes() {
    answer("yes");
    setStep({ kind: "category" });
  }

  function sayNo() {
    answer("no");
    const next = actions?.noStep() ?? "close";
    if (next === "close") onClose();
    else if (next === "follow") setStep({ kind: "offerFollow", busy: false, failed: false });
    else setStep({ kind: "offerKeep", withAlert: next === "keep_follow", busy: false, failed: false });
  }

  async function addToVault(category: VaultCategory) {
    if (!actions) return;
    const current = run.current;
    setStep({ kind: "adding" });
    const outcome = await actions.addToVault(category);
    if (current !== run.current) return;
    setStep(outcome.kind === "added" ? { kind: "added", vaultItemId: outcome.vaultItemId, alreadyInVault: outcome.alreadyInVault } : { kind: "addFailed", category });
  }

  function share(vaultItemId: string) {
    afterClose.schedule(() => router.push(vaultItemRoute(vaultItemId)));
    onClose();
  }

  async function keep(withAlert: boolean) {
    if (!actions) return;
    const current = run.current;
    setStep({ kind: "offerKeep", withAlert, busy: true, failed: false });
    const alert = await actions.keep();
    if (current !== run.current) return;
    setStep(alert === null ? { kind: "offerKeep", withAlert, busy: false, failed: true } : { kind: "done", message: alert ? "keptWithAlert" : "kept", busy: false, failed: false });
  }

  async function follow() {
    if (!actions) return;
    const current = run.current;
    setStep({ kind: "offerFollow", busy: true, failed: false });
    const on = await actions.turnOnAlert();
    if (current !== run.current) return;
    setStep(on ? { kind: "done", message: "alertOn", busy: false, failed: false } : { kind: "offerFollow", busy: false, failed: true });
  }

  async function turnOff(message: DoneMessage) {
    if (!actions) return;
    const current = run.current;
    setStep({ kind: "done", message, busy: true, failed: false });
    const off = await actions.turnOffAlert();
    if (current !== run.current) return;
    // En échec, le message d'erreur s'affiche et la ligne reste.
    setStep(off ? { kind: "done", message: "alertOff", busy: false, failed: false } : { kind: "done", message, busy: false, failed: true });
  }

  return (
    <Modal visible={question !== null} transparent animationType={reduceMotion ? "none" : "slide"} onRequestClose={dismiss} onDismiss={() => afterClose.flush()}>
      <Pressable style={styles.backdrop} onPress={dismiss} accessibilityRole="button" accessibilityLabel={t.common.close} />
      <View style={[styles.sheet, { paddingBottom: space.xl + insets.bottom }]} accessibilityViewIsModal testID="vous-l-avez-achetee">
        <View style={styles.grab} />
        {target ? (
          <View style={styles.piece}>
            <View style={styles.thumb}>
              <SpotImage hdUri={target.imageHdUrl} fallbackUri={target.imageUrl} style={styles.fill} fit="cover" size="small" />
            </View>
            <Text style={styles.pieceName} numberOfLines={2}>
              {target.title}
            </Text>
          </View>
        ) : null}

        {step.kind === "ask" ? (
          <>
            <Text style={styles.title} accessibilityRole="header">
              {t.result.purchaseQuestion.title}
            </Text>
            <Pressable style={styles.primary} onPress={sayYes} accessibilityRole="button">
              <Text style={styles.primaryLabel}>{t.result.purchaseQuestion.yes}</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={sayNo} accessibilityRole="button">
              <Text style={styles.secondaryLabel}>{t.result.purchaseQuestion.no}</Text>
            </Pressable>
            <Pressable style={styles.textButton} onPress={dismiss} accessibilityRole="button">
              <Text style={styles.textButtonLabel}>{t.result.purchaseQuestion.later}</Text>
            </Pressable>
          </>
        ) : null}

        {step.kind === "category" ? (
          <>
            <Text style={styles.title} accessibilityRole="header">
              {t.result.categoryTitle}
            </Text>
            {VAULT_CATEGORIES.map((category) => (
              <Pressable key={category} style={styles.row} onPress={() => void addToVault(category)} accessibilityRole="button">
                <Text style={styles.rowLabel}>{t.vaultLabels.categories[category]}</Text>
              </Pressable>
            ))}
          </>
        ) : null}

        {step.kind === "adding" ? (
          <Text style={styles.status} accessibilityLiveRegion="polite">
            {t.vaultForm.submitting}
          </Text>
        ) : null}

        {step.kind === "addFailed" ? (
          <>
            <ErrorMessage style={styles.error}>{t.result.boughtError}</ErrorMessage>
            <Pressable style={styles.primary} onPress={() => void addToVault(step.category)} accessibilityRole="button">
              <Text style={styles.primaryLabel}>{t.common.retry}</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={onClose} accessibilityRole="button">
              <Text style={styles.secondaryLabel}>{t.common.close}</Text>
            </Pressable>
          </>
        ) : null}

        {step.kind === "added" ? (
          <>
            <Text style={styles.status} accessibilityLiveRegion="polite">
              {step.alreadyInVault ? t.retrouverPieces.alreadyInVault : t.result.boughtToast}
            </Text>
            <Text style={styles.title} accessibilityRole="header">
              {t.result.purchaseQuestion.shareTitle}
            </Text>
            <Pressable style={styles.primary} onPress={() => share(step.vaultItemId)} accessibilityRole="button">
              <Text style={styles.primaryLabel}>{t.result.purchaseQuestion.share}</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={onClose} accessibilityRole="button">
              <Text style={styles.secondaryLabel}>{t.result.purchaseQuestion.later}</Text>
            </Pressable>
          </>
        ) : null}

        {step.kind === "offerKeep" ? (
          <>
            <Text style={styles.title} accessibilityRole="header">
              {step.withAlert ? t.result.purchaseQuestion.keepAndFollow : t.result.purchaseQuestion.keepOnly}
            </Text>
            {step.failed ? <ErrorMessage style={styles.error}>{t.result.keepError}</ErrorMessage> : null}
            <Pressable
              style={styles.primary}
              onPress={() => void keep(step.withAlert)}
              disabled={step.busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: step.busy, busy: step.busy }}
            >
              <Text style={styles.primaryLabel}>{t.result.keep}</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={onClose} disabled={step.busy} accessibilityRole="button">
              <Text style={styles.secondaryLabel}>{t.result.purchaseQuestion.noThanks}</Text>
            </Pressable>
          </>
        ) : null}

        {step.kind === "offerFollow" ? (
          <>
            <Text style={styles.title} accessibilityRole="header">
              {t.result.purchaseQuestion.follow}
            </Text>
            {step.failed ? <ErrorMessage style={styles.error}>{t.wishAlerts.saveError}</ErrorMessage> : null}
            <Pressable
              style={styles.primary}
              onPress={() => void follow()}
              disabled={step.busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: step.busy, busy: step.busy }}
            >
              <Text style={styles.primaryLabel}>{t.result.purchaseQuestion.turnOnAlert}</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={onClose} disabled={step.busy} accessibilityRole="button">
              <Text style={styles.secondaryLabel}>{t.result.purchaseQuestion.noThanks}</Text>
            </Pressable>
          </>
        ) : null}

        {step.kind === "done" ? (
          <>
            <DoneLine text={doneText(step.message)} />
            {step.failed ? <ErrorMessage style={styles.error}>{t.wishAlerts.saveError}</ErrorMessage> : null}
            {step.message === "keptWithAlert" || step.message === "alertOn" ? (
              <Pressable
                style={styles.secondary}
                onPress={() => void turnOff(step.message)}
                disabled={step.busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: step.busy, busy: step.busy }}
              >
                <Text style={styles.secondaryLabel}>{t.firstTry.turnOffAlert}</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.primary} onPress={onClose} disabled={step.busy} accessibilityRole="button">
              <Text style={styles.primaryLabel}>{t.common.close}</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

/** Le message après « Garder », « Activer l'alerte » ou « Couper l'alerte » :
 * annoncé sur iPhone (VoiceOver ignore les zones annoncées). */
function DoneLine({ text }: { text: string }) {
  useEffect(() => {
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
  return (
    <Text style={styles.done} accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: {
    backgroundColor: color.porcelaine,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: 10,
    width: "100%",
    maxWidth: size.contentMaxWidth,
    alignSelf: "center",
  },
  grab: { width: size.sheetHandle.width, height: size.sheetHandle.height, borderRadius: radius.full, backgroundColor: color.filet, alignSelf: "center", marginBottom: space.md },
  piece: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.md },
  thumb: { width: 56, aspectRatio: 4 / 5, backgroundColor: color.plinthe, borderRadius: radius.sm, overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
  pieceName: { flex: 1, fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, lineHeight: serifLineHeight.title, color: color.encre, marginBottom: space.sm },
  status: { fontSize: font.secondary, color: color.acier, marginBottom: space.sm },
  done: { fontSize: font.secondary, color: color.encre, lineHeight: 21, marginBottom: space.sm },
  error: { fontSize: font.caption, marginBottom: space.sm },
  row: { minHeight: 48, justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.filet },
  rowLabel: { fontSize: font.body, color: color.encre },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md, marginTop: space.sm },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600", textAlign: "center" },
  secondary: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md, marginTop: space.sm },
  secondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "500", textAlign: "center" },
  textButton: { minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: space.xs },
  textButtonLabel: { fontSize: font.secondary, color: color.acier, fontWeight: "600" },
}));
