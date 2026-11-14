// Essayage virtuel photo, app iPhone : le résultat, comme sur le site
// (tryon-result.web.tsx, dont le formulaire « Signaler » est repris tel
// quel : motif, commentaire facultatif, jamais d'image). L'image porte déjà,
// en bas, le bandeau « Image générée par IA » ajouté par le serveur. Elle est
// affichée depuis la mémoire (l'adresse « data: » reçue), sans être gardée
// dans aucun cache d'images (cachePolicy « none ») ni écrite nulle part.
// « Enregistrer l'image » l'ajoute à Photos (lib/tryon-image.ios.ts) et dit
// à l'écran ce qui s'est passé : enregistrée, ajout refusé dans les Réglages,
// ou échec. Aucun partage vers le fil ni vers une publication.
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import { Image } from "expo-image";
import type { TryonRemaining } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";
import { tryonIphoneText, tryonText } from "@/i18n/tryon.ios";
import { parisDay, remainingText } from "@/lib/tryon-flow.ios";
import { saveImageToPhotos, tryonFileName, type SaveOutcome } from "@/lib/tryon-image.ios";
import { ErrorMessage } from "@/components/error-message";
import { ReportForm } from "./tryon-result.web";
import { Paragraph, PrimaryButton, SecondaryButton, StepTitle, TextButton } from "./tryon-ui.ios";

export function ResultStep({
  itemId,
  imageUri,
  remaining,
  onAnother,
  onClose,
}: {
  itemId: string;
  /** L'image produite, « data:image/jpeg;base64,… », gardée en mémoire seulement. */
  imageUri: string;
  remaining: TryonRemaining;
  onAnother: () => void;
  onClose: () => void;
}) {
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveOutcome, setSaveOutcome] = useState<SaveOutcome | null>(null);
  // Double appui avant le nouveau rendu : un seul enregistrement part.
  const savingNow = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function save() {
    if (savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    setSaveOutcome(null);
    try {
      const outcome = await saveImageToPhotos(imageUri, tryonFileName(tryonText.result.fileBase, parisDay(new Date())));
      if (!mounted.current) return;
      setSaveOutcome(outcome);
      // Les refus passent par ErrorMessage, déjà annoncé ; la réussite l'est ici.
      if (outcome === "saved") AccessibilityInfo.announceForAccessibility(tryonIphoneText.save.saved);
    } finally {
      savingNow.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <View>
      <StepTitle>{tryonText.result.title}</StepTitle>
      <View style={styles.frame}>
        {imageFailed ? (
          <ErrorMessage style={styles.imageError}>{tryonText.result.imageError}</ErrorMessage>
        ) : (
          <Image
            source={{ uri: imageUri }}
            style={styles.image}
            contentFit="contain"
            // Aucun cache d'images : ni copie sur le disque, ni image gardée en mémoire après la fermeture.
            cachePolicy="none"
            accessibilityLabel={tryonText.result.imageLabel}
            accessibilityIgnoresInvertColors
            onError={() => setImageFailed(true)}
          />
        )}
      </View>
      <Paragraph>{tryonText.result.aiNotice}</Paragraph>
      <Text style={styles.counter}>{remainingText(remaining)}</Text>
      {/* Pendant l'enregistrement, le mot du consentement enregistré (« Enregistrement… ») : aucun texte écrit deux fois. */}
      <PrimaryButton label={saving ? tryonText.consent.accepting : tryonText.result.save} onPress={() => void save()} disabled={imageFailed} busy={saving} />
      {saveOutcome === "saved" ? <Text style={styles.saved}>{tryonIphoneText.save.saved}</Text> : null}
      {saveOutcome === "denied" ? <ErrorMessage style={styles.saveError}>{tryonIphoneText.save.denied}</ErrorMessage> : null}
      {saveOutcome === "failed" ? <ErrorMessage style={styles.saveError}>{tryonIphoneText.save.failed}</ErrorMessage> : null}
      {reporting ? (
        <ReportForm
          itemId={itemId}
          onSent={() => {
            setReporting(false);
            setReported(true);
            AccessibilityInfo.announceForAccessibility(tryonText.report.thanks);
          }}
          onCancel={() => setReporting(false)}
        />
      ) : reported ? (
        <Text style={styles.thanks}>{tryonText.report.thanks}</Text>
      ) : (
        <SecondaryButton label={tryonText.result.report} onPress={() => setReporting(true)} />
      )}
      <SecondaryButton label={tryonText.result.another} onPress={onAnother} />
      <TextButton label={tryonText.sheet.close} onPress={onClose} />
    </View>
  );
}

// Même présentation que sur le site (tryon-result.web.tsx).
const styles = themedStyles(() => ({
  frame: { width: "100%", aspectRatio: 3 / 4, borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.plinthe, marginBottom: space.sm, justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  imageError: { fontSize: font.secondary, textAlign: "center", paddingHorizontal: space.lg },
  counter: { fontSize: font.caption, color: color.acier, marginBottom: space.xs },
  saved: { fontSize: font.secondary, color: color.encre, marginTop: space.sm },
  saveError: { fontSize: font.secondary, marginTop: space.sm, lineHeight: 21 },
  thanks: { fontSize: font.secondary, color: color.encre, marginTop: space.md },
}));
