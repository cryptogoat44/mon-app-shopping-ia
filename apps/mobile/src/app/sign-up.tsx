import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { translateAuthError } from "@/lib/auth-errors";
import { supabase } from "@/lib/supabase";
import { fr } from "@/i18n/fr";
import { color, font, radius, serifFont, space } from "@/theme/tokens";

export default function SignUpScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  async function handleSignUp() {
    setError(null);

    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    if (!consentChecked) {
      setError("Merci d'accepter les Conditions d'Utilisation pour continuer.");
      return;
    }

    setSubmitting(true);
    const { data, error: signUpError } = await supabase.auth.signUp({ email: email.trim(), password });
    setSubmitting(false);

    if (signUpError) {
      setError(translateAuthError(signUpError.message));
      return;
    }

    // Si la confirmation par email est activée sur le projet Supabase,
    // aucune session n'est ouverte tant que le lien reçu n'est pas cliqué.
    if (!data.session) {
      setConfirmationSent(true);
    }
    // Sinon : onAuthStateChange ouvre la session, le layout racine redirige vers "complète ton profil".
  }

  if (confirmationSent) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}>
          <Text style={styles.title}>{fr.auth.signUp.confirmTitle}</Text>
          <Text style={styles.subtitle}>{fr.auth.signUp.confirmBody(email.trim())}</Text>
          <Link href="/sign-in" asChild>
            <Pressable hitSlop={8}>
              <Text style={styles.link}>{fr.auth.signUp.backToSignIn}</Text>
            </Pressable>
          </Link>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <Pressable onPress={() => router.back()} hitSlop={8} style={styles.nav}>
        <Text style={styles.back}>‹</Text>
      </Pressable>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.content}>
          <Text style={styles.title}>{fr.auth.signUp.title}</Text>
          <Text style={styles.subtitle}>{fr.auth.signUp.subtitle}</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.field}>
            <Text style={styles.label}>{fr.auth.email}</Text>
            <TextInput
              style={styles.input}
              placeholderTextColor={color.acier}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={setEmail}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>{fr.auth.password}</Text>
            <TextInput
              style={styles.input}
              placeholderTextColor={color.acier}
              secureTextEntry
              textContentType="newPassword"
              autoCapitalize="none"
              autoCorrect={false}
              value={password}
              onChangeText={setPassword}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>{fr.auth.signUp.confirmPassword}</Text>
            <TextInput
              style={styles.input}
              placeholderTextColor={color.acier}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
          </View>

          <Pressable style={styles.consentRow} onPress={() => setConsentChecked((c) => !c)} hitSlop={4}>
            <View style={[styles.checkbox, consentChecked ? styles.checkboxChecked : null]}>
              {consentChecked ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.consentLabel}>{fr.auth.signUp.consent}</Text>
          </Pressable>

          <Pressable
            style={[styles.cta, (submitting || !email || !password || !confirmPassword || !consentChecked) ? styles.ctaDisabled : null]}
            onPress={handleSignUp}
            disabled={submitting || !email || !password || !confirmPassword || !consentChecked}
          >
            <Text style={styles.ctaLabel}>{submitting ? fr.auth.signUp.ctaLoading : fr.auth.signUp.cta}</Text>
          </Pressable>

          <Link href="/sign-in" asChild>
            <Pressable hitSlop={8}>
              <Text style={styles.link}>{fr.auth.signUp.hasAccount}</Text>
            </Pressable>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  consentRow: { flexDirection: "row", alignItems: "flex-start", gap: space.sm, marginTop: space.sm },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkboxChecked: { backgroundColor: color.vert, borderColor: color.vert },
  checkmark: { color: color.blanc, fontSize: 13, fontWeight: "700", lineHeight: 14 },
  consentLabel: { flex: 1, fontSize: font.caption, color: color.acier, lineHeight: 18 },
  cta: { backgroundColor: color.vert, borderRadius: radius.md, paddingVertical: 16, alignItems: "center", marginTop: space.lg },
  ctaDisabled: { opacity: 0.5 },
  ctaLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  link: { fontSize: font.secondary, color: color.acier, fontWeight: "600", textAlign: "center", marginTop: space.lg },
});
