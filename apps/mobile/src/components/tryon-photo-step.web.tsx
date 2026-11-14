// Essayage virtuel photo (site) : le choix de la photo (conseils, aperçu,
// case « Cette photo est la mienne », essais restants, « Lancer l'essai »)
// puis l'attente du résultat. L'aperçu est affiché depuis la mémoire (adresse
// blob:, libérée par la fenêtre), jamais copié ailleurs. Fichier .web :
// jamais dans l'app iPhone.
import { ActivityIndicator, Text, View } from "react-native";
import { Image } from "expo-image";
import type { TryonRemaining } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";
import { tryonText } from "@/i18n/tryon.web";
import { hasTriesLeft, remainingText, type FailureView } from "@/lib/tryon-flow.web";
import { CheckboxRow } from "@/components/checkbox-row";
import { ErrorMessage } from "@/components/error-message";
import { BulletList, Paragraph, PrimaryButton, SecondaryButton, StepTitle, SubTitle } from "./tryon-ui.web";

export function PhotoStep({
  remaining,
  quotaText,
  photoUrl,
  attested,
  preparing,
  refusal,
  failure,
  onChoose,
  onToggleAttest,
  onLaunch,
}: {
  /** Essais restants (null : statut relu entre-temps comme éteint). */
  remaining: TryonRemaining | null;
  /** Plus aucun essai : le message daté des prochains. */
  quotaText: string;
  photoUrl: string | null;
  attested: boolean;
  preparing: boolean;
  /** Photo refusée sur l'appareil (format, poids, HEIC illisible). */
  refusal: string | null;
  /** Refus du serveur au dernier essai. */
  failure: FailureView | null;
  onChoose: () => void;
  onToggleAttest: () => void;
  onLaunch: () => void;
}) {
  const triesLeft = remaining === null || hasTriesLeft(remaining);
  const canLaunch = photoUrl !== null && attested && triesLeft && !preparing;
  const chooseLabel = preparing ? tryonText.photo.preparing : photoUrl ? tryonText.photo.chooseAnother : tryonText.photo.choose;
  return (
    <View>
      <StepTitle>{tryonText.photo.title}</StepTitle>
      {/* Le refus du dernier essai d'abord ; « silhouette non reconnue » finit par « ces conseils : », la liste suit. */}
      {failure ? <ErrorMessage style={styles.error}>{failure.message}</ErrorMessage> : null}
      <SubTitle>{tryonText.photo.tipsTitle}</SubTitle>
      <BulletList items={tryonText.photo.tips} />
      <Paragraph>{tryonText.photo.formats}</Paragraph>
      {photoUrl ? (
        <View style={styles.previewFrame}>
          <Image
            source={{ uri: photoUrl }}
            style={styles.preview}
            contentFit="contain"
            // En mémoire seulement : aucune copie de la photo sur le disque.
            cachePolicy="memory"
            accessibilityLabel={tryonText.photo.previewLabel}
          />
        </View>
      ) : null}
      <SecondaryButton label={chooseLabel} onPress={onChoose} busy={preparing} />
      {refusal ? <ErrorMessage style={styles.error}>{refusal}</ErrorMessage> : null}
      {photoUrl ? <CheckboxRow label={tryonText.photo.attest} checked={attested} onToggle={onToggleAttest} style={styles.attest} /> : null}
      {remaining ? <Text style={styles.counter}>{triesLeft ? remainingText(remaining) : quotaText}</Text> : null}
      <PrimaryButton label={tryonText.photo.launch} onPress={onLaunch} disabled={!canLaunch} testID="lancer-essai" />
    </View>
  );
}

/** Pendant l'essai (environ 10 secondes). */
export function RunningStep() {
  return (
    <View style={styles.running} accessibilityLiveRegion="polite">
      <ActivityIndicator color={color.encre} size="large" />
      <Text style={styles.runningTitle} accessibilityRole="header">
        {tryonText.running.title}
      </Text>
      <Text style={styles.runningText}>{tryonText.running.duration}</Text>
      <Text style={styles.runningText}>{tryonText.running.keepOpen}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  error: { fontSize: font.secondary, marginBottom: space.sm, lineHeight: 21 },
  previewFrame: { height: 280, borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.plinthe, marginTop: space.sm },
  preview: { width: "100%", height: "100%" },
  attest: { marginTop: space.md },
  counter: { fontSize: font.caption, color: color.acier, marginTop: space.md },
  running: { alignItems: "center", gap: space.sm, paddingVertical: space.xl },
  runningTitle: { fontSize: font.body, fontWeight: "600", color: color.encre, textAlign: "center", marginTop: space.sm },
  runningText: { fontSize: font.secondary, color: color.acier, textAlign: "center", lineHeight: 21 },
}));
