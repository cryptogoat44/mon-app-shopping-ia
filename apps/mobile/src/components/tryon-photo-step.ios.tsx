// Essayage virtuel photo, app iPhone : le choix de la photo, comme sur le site
// (tryon-photo-step.web.tsx) et avec les mêmes textes : conseils, photothèque
// ou appareil photo (libellés généraux de l'app, « Choisir dans la galerie »
// et « Prendre une photo »), aperçu, case « Cette photo est la mienne » à
// recocher pour chaque photo, essais restants, « Lancer l'essai ». L'attente
// du résultat est reprise telle quelle. L'aperçu est le JPEG converti,
// affiché sans être gardé dans aucun cache d'images (cachePolicy « none ») :
// sur l'iPhone, il n'existe que son fichier temporaire, effacé par la fenêtre.
import { Text, View } from "react-native";
import { Image } from "expo-image";
import type { TryonRemaining } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";
import { t } from "@/i18n";
import { tryonText } from "@/i18n/tryon.ios";
import { hasTriesLeft, remainingText, type FailureView } from "@/lib/tryon-flow.ios";
import { CheckboxRow } from "@/components/checkbox-row";
import { ErrorMessage } from "@/components/error-message";
import { BulletList, Paragraph, PrimaryButton, SecondaryButton, StepTitle, SubTitle } from "./tryon-ui.ios";

export { RunningStep } from "./tryon-photo-step.web";

export function PhotoStep({
  remaining,
  quotaText,
  photoUri,
  attested,
  preparing,
  refusal,
  failure,
  onLibrary,
  onCamera,
  onToggleAttest,
  onLaunch,
}: {
  /** Essais restants (null : statut relu entre-temps comme éteint). */
  remaining: TryonRemaining | null;
  /** Plus aucun essai : le message daté des prochains. */
  quotaText: string;
  /** Le JPEG converti, prêt à partir. */
  photoUri: string | null;
  attested: boolean;
  /** Conversion en cours, après le choix. */
  preparing: boolean;
  /** Photo refusée sur l'iPhone (appareil photo refusé ou absent, photo illisible). */
  refusal: string | null;
  /** Refus du serveur au dernier essai. */
  failure: FailureView | null;
  onLibrary: () => void;
  onCamera: () => void;
  onToggleAttest: () => void;
  onLaunch: () => void;
}) {
  const triesLeft = remaining === null || hasTriesLeft(remaining);
  const canLaunch = photoUri !== null && attested && triesLeft && !preparing;
  return (
    <View>
      <StepTitle>{tryonText.photo.title}</StepTitle>
      {/* Le refus du dernier essai d'abord ; « silhouette non reconnue » finit par « ces conseils : », la liste suit. */}
      {failure ? <ErrorMessage style={styles.error}>{failure.message}</ErrorMessage> : null}
      <SubTitle>{tryonText.photo.tipsTitle}</SubTitle>
      <BulletList items={tryonText.photo.tips} />
      <Paragraph>{tryonText.photo.formats}</Paragraph>
      {photoUri ? (
        <View style={styles.previewFrame}>
          <Image
            source={{ uri: photoUri }}
            style={styles.preview}
            contentFit="contain"
            // Aucun cache d'images : ni copie sur le disque, ni image gardée en mémoire après la fermeture.
            cachePolicy="none"
            accessibilityLabel={tryonText.photo.previewLabel}
            accessibilityIgnoresInvertColors
          />
        </View>
      ) : null}
      {preparing ? (
        <SecondaryButton label={tryonText.photo.preparing} onPress={() => undefined} busy />
      ) : (
        <>
          <SecondaryButton label={t.avatarPhoto.chooseFromLibrary} onPress={onLibrary} testID="essai-photo-galerie" />
          <SecondaryButton label={t.cameraCapture.takePhoto} onPress={onCamera} testID="essai-photo-appareil" />
        </>
      )}
      {refusal ? <ErrorMessage style={styles.error}>{refusal}</ErrorMessage> : null}
      {photoUri ? <CheckboxRow label={tryonText.photo.attest} checked={attested} onToggle={onToggleAttest} style={styles.attest} /> : null}
      {remaining ? <Text style={styles.counter}>{triesLeft ? remainingText(remaining) : quotaText}</Text> : null}
      <PrimaryButton label={tryonText.photo.launch} onPress={onLaunch} disabled={!canLaunch} testID="lancer-essai" />
    </View>
  );
}

// Même présentation que sur le site (tryon-photo-step.web.tsx).
const styles = themedStyles(() => ({
  error: { fontSize: font.secondary, marginBottom: space.sm, lineHeight: 21 },
  previewFrame: { height: 280, borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.plinthe, marginTop: space.sm },
  preview: { width: "100%", height: "100%" },
  attest: { marginTop: space.md },
  counter: { fontSize: font.caption, color: color.acier, marginTop: space.md },
}));
