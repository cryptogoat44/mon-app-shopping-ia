import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { ApiError, acceptConsents, recordAnalyticsChoice, updateMyProfile } from "@/lib/api";
import { forgetSignupConsents, hasSignupConsents, signupAnalyticsChoice } from "@/lib/signup-consents";
import { setAnalyticsUser, track } from "@/lib/analytics";
import { getActiveLocale, t } from "@/i18n";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { ErrorMessage } from "@/components/error-message";
import { CHECKBOX_SIZE, CheckboxRow } from "@/components/checkbox-row";
import { themedStyles } from "@/theme/themed-styles";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

export default function CompleteProfileScreen() {
  const { session, profile, refreshProfile } = useAuth();
  // Cases déjà cochées à l'inscription, dans cette session : on ne les
  // redemande pas. Sinon (compte créé ailleurs, autre appareil, page
  // rechargée…), elles sont affichées et obligatoires.
  const [needsConsents] = useState(() => !hasSignupConsents(session?.user.email));
  const [ageChecked, setAgeChecked] = useState(false);
  const [documentsChecked, setDocumentsChecked] = useState(false);
  // Facultatif : choix de l'inscription si elle vient d'avoir lieu, sinon décoché.
  const [analyticsChecked, setAnalyticsChecked] = useState(() => signupAnalyticsChoice(session?.user.email));
  const consentsMissing = needsConsents && (!ageChecked || !documentsChecked);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);

    const normalizedUsername = username.trim().toLowerCase();
    if (!USERNAME_REGEX.test(normalizedUsername)) {
      setError(t.editProfile.usernameError);
      return;
    }
    if (!displayName.trim()) {
      setError(t.editProfile.displayNameError);
      return;
    }
    if (needsConsents && !ageChecked) {
      setError(t.auth.signUp.ageRequired);
      return;
    }
    if (needsConsents && !documentsChecked) {
      setError(t.auth.signUp.consentRequired);
      return;
    }

    setSubmitting(true);
    try {
      // Consentements (cases de l'inscription dans cette session, ou cases
      // de cet écran) enregistrés ici, premier moment où une session existe,
      // AVANT d'ouvrir l'app : sans preuve enregistrée (avec la version
      // acceptée), pas d'accès (audit Lot Q, PRO-04).
      await acceptConsents(["terms", "privacy_policy", "age_declaration"]);
      // Choix « statistiques d'usage » toujours enregistré (accord ou refus) :
      // la demande discrète ne sera donc jamais montrée à ce compte.
      await recordAnalyticsChoice(analyticsChecked);
      forgetSignupConsents();
      await updateMyProfile({ username: normalizedUsername, displayName: displayName.trim() });
      if (session?.user.id) {
        setAnalyticsUser(session.user.id, analyticsChecked);
        track("signup_completed", { locale: getActiveLocale() });
      }
      await refreshProfile();
      // Le layout racine redirige automatiquement vers (app) une fois le profil complet.
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(t.editProfile.usernameTaken);
      } else {
        setError(t.common.genericError);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title} accessibilityRole="header">{t.completeProfile.title}</Text>
          <Text style={styles.subtitle}>{t.completeProfile.subtitle}</Text>

          {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}

          <View style={styles.field}>
            <Text style={styles.label}>{t.editProfile.username}</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={setUsername}
              maxLength={20}
              accessibilityLabel={t.editProfile.username}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>{t.editProfile.displayName}</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="words"
              value={displayName}
              onChangeText={setDisplayName}
              maxLength={60}
              accessibilityLabel={t.editProfile.displayName}
            />
          </View>

          {needsConsents ? (
            <View style={styles.consents}>
              <CheckboxRow label={t.auth.signUp.ageDeclaration} checked={ageChecked} onToggle={() => setAgeChecked((c) => !c)} />
              <CheckboxRow
                style={styles.consentRow}
                label={t.auth.signUp.consent}
                checked={documentsChecked}
                onToggle={() => setDocumentsChecked((c) => !c)}
              />
              <CheckboxRow
                style={styles.consentRow}
                label={t.auth.signUp.analyticsConsent}
                checked={analyticsChecked}
                onToggle={() => setAnalyticsChecked((c) => !c)}
              />
              <View style={styles.legalLinks}>
                <Link href="/conditions" asChild>
                  <Pressable accessibilityRole="link" hitSlop={12}>
                    <Text style={styles.legalLink}>{t.legal.readTerms}</Text>
                  </Pressable>
                </Link>
                <Link href="/confidentialite" asChild>
                  <Pressable accessibilityRole="link" hitSlop={12}>
                    <Text style={styles.legalLink}>{t.legal.readPrivacy}</Text>
                  </Pressable>
                </Link>
              </View>
            </View>
          ) : null}

          <Pressable accessibilityRole="button"
            style={[styles.cta, (submitting || !username || !displayName || consentsMissing) ? styles.ctaDisabled : null]}
            onPress={handleSubmit}
            disabled={submitting || !username || !displayName || consentsMissing}
          >
            <Text style={[styles.ctaLabel, (submitting || !username || !displayName || consentsMissing) ? styles.ctaLabelDisabled : null]}>{submitting ? t.editProfile.saving : t.completeProfile.continue}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center", paddingVertical: space.lg, paddingHorizontal: space.xl, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, color: color.encre },
  subtitle: { fontSize: font.secondary, color: color.acier, marginTop: space.xs, marginBottom: space.xl, lineHeight: 20 },
  error: { fontSize: font.caption, color: color.acier, marginBottom: space.md },
  field: { marginBottom: space.md },
  label: { fontSize: font.caption, color: color.acier, marginBottom: space.xs },
  consents: { marginTop: space.sm },
  consentRow: { marginTop: space.sm },
  legalLinks: { marginLeft: CHECKBOX_SIZE + space.sm, marginTop: space.xs, gap: space.sm },
  legalLink: { fontSize: font.caption, color: color.vert, fontWeight: "600", minHeight: 20 },
  input: { borderBottomWidth: 1, borderBottomColor: color.filet, paddingVertical: 10, fontSize: font.body, color: color.encre },
  cta: { backgroundColor: color.vert, borderRadius: radius.md, paddingVertical: 16, alignItems: "center", marginTop: space.lg },
  ctaDisabled: { backgroundColor: color.inactif, borderColor: color.inactif },
  ctaLabelDisabled: { color: color.surInactif },
  ctaLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
}));
