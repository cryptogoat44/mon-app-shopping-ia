import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import { translateAuthError } from "@/lib/auth-errors";
import { forgetSignupConsents, rememberSignupConsents } from "@/lib/signup-consents";
import { supabase } from "@/lib/supabase";
import { getActiveLocale, t } from "@/i18n";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { ErrorMessage } from "@/components/error-message";
import { CHECKBOX_SIZE, CheckboxRow } from "@/components/checkbox-row";
import { themedStyles } from "@/theme/themed-styles";

export default function SignUpScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [ageChecked, setAgeChecked] = useState(false);
  // Facultatif, décoché par défaut (lot 2).
  const [analyticsChecked, setAnalyticsChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  async function handleSignUp() {
    setError(null);

    if (password.length < 8) {
      setError(t.auth.reset.tooShort);
      return;
    }
    if (password !== confirmPassword) {
      setError(t.auth.reset.mismatch);
      return;
    }
    if (!ageChecked) {
      setError(t.auth.signUp.ageRequired);
      return;
    }
    if (!consentChecked) {
      setError(t.auth.signUp.consentRequired);
      return;
    }

    setSubmitting(true);
    // Mémorisé AVANT l'appel : la session peut s'ouvrir (et la « Dernière
    // étape » s'afficher) avant la fin de l'appel. Effacé en cas d'échec.
    rememberSignupConsents(email, analyticsChecked);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // Langue des e-mails d'authentification (modèles Supabase, lot 3).
      options: { data: { locale: getActiveLocale() } },
    });
    setSubmitting(false);

    if (signUpError) {
      forgetSignupConsents();
      setError(translateAuthError(signUpError.message));
      return;
    }

    // Si la confirmation par email est activée sur le projet Supabase,
    // aucune session n'est ouverte tant que le lien reçu n'est pas cliqué.
    if (!data.session) {
      setConfirmationSent(true);
    }
    // Sinon : onAuthStateChange ouvre la session, le layout racine redirige vers la « Dernière étape ».
  }

  if (confirmationSent) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}>
          <Text style={styles.title} accessibilityRole="header">{t.auth.signUp.confirmTitle}</Text>
          <Text style={styles.subtitle}>{t.auth.signUp.confirmBody(email.trim())}</Text>
          <Link href="/sign-in" asChild>
            <Pressable accessibilityRole="button" hitSlop={12}>
              <Text style={styles.link}>{t.auth.signUp.backToSignIn}</Text>
            </Pressable>
          </Link>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/bienvenue"))}
        hitSlop={12}
        style={styles.nav}
        accessibilityRole="button"
        accessibilityLabel={t.common.back}
      >
        <Text style={styles.back}>‹</Text>
      </Pressable>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.content}>
          <Text style={styles.title} accessibilityRole="header">{t.auth.signUp.title}</Text>
          <Text style={styles.subtitle}>{t.auth.signUp.subtitle}</Text>

          {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}

          <View style={styles.field}>
            <Text style={styles.label}>{t.auth.email}</Text>
            <TextInput
              style={styles.input}
              placeholderTextColor={color.acier}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={setEmail}
              accessibilityLabel={t.auth.email}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>{t.auth.password}</Text>
            <TextInput
              style={styles.input}
              placeholderTextColor={color.acier}
              secureTextEntry
              textContentType="newPassword"
              autoCapitalize="none"
              autoCorrect={false}
              value={password}
              onChangeText={setPassword}
              accessibilityLabel={t.auth.password}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>{t.auth.signUp.confirmPassword}</Text>
            <TextInput
              style={styles.input}
              placeholderTextColor={color.acier}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              accessibilityLabel={t.auth.signUp.confirmPassword}
            />
          </View>

          <CheckboxRow
            style={styles.consentRow}
            label={t.auth.signUp.ageDeclaration}
            checked={ageChecked}
            onToggle={() => setAgeChecked((c) => !c)}
          />
          <CheckboxRow
            style={styles.consentRow}
            label={t.auth.signUp.consent}
            checked={consentChecked}
            onToggle={() => setConsentChecked((c) => !c)}
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

          <Pressable accessibilityRole="button"
            style={[styles.cta, (submitting || !email || !password || !confirmPassword || !consentChecked || !ageChecked) ? styles.ctaDisabled : null]}
            onPress={handleSignUp}
            disabled={submitting || !email || !password || !confirmPassword || !consentChecked || !ageChecked}
          >
            <Text style={[styles.ctaLabel, (submitting || !email || !password || !confirmPassword || !consentChecked || !ageChecked) ? styles.ctaLabelDisabled : null]}>{submitting ? t.auth.signUp.ctaLoading : t.auth.signUp.cta}</Text>
          </Pressable>

          <Link href="/sign-in" asChild>
            <Pressable accessibilityRole="button" hitSlop={12}>
              <Text style={styles.link}>{t.auth.signUp.hasAccount}</Text>
            </Pressable>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  flex: { flex: 1 },
  nav: { height: 47, justifyContent: "center", paddingHorizontal: 12 },
  back: { fontSize: 26, color: color.encre },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, color: color.encre },
  subtitle: { fontSize: font.secondary, color: color.acier, marginTop: space.xs, marginBottom: space.xl, lineHeight: 20 },
  error: { fontSize: font.caption, color: color.acier, marginBottom: space.md },
  field: { marginBottom: space.md },
  label: { fontSize: font.caption, color: color.acier, marginBottom: space.xs },
  input: { borderBottomWidth: 1, borderBottomColor: color.filet, paddingVertical: 10, fontSize: font.body, color: color.encre },
  consentRow: { marginTop: space.sm },
  legalLinks: { marginLeft: CHECKBOX_SIZE + space.sm, marginTop: space.xs, gap: space.sm },
  legalLink: { fontSize: font.caption, color: color.vert, fontWeight: "600", minHeight: 20 },
  cta: { backgroundColor: color.vert, borderRadius: radius.md, paddingVertical: 16, alignItems: "center", marginTop: space.lg },
  ctaDisabled: { backgroundColor: color.inactif, borderColor: color.inactif },
  ctaLabelDisabled: { color: color.surInactif },
  ctaLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  link: { fontSize: font.secondary, color: color.acier, fontWeight: "600", textAlign: "center", marginTop: space.lg },
}));
