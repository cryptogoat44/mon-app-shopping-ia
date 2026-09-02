import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import { FormError, FormField, PrimaryButton } from "@/components/form";
import { supabase } from "@/lib/supabase";
import { theme } from "@/lib/theme";

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSignIn() {
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSubmitting(false);

    if (signInError) {
      setError(
        signInError.message === "Invalid login credentials"
          ? "Email ou mot de passe incorrect."
          : signInError.message
      );
    }
    // Si succès : onAuthStateChange met à jour la session, le layout racine redirige automatiquement.
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Bon retour</Text>
        <Text style={styles.subtitle}>Connectez-vous pour retrouver votre vault.</Text>

        <FormError message={error} />

        <FormField
          label="Email"
          keyboardType="email-address"
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
        />
        <FormField
          label="Mot de passe"
          secureTextEntry
          textContentType="password"
          value={password}
          onChangeText={setPassword}
        />

        <PrimaryButton label={submitting ? "Connexion…" : "Se connecter"} onPress={handleSignIn} disabled={submitting || !email || !password} />

        <Link href="/sign-up" asChild>
          <Text style={styles.link}>Pas encore de compte ? Créez-en un</Text>
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.ground },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: theme.space.lg },
  title: { fontSize: theme.font.display, fontWeight: "700", color: theme.color.ink, marginBottom: theme.space.xs },
  subtitle: { fontSize: theme.font.body, color: theme.color.muted, marginBottom: theme.space.lg },
  link: { color: theme.color.accentInk, fontSize: theme.font.small, textAlign: "center", marginTop: theme.space.lg },
});
