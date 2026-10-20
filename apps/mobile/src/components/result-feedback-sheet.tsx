import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MatchFeedbackReason } from "@monapp/shared-types";
import { color, font, radius, serifFont, size, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { reportInconsistentResult, withdrawInconsistentReport } from "@/lib/api";
import { feedbackErrorMessage, feedbackReasonChoices, feedbackReasonLabel } from "@/lib/result-feedback";
import { useToast } from "@/lib/toast-context";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

type Busy = "idle" | "sending" | "withdrawing";

/** Bouton discret « … », au bout des actions d'une proposition. */
export function ResultFeedbackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={styles.more} onPress={onPress} accessibilityRole="button" accessibilityLabel={t.result.reportMenuLabel}>
      <Text style={styles.moreLabel}>…</Text>
    </Pressable>
  );
}

/** « Signalé : motif », qui rouvre la feuille pour changer ou retirer. */
export function ReportedLine({ reason, onPress }: { reason: MatchFeedbackReason; onPress: () => void }) {
  return (
    <Pressable style={styles.reported} onPress={onPress} accessibilityRole="button" accessibilityHint={t.result.reportedHint}>
      <Text style={styles.reportedLabel}>{t.result.reportedLine(feedbackReasonLabel(reason))}</Text>
    </Pressable>
  );
}

/** Bouton « Résultat incohérent » (fiabilité des résultats, 2026-10-15) : un
 * motif parmi cinq. Seuls l'identifiant de la proposition et le motif partent
 * (ni texte libre, ni image) ; le motif peut être changé ou retiré. */
export function ResultFeedbackSheet({
  visible,
  matchId,
  current,
  onClose,
  onChanged,
}: {
  visible: boolean;
  matchId: string;
  current: MatchFeedbackReason | null;
  onClose: () => void;
  onChanged: (reason: MatchFeedbackReason | null) => void;
}) {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const [selected, setSelected] = useState<MatchFeedbackReason | null>(current);
  const [busy, setBusy] = useState<Busy>("idle");
  const [error, setError] = useState<string | null>(null);

  // Chaque ouverture repart du motif déjà choisi, sans erreur affichée.
  useEffect(() => {
    if (!visible) return;
    setSelected(current);
    setError(null);
    setBusy("idle");
  }, [visible, current]);

  const idle = busy === "idle";
  const canSend = idle && selected !== null && selected !== current;

  async function act(kind: Exclude<Busy, "idle">, call: () => Promise<void>, next: MatchFeedbackReason | null, done: string, fallback: string) {
    setBusy(kind);
    setError(null);
    try {
      await call();
      onChanged(next);
      onClose();
      showToast(done);
    } catch (e) {
      setError(feedbackErrorMessage(e, fallback));
      setBusy("idle");
    }
  }

  const send = () => {
    if (selected && canSend) void act("sending", () => reportInconsistentResult(matchId, selected), selected, t.result.reportThanks, t.result.reportError);
  };
  const withdraw = () => {
    if (idle) void act("withdrawing", () => withdrawInconsistentReport(matchId), null, t.result.reportWithdrawn, t.result.reportWithdrawError);
  };
  const sendLabel = busy === "sending" ? t.result.reportSending : t.result.reportSend;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.common.close} />
      <View style={[styles.sheet, { paddingBottom: space.xl + insets.bottom }]}>
        <View style={styles.grab} />
        <Text style={styles.title} accessibilityRole="header">
          {t.result.reportTitle}
        </Text>
        <Text style={styles.question}>{t.result.reportQuestion}</Text>
        <View accessibilityRole="radiogroup">
          {feedbackReasonChoices().map(({ reason, label }) => {
            const checked = selected === reason;
            return (
              <Pressable
                key={reason}
                style={styles.option}
                onPress={() => setSelected(reason)}
                disabled={!idle}
                accessibilityRole="radio"
                accessibilityLabel={label}
                accessibilityState={{ checked, disabled: !idle }}
              >
                <View style={[styles.radio, checked ? styles.radioChecked : null]}>{checked ? <View style={styles.radioDot} /> : null}</View>
                <Text style={styles.optionLabel}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}
        <View style={styles.row}>
          <Pressable style={styles.secondary} onPress={onClose} disabled={!idle} accessibilityRole="button" accessibilityLabel={t.result.reportCancel}>
            <Text style={styles.secondaryLabel}>{t.result.reportCancel}</Text>
          </Pressable>
          <Pressable
            style={[styles.primary, canSend ? null : styles.primaryOff]}
            onPress={send}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel={sendLabel}
            accessibilityState={{ disabled: !canSend, busy: busy === "sending" }}
          >
            <Text style={[styles.primaryLabel, canSend ? null : styles.primaryLabelOff]}>{sendLabel}</Text>
          </Pressable>
        </View>
        {current ? (
          <Pressable style={styles.withdraw} onPress={withdraw} disabled={!idle} accessibilityRole="button" accessibilityState={{ disabled: !idle, busy: busy === "withdrawing" }}>
            <Text style={styles.withdrawLabel}>{t.result.reportWithdraw}</Text>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  more: {
    width: size.touchTarget,
    minHeight: size.touchTarget,
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  moreLabel: { fontSize: font.body, fontWeight: "600", color: color.encre },
  reported: { minHeight: size.touchTarget, justifyContent: "center", alignSelf: "flex-start" },
  reportedLabel: { fontSize: font.caption, color: color.acier, textDecorationLine: "underline" },
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: {
    backgroundColor: color.porcelaine,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    width: "100%",
    maxWidth: size.contentMaxWidth,
    alignSelf: "center",
  },
  grab: {
    width: size.sheetHandle.width,
    height: size.sheetHandle.height,
    borderRadius: radius.full,
    backgroundColor: color.filet,
    alignSelf: "center",
    marginBottom: space.md,
  },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre },
  question: { fontSize: font.secondary, color: color.acier, marginTop: space.xs, marginBottom: space.sm },
  option: { minHeight: size.touchTarget, flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.xs },
  radio: {
    width: size.radio.diameter,
    height: size.radio.diameter,
    borderRadius: radius.full,
    borderWidth: size.radio.border,
    borderColor: color.acier,
    alignItems: "center",
    justifyContent: "center",
  },
  radioChecked: { borderColor: color.vert },
  radioDot: { width: size.radio.diameter / 2, height: size.radio.diameter / 2, borderRadius: radius.full, backgroundColor: color.vert },
  optionLabel: { flex: 1, fontSize: font.body, color: color.encre },
  error: { fontSize: font.caption, marginTop: space.sm },
  row: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space.sm, marginTop: space.md },
  secondary: { minHeight: size.touchTarget, minWidth: size.touchTarget, paddingHorizontal: space.md, alignItems: "center", justifyContent: "center" },
  secondaryLabel: { fontSize: font.secondary, fontWeight: "600", color: color.acier },
  primary: {
    minHeight: size.touchTarget,
    minWidth: size.touchTarget,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.vert,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryOff: { backgroundColor: color.inactif },
  primaryLabel: { fontSize: font.secondary, fontWeight: "600", color: color.blanc },
  primaryLabelOff: { color: color.surInactif },
  withdraw: { minHeight: size.touchTarget, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  withdrawLabel: { fontSize: font.secondary, fontWeight: "600", color: color.acier, textDecorationLine: "underline" },
}));
