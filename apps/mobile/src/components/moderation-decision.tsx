import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { MODERATION_NOTE_MAX_LENGTH, REPORT_REASONS, type ReportReason } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { SegmentedChoice } from "@/components/segmented-choice";
import { reportReasonLabel } from "@/lib/moderation-labels";
import { themedStyles } from "@/theme/themed-styles";

export type DecisionKind = "hide" | "suspend";

/** Masquer ou suspendre (lot 5) : motif obligatoire, précision facultative
 * montrée à la personne concernée ; la suspension s'annonce avant d'être
 * confirmée. */
export function DecisionPanel({
  kind,
  initialReason,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: DecisionKind;
  initialReason: ReportReason;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: ReportReason, note: string) => void;
}) {
  const [reason, setReason] = useState<ReportReason>(initialReason);
  const [note, setNote] = useState("");
  const suspend = kind === "suspend";
  const confirmLabel = suspend ? t.moderationQueue.confirmSuspend : t.moderationQueue.confirmHide;

  return (
    <View style={styles.panel}>
      <Text style={styles.label}>{t.moderationQueue.reason}</Text>
      <SegmentedChoice
        label={t.moderationQueue.reason}
        options={REPORT_REASONS.map((value) => ({ value, label: reportReasonLabel(value) }))}
        value={reason}
        onChange={setReason}
      />
      <Text style={[styles.label, styles.spaced]}>{t.moderationQueue.noteLabel}</Text>
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        maxLength={MODERATION_NOTE_MAX_LENGTH}
        multiline
        accessibilityLabel={t.moderationQueue.noteLabel}
        accessibilityHint={t.moderationQueue.noteHint}
        placeholderTextColor={color.acier}
      />
      <Text style={styles.hint}>{t.moderationQueue.noteHint}</Text>
      {suspend ? <Text style={styles.warning}>{t.moderationQueue.suspendWarning}</Text> : null}
      <View style={styles.row}>
        <Pressable style={styles.secondary} onPress={onCancel} disabled={busy} accessibilityRole="button" accessibilityLabel={t.common.cancel}>
          <Text style={styles.secondaryLabel}>{t.common.cancel}</Text>
        </Pressable>
        <Pressable
          style={[styles.primary, suspend ? styles.primaryDanger : null, busy ? styles.primaryBusy : null]}
          onPress={() => onConfirm(reason, note.trim())}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
          accessibilityState={{ disabled: busy, busy }}
        >
          <Text style={[styles.primaryLabel, busy ? styles.primaryLabelBusy : null]}>{confirmLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Retirer l'image copiée (lot 5, partie B) : motif neutre fixé par le
 * serveur (« droits sur l'image ») ; précision facultative ; définitif, donc
 * toujours annoncé avant d'être confirmé. */
export function RemoveImagePanel({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <View style={styles.panel}>
      <Text style={styles.warningFirst}>{t.moderationQueue.removeImageWarning}</Text>
      <Text style={[styles.label, styles.spaced]}>{t.moderationQueue.noteLabel}</Text>
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        maxLength={MODERATION_NOTE_MAX_LENGTH}
        multiline
        accessibilityLabel={t.moderationQueue.noteLabel}
        accessibilityHint={t.moderationQueue.noteHint}
        placeholderTextColor={color.acier}
      />
      <Text style={styles.hint}>{t.moderationQueue.noteHint}</Text>
      <View style={styles.row}>
        <Pressable style={styles.secondary} onPress={onCancel} disabled={busy} accessibilityRole="button" accessibilityLabel={t.common.cancel}>
          <Text style={styles.secondaryLabel}>{t.common.cancel}</Text>
        </Pressable>
        <Pressable
          style={[styles.primary, styles.primaryDanger, busy ? styles.primaryBusy : null]}
          onPress={() => onConfirm(note.trim())}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t.moderationQueue.confirmRemoveImage}
          accessibilityState={{ disabled: busy, busy }}
        >
          <Text style={[styles.primaryLabel, busy ? styles.primaryLabelBusy : null]}>{t.moderationQueue.confirmRemoveImage}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  panel: { marginTop: space.sm, paddingTop: space.md, borderTopWidth: 1, borderTopColor: color.filet },
  label: { fontSize: font.caption, fontWeight: "600", color: color.acier, marginBottom: space.sm },
  spaced: { marginTop: space.md },
  input: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    padding: space.sm,
    fontSize: font.secondary,
    color: color.encre,
    textAlignVertical: "top",
  },
  hint: { fontSize: font.caption, color: color.acier, marginTop: space.xs, lineHeight: 18 },
  warning: { fontSize: font.secondary, color: color.encre, marginTop: space.md, lineHeight: 20 },
  warningFirst: { fontSize: font.secondary, color: color.encre, lineHeight: 20 },
  row: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space.sm, marginTop: space.md },
  secondary: { minHeight: 44, minWidth: 44, paddingHorizontal: space.md, alignItems: "center", justifyContent: "center" },
  secondaryLabel: { fontSize: font.secondary, fontWeight: "600", color: color.acier },
  primary: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: color.vert,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryDanger: { backgroundColor: color.danger },
  primaryBusy: { backgroundColor: color.inactif },
  primaryLabel: { fontSize: font.secondary, fontWeight: "600", color: color.blanc },
  primaryLabelBusy: { color: color.surInactif },
}));
