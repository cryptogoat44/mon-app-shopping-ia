// Essayage virtuel photo, app iPhone : les étapes d'accès du parcours.
// Attente du statut, essayage indisponible, message neutre pour une personne
// mineure et consentement : celles du site, reprises telles quelles (mêmes
// textes, même « En savoir plus », mêmes règles d'usage, même version du
// texte envoyée par « J'accepte » ; tryon-steps.web.tsx). Propres à
// l'iPhone : la porte d'âge (un champ au clavier numérique à la place du
// champ de date du navigateur) et le texte de consentement plus récent que
// celui de l'app (une mise à jour de l'app, pas une page à recharger).
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";
import { t } from "@/i18n";
import { tryonIphoneText, tryonText } from "@/i18n/tryon.ios";
import { BIRTH_DATE_INPUT_LENGTH, formatBirthDateInput } from "@/lib/tryon-age.ios";
import { birthDateIssueMessage, parisDay } from "@/lib/tryon-flow.ios";
import { checkBirthDate, type BirthDateIssue } from "@/lib/tryon-read.ios";
import { ErrorMessage } from "@/components/error-message";
import { Paragraph, PrimaryButton, SecondaryButton, StepTitle } from "./tryon-ui.ios";

export { ConsentStep, LoadFailedStep, LoadingStep, MinorStep, UnavailableStep } from "./tryon-steps.web";

/** Porte d'âge : la date part une seule fois au serveur, qui ne garde que
 * « majeur » ou « mineur » et l'heure. Champ vide au départ : aucune date
 * proposée qu'un appui distrait enverrait (le statut enregistré ne change
 * plus). Contrôle immédiat avant l'envoi, celui du site. */
export function AgeStep({ failure, busy, onSubmit }: { failure: string | null; busy: boolean; onSubmit: (birthDate: string) => void }) {
  const [value, setValue] = useState("");
  const [issue, setIssue] = useState<BirthDateIssue | null>(null);

  function submit() {
    if (busy) return;
    const problem = checkBirthDate(value, parisDay(new Date()));
    setIssue(problem);
    if (!problem) onSubmit(value);
  }

  const message = issue ? birthDateIssueMessage(issue) : failure;
  return (
    <View>
      <StepTitle>{tryonText.age.title}</StepTitle>
      <Paragraph>{tryonText.age.intro}</Paragraph>
      <Paragraph>{tryonText.age.final}</Paragraph>
      {/* Libellé et aide lus par VoiceOver sur le champ lui-même : cachés ici pour ne pas être lus deux fois. */}
      <Text style={styles.label} accessibilityElementsHidden importantForAccessibility="no">
        {tryonText.age.label}
      </Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={(text) => {
          setValue(formatBirthDateInput(text));
          setIssue(null);
        }}
        keyboardType="number-pad"
        maxLength={BIRTH_DATE_INPUT_LENGTH}
        editable={!busy}
        autoCorrect={false}
        // Aucune date proposée par iOS : son format ne serait pas celui du champ.
        autoComplete="off"
        textContentType="none"
        accessibilityLabel={tryonText.age.label}
        accessibilityHint={tryonText.age.hint}
        testID="essai-date-naissance"
      />
      <Text style={styles.hint} accessibilityElementsHidden importantForAccessibility="no">
        {tryonText.age.hint}
      </Text>
      {message ? <ErrorMessage style={styles.error}>{message}</ErrorMessage> : null}
      <PrimaryButton label={busy ? tryonText.age.submitting : tryonText.age.submit} onPress={submit} busy={busy} />
    </View>
  );
}

/** Le serveur demande une version du texte de consentement plus récente que
 * celle de cette app (texte mis à jour depuis sa sortie) : rien à accepter
 * ici, jamais de bouton « J'accepte » ; seule une mise à jour de l'app
 * apporte le nouveau texte. */
export function ConsentUpdateStep({ onClose }: { onClose: () => void }) {
  return (
    <View>
      <StepTitle>{tryonText.consent.reloadTitle}</StepTitle>
      <Paragraph strong>{tryonIphoneText.consent.updateBody}</Paragraph>
      <Paragraph>{t.appUpdate.searchStore}</Paragraph>
      <SecondaryButton label={tryonText.sheet.close} onPress={onClose} />
    </View>
  );
}

// Même présentation que le champ de date du site (tryon-steps.web.tsx).
const styles = themedStyles(() => ({
  label: { fontSize: font.caption, fontWeight: "600", color: color.acier, marginTop: space.md, marginBottom: space.xs },
  input: {
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.filet,
    backgroundColor: color.surface,
    color: color.encre,
    fontSize: font.body,
  },
  hint: { fontSize: font.caption, color: color.acier, marginTop: space.xs },
  error: { fontSize: font.secondary, marginTop: space.sm, lineHeight: 21 },
}));
