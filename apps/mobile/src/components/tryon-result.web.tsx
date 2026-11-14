// Essayage virtuel photo (site) : le résultat. L'image porte déjà, en bas, le
// bandeau « Image générée par IA » ajouté par le serveur ; elle est affichée
// depuis la mémoire (adresse blob:, libérée à la fermeture de la fenêtre).
// Actions : « Enregistrer l'image » (téléchargement direct), « Signaler »
// (motif et commentaire facultatif, jamais d'image), « Essayer une autre
// photo ». Aucun partage vers le fil ni vers une publication. Fichier .web :
// jamais dans l'app iPhone.
import { useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import type { TryonRemaining, TryonReportReason } from "@monapp/shared-types";
import { color, font, radius, size, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";
import { getActiveLocale } from "@/i18n";
import { tryonText } from "@/i18n/tryon.web";
import { reportTryonResult } from "@/lib/tryon-api.web";
import { failureOf, remainingText, reportFailureMessage, type TryonFailure } from "@/lib/tryon-flow.web";
import { REPORT_COMMENT_MAX_LENGTH, REPORT_REASONS, buildReport } from "@/lib/tryon-read.web";
import { useTryonStatus } from "@/lib/use-tryon-status.web";
import { ErrorMessage } from "@/components/error-message";
import { ButtonRow, Paragraph, PrimaryButton, SecondaryButton, StepTitle, SubTitle, TextButton } from "./tryon-ui.web";

export function ResultStep({
  itemId,
  imageUrl,
  remaining,
  onSave,
  onAnother,
  onClose,
}: {
  itemId: string;
  imageUrl: string;
  remaining: TryonRemaining;
  onSave: () => void;
  onAnother: () => void;
  onClose: () => void;
}) {
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <View>
      <StepTitle>{tryonText.result.title}</StepTitle>
      <View style={styles.frame}>
        {imageFailed ? (
          <ErrorMessage style={styles.imageError}>{tryonText.result.imageError}</ErrorMessage>
        ) : (
          <Image
            source={{ uri: imageUrl }}
            style={styles.image}
            contentFit="contain"
            // En mémoire seulement : aucune copie de l'image sur le disque.
            cachePolicy="memory"
            accessibilityLabel={tryonText.result.imageLabel}
            onError={() => setImageFailed(true)}
          />
        )}
      </View>
      <Paragraph>{tryonText.result.aiNotice}</Paragraph>
      <Text style={styles.counter}>{remainingText(remaining)}</Text>
      <PrimaryButton label={tryonText.result.save} onPress={onSave} disabled={imageFailed} />
      {reporting ? (
        <ReportForm
          itemId={itemId}
          onSent={() => {
            setReporting(false);
            setReported(true);
          }}
          onCancel={() => setReporting(false)}
        />
      ) : reported ? (
        <Text style={styles.thanks} accessibilityLiveRegion="polite">
          {tryonText.report.thanks}
        </Text>
      ) : (
        <SecondaryButton label={tryonText.result.report} onPress={() => setReporting(true)} />
      )}
      <SecondaryButton label={tryonText.result.another} onPress={onAnother} />
      <TextButton label={tryonText.sheet.close} onPress={onClose} />
    </View>
  );
}

/** Signalement d'un résultat : un motif parmi quatre, un commentaire
 * facultatif (500 caractères au plus). Seuls la pièce, le motif et le
 * commentaire partent ; jamais l'image. */
export function ReportForm({ itemId, onSent, onCancel }: { itemId: string; onSent: () => void; onCancel: () => void }) {
  const status = useTryonStatus();
  const [reason, setReason] = useState<TryonReportReason | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<TryonFailure | null>(null);
  // Double appui avant le nouveau rendu : un seul signalement part.
  const sending = useRef(false);
  const report = buildReport(itemId, reason, comment);

  async function send() {
    if (!report || sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await reportTryonResult(report);
      onSent();
    } catch (e) {
      setFailure(failureOf(e));
      setBusy(false);
    } finally {
      sending.current = false;
    }
  }

  return (
    <View style={styles.report}>
      <SubTitle>{tryonText.report.title}</SubTitle>
      <Text style={styles.question}>{tryonText.report.question}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={tryonText.report.question}>
        {REPORT_REASONS.map((value) => {
          const checked = reason === value;
          const label = tryonText.report.reasons[value];
          return (
            <Pressable
              key={value}
              style={styles.option}
              onPress={() => setReason(value)}
              disabled={busy}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked, disabled: busy }}
            >
              <View style={[styles.radio, checked ? styles.radioChecked : null]}>{checked ? <View style={styles.radioDot} /> : null}</View>
              <Text style={styles.optionLabel}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.label}>{tryonText.report.commentLabel}</Text>
      <TextInput
        style={styles.input}
        value={comment}
        onChangeText={setComment}
        maxLength={REPORT_COMMENT_MAX_LENGTH}
        multiline
        editable={!busy}
        accessibilityLabel={tryonText.report.commentLabel}
      />
      <Text style={styles.count}>{tryonText.report.commentCount(comment.length, REPORT_COMMENT_MAX_LENGTH)}</Text>
      <Paragraph>{tryonText.report.noImage}</Paragraph>
      {failure ? <ErrorMessage style={styles.error}>{reportFailureMessage(failure, status, getActiveLocale())}</ErrorMessage> : null}
      <ButtonRow>
        <SecondaryButton label={tryonText.report.cancel} onPress={onCancel} disabled={busy} />
        <PrimaryButton label={busy ? tryonText.report.sending : tryonText.report.send} onPress={() => void send()} disabled={!report} busy={busy} />
      </ButtonRow>
    </View>
  );
}

const styles = themedStyles(() => ({
  frame: { width: "100%", aspectRatio: 3 / 4, borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.plinthe, marginBottom: space.sm, justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  imageError: { fontSize: font.secondary, textAlign: "center", paddingHorizontal: space.lg },
  counter: { fontSize: font.caption, color: color.acier, marginBottom: space.xs },
  thanks: { fontSize: font.secondary, color: color.encre, marginTop: space.md },
  report: { borderTopWidth: 1, borderTopColor: color.filet, marginTop: space.md, paddingTop: space.sm },
  question: { fontSize: font.secondary, color: color.acier, marginBottom: space.xs },
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
  label: { fontSize: font.caption, fontWeight: "600", color: color.acier, marginTop: space.md, marginBottom: space.xs },
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    padding: space.sm,
    fontSize: font.secondary,
    color: color.encre,
    backgroundColor: color.surface,
    textAlignVertical: "top",
  },
  count: { fontSize: font.caption, color: color.acier, alignSelf: "flex-end", marginTop: space.xs, marginBottom: space.sm },
  error: { fontSize: font.secondary, marginTop: space.sm, lineHeight: 21 },
}));
