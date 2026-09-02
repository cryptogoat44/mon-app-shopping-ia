import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import { FormError, FormField, PrimaryButton } from "@/components/form";
import { supabase } from "@/lib/supabase";
import { theme } from "@/lib/theme";

export default function SignUpScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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

    setSubmitting(true);
    const { data, error: signUpError } = await supabase.auth.signUp({ email: email.trim(), password });
    setSubmitting(false);

    if (signUpError) {
      setError(signUpError.message);
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
      <View style={styles.screen}>
        <View style={styles.content}>
          <Text style={styles.title}>Vérifiez votre boîte mail</Text>
          <Text style={styles.subtitle}>
            Nous avons envoyé un lien de confirmation à {email.trim()}. Cliquez dessus pour activer votre compte, puis
            revenez vous connecter.
          </Text>
          <Link href="/sign-in" asChild>
            <Text style={styles.link}>Retour à la connexion</Text>
          </Link>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.content}>
        <Text style={styles.title}>Créer un compte</Text>
        <Text style={styles.subtitle}>Votre vault personnel vous attend.</Text>

        <FormError message={error} />

        <FormField label="Email" keyboardType="email-address" textContentType="emailAddress" value={email} onChangeText={setEmail} />
        <FormField label="Mot de passe" secureTextEntry textContentType="newPassword" value={password} onChangeText={setPassword} />
        <FormField label="Confirmez le mot de passe" secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} />

        <PrimaryButton
          label={submitting ? "Création…" : "Créer mon compte"}
          onPress={handleSignUp}
          disabled={submitting || !email || !password || !confirmPassword}
        />

        <Link href="/sign-in" asChild>
          <Text style={styles.link}>Déjà un compte ? Connectez-vous</Text>
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
