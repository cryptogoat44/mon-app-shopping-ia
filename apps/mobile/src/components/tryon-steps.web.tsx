// Essayage virtuel photo (site) : les étapes d'accès du parcours — attente du
// statut, essayage indisponible, porte d'âge, message neutre pour une
// personne mineure, consentement, texte mis à jour (page à recharger). Les
// textes viennent du catalogue réservé au site (src/i18n/tryon-*.web.ts).
// Fichier .web : jamais dans l'app iPhone.
import { useState, type CSSProperties } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { color, font, getActiveScheme, radius, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";
import { tryonText } from "@/i18n/tryon.web";
import { birthDateIssueMessage, parisDay } from "@/lib/tryon-flow.web";
import { OLDEST_BIRTH_DATE, checkBirthDate, type BirthDateIssue } from "@/lib/tryon-read.web";
import { ErrorMessage } from "@/components/error-message";
import { BulletList, ButtonRow, Paragraph, PrimaryButton, SecondaryButton, StepTitle, SubTitle, TextButton } from "./tryon-ui.web";

/** Identifiants du champ de date (libellé et aide lus par les lecteurs d'écran). */
const BIRTH_LABEL_ID = "essai-date-naissance-libelle";
const BIRTH_HINT_ID = "essai-date-naissance-aide";

export function LoadingStep() {
  return (
    <View style={styles.centered} accessibilityLiveRegion="polite">
      <ActivityIndicator color={color.encre} />
      <Text style={styles.muted}>{tryonText.sheet.loading}</Text>
    </View>
  );
}

export function LoadFailedStep({ message, onRetry, onClose }: { message: string; onRetry: () => void; onClose: () => void }) {
  return (
    <View>
      <ErrorMessage style={styles.error}>{message}</ErrorMessage>
      <ButtonRow>
        <SecondaryButton label={tryonText.sheet.close} onPress={onClose} />
        <PrimaryButton label={tryonText.sheet.retry} onPress={onRetry} />
      </ButtonRow>
    </View>
  );
}

export function UnavailableStep({ onClose }: { onClose: () => void }) {
  return (
    <View>
      <Paragraph strong>{tryonText.sheet.unavailable}</Paragraph>
      <SecondaryButton label={tryonText.sheet.close} onPress={onClose} />
    </View>
  );
}

/** Personne mineure : un message neutre, sans autre choix que fermer. */
export function MinorStep({ onClose }: { onClose: () => void }) {
  return (
    <View>
      <StepTitle>{tryonText.minor.title}</StepTitle>
      <Paragraph strong>{tryonText.minor.body}</Paragraph>
      <SecondaryButton label={tryonText.sheet.close} onPress={onClose} />
    </View>
  );
}

/** Champ de date du navigateur (son calendrier, accessible) aux couleurs du thème. */
function dateFieldStyle(): CSSProperties {
  return {
    boxSizing: "border-box",
    width: "100%",
    minHeight: 48,
    padding: "10px 12px",
    borderRadius: radius.md,
    border: `1px solid ${color.filet}`,
    backgroundColor: color.surface,
    color: color.encre,
    fontSize: font.body,
    fontFamily: "inherit",
    colorScheme: getActiveScheme(),
  };
}

/** Porte d'âge : la date part une seule fois au serveur, qui ne garde que
 * « majeur » ou « mineur » et l'heure. Contrôle immédiat avant l'envoi. */
export function AgeStep({ failure, busy, onSubmit }: { failure: string | null; busy: boolean; onSubmit: (birthDate: string) => void }) {
  const [value, setValue] = useState("");
  const [issue, setIssue] = useState<BirthDateIssue | null>(null);
  const today = parisDay(new Date());

  function submit() {
    if (busy) return;
    const problem = checkBirthDate(value, today);
    setIssue(problem);
    if (!problem) onSubmit(value);
  }

  const message = issue ? birthDateIssueMessage(issue) : failure;
  return (
    <View>
      <StepTitle>{tryonText.age.title}</StepTitle>
      <Paragraph>{tryonText.age.intro}</Paragraph>
      <Paragraph>{tryonText.age.final}</Paragraph>
      <Text nativeID={BIRTH_LABEL_ID} style={styles.label}>
        {tryonText.age.label}
      </Text>
      <input
        type="date"
        value={value}
        min={OLDEST_BIRTH_DATE}
        max={today}
        required
        autoComplete="bday"
        disabled={busy}
        aria-labelledby={BIRTH_LABEL_ID}
        aria-describedby={BIRTH_HINT_ID}
        aria-invalid={issue !== null}
        onChange={(event) => {
          setValue(event.currentTarget.value);
          setIssue(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
        }}
        style={dateFieldStyle()}
      />
      <Text nativeID={BIRTH_HINT_ID} style={styles.hint}>
        {tryonText.age.hint}
      </Text>
      {message ? <ErrorMessage style={styles.error}>{message}</ErrorMessage> : null}
      <PrimaryButton label={busy ? tryonText.age.submitting : tryonText.age.submit} onPress={submit} busy={busy} />
    </View>
  );
}

/** Consentement : le texte, « En savoir plus » (ce qui part, combien de temps,
 * pas d'entraînement, données d'usage, retrait), les règles d'usage, puis
 * « J'accepte » / « Annuler ». Redemandé quand la version change. */
export function ConsentStep({
  renewed,
  failure,
  busy,
  onAccept,
  onCancel,
}: {
  renewed: boolean;
  failure: string | null;
  busy: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const [details, setDetails] = useState(false);
  return (
    <View>
      <StepTitle>{renewed ? tryonText.consent.renewedTitle : tryonText.consent.title}</StepTitle>
      {renewed ? <Paragraph>{tryonText.consent.renewedIntro}</Paragraph> : null}
      <Paragraph strong>{tryonText.consent.body}</Paragraph>
      <TextButton label={details ? tryonText.consent.learnLess : tryonText.consent.learnMore} onPress={() => setDetails(!details)} expanded={details} />
      {details ? (
        <View style={styles.details}>
          <SubTitle>{tryonText.consent.sentTitle}</SubTitle>
          <Paragraph>{tryonText.consent.sent}</Paragraph>
          <SubTitle>{tryonText.consent.keptTitle}</SubTitle>
          <Paragraph>{tryonText.consent.kept}</Paragraph>
          <Paragraph>{tryonText.consent.training}</Paragraph>
          <Paragraph>{tryonText.consent.usage}</Paragraph>
          <Paragraph>{tryonText.consent.withdraw}</Paragraph>
        </View>
      ) : null}
      <SubTitle>{tryonText.consent.rulesTitle}</SubTitle>
      <BulletList items={tryonText.consent.rules} />
      {failure ? <ErrorMessage style={styles.error}>{failure}</ErrorMessage> : null}
      <ButtonRow>
        <SecondaryButton label={tryonText.consent.cancel} onPress={onCancel} disabled={busy} />
        <PrimaryButton label={busy ? tryonText.consent.accepting : tryonText.consent.accept} onPress={onAccept} busy={busy} />
      </ButtonRow>
    </View>
  );
}

/** Le serveur demande une autre version du consentement que celle des
 * textes de cette page (ouverte avant une mise à jour) : rien à accepter
 * ici, jamais de bouton « J'accepte ». Recharger la page apporte le nouveau
 * texte. */
export function ConsentReloadStep({ onReload, onClose }: { onReload: () => void; onClose: () => void }) {
  return (
    <View>
      <StepTitle>{tryonText.consent.reloadTitle}</StepTitle>
      <Paragraph strong>{tryonText.consent.reloadBody}</Paragraph>
      <ButtonRow>
        <SecondaryButton label={tryonText.sheet.close} onPress={onClose} />
        <PrimaryButton label={tryonText.consent.reload} onPress={onReload} />
      </ButtonRow>
    </View>
  );
}

const styles = themedStyles(() => ({
  centered: { alignItems: "center", justifyContent: "center", gap: space.sm, paddingVertical: space.xl },
  muted: { fontSize: font.secondary, color: color.acier },
  error: { fontSize: font.secondary, marginTop: space.sm, lineHeight: 21 },
  label: { fontSize: font.caption, fontWeight: "600", color: color.acier, marginTop: space.md, marginBottom: space.xs },
  hint: { fontSize: font.caption, color: color.acier, marginTop: space.xs },
  details: { borderLeftWidth: 2, borderLeftColor: color.filet, paddingLeft: space.md, marginBottom: space.sm },
}));
