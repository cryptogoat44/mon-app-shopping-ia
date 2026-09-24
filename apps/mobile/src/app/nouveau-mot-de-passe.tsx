import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import { translateAuthError } from "@/lib/auth-errors";
import { INITIAL_WEB_URL } from "@/lib/initial-url";
import { newPasswordProblem, parseRecoveryUrl } from "@/lib/password-recovery";
import { useToast } from "@/lib/toast-context";
import { fr } from "@/i18n/fr";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { ErrorMessage } from "@/components/error-message";

type Phase = "checking" | "ready" | "expired" | "invalid";

// Ouvert depuis le lien de l'e-mail « Mot de passe oublié ». Accessible
// avec ou sans session (hors des groupes protégés du layout racine) : le
// lien ouvre justement une session de réinitialisation.
export default function NewPasswordScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  const nativeUrl = Linking.useURL();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const url = Platform.OS === "web" ? INITIAL_WEB_URL : nativeUrl;

  useEffect(() => {
    if (phase !== "checking") return;
    if (Platform.OS !== "web" && nativeUrl === null) return; // lien pas encore reçu
    const link = parseRecoveryUrl(url);

    // Les jetons ne doivent pas rester dans l'adresse (historique, partage).
    if (Platform.OS === "web" && typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    if (link.kind === "error") {
      setPhase("expired");
      return;
    }
    if (link.kind === "none") {
      setPhase("invalid");
      return;
    }
    supabase.auth
      .setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
      .then(({ error: sessionError }) => setPhase(sessionError ? "expired" : "ready"))
      .catch(() => setPhase("expired"));
  }, [phase, url, nativeUrl]);

  async function handleSave() {
    const problem = newPasswordProblem(password, confirmation);
    if (problem) {
      setError(problem === "too_short" ? fr.auth.reset.tooShort : fr.auth.reset.mismatch);
      return;
    }
    setError(null);
    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError(translateAuthError(updateError.message));
      return;
    }
    showToast(fr.auth.reset.done);
    router.replace("/");
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.content}>
          {phase === "checking" ? (
            <View style={styles.centered} accessibilityLabel={fr.auth.reset.checking}>
              <ActivityIndicator color={color.encre} />
            </View>
          ) : phase === "ready" ? (
            <>
              <Text style={styles.title} accessibilityRole="header">{fr.auth.reset.title}</Text>
              <Text style={styles.subtitle}>{fr.auth.reset.subtitle}</Text>
              {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}
              <View style={styles.field}>
                <Text style={styles.label}>{fr.auth.reset.password}</Text>
                <TextInput
                  style={styles.input}
                  secureTextEntry
                  textContentType="newPassword"
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={password}
                  onChangeText={setPassword}
                  accessibilityLabel={fr.auth.reset.password}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>{fr.auth.reset.confirm}</Text>
                <TextInput
                  style={styles.input}
                  secureTextEntry
                  textContentType="newPassword"
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={confirmation}
                  onChangeText={setConfirmation}
                  onSubmitEditing={handleSave}
                  accessibilityLabel={fr.auth.reset.confirm}
                />
              </View>
              <Pressable
                style={[styles.cta, submitting || !password || !confirmation ? styles.ctaDisabled : null]}
                onPress={handleSave}
                disabled={submitting || !password || !confirmation}
                accessibilityRole="button"
              >
                <Text style={styles.ctaLabel}>{submitting ? fr.auth.reset.ctaLoading : fr.auth.reset.cta}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.title} accessibilityRole="header">
                {phase === "expired" ? fr.auth.reset.expiredTitle : fr.auth.reset.invalidTitle}
              </Text>
              <Text style={styles.subtitle}>{phase === "expired" ? fr.auth.reset.expiredBody : fr.auth.reset.invalidBody}</Text>
              <Pressable style={styles.cta} onPress={() => router.replace("/mot-de-passe-oublie")} accessibilityRole="button">
                <Text style={styles.ctaLabel}>{fr.auth.reset.newLink}</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  flex: { flex: 1 },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, maxWidth: 480, alignSelf: "center", width: "100%" },
  centered: { alignItems: "center" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, color: color.encre },
  subtitle: { fontSize: font.secondary, color: color.acier, marginTop: space.xs, marginBottom: space.xl, lineHeight: 20 },
  error: { fontSize: font.caption, marginBottom: space.md },
  field: { marginBottom: space.md },
  label: { fontSize: font.caption, color: color.acier, marginBottom: space.xs },
  input: { borderBottomWidth: 1, borderBottomColor: color.filet, paddingVertical: 10, fontSize: font.body, color: color.encre },
  cta: { backgroundColor: color.vert, borderRadius: radius.md, paddingVertical: 16, alignItems: "center", marginTop: space.lg },
  ctaDisabled: { opacity: 0.5 },
  ctaLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
});
