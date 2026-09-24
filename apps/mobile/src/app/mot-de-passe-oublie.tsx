import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import { translateAuthError } from "@/lib/auth-errors";
import { RECOVERY_PATH } from "@/lib/password-recovery";
import { fr } from "@/i18n/fr";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { ErrorMessage } from "@/components/error-message";

// Adresse où ramène le lien de l'e-mail : le site (web) ou l'app (iPhone).
// Elle doit figurer dans les « Redirect URLs » autorisées du projet Supabase.
function recoveryRedirectUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return `${window.location.origin}${RECOVERY_PATH}`;
  return Linking.createURL(RECOVERY_PATH);
}

// « Mot de passe oublié » (Lot Q, bloc 3, UX-05). La réponse est toujours
// la même, qu'un compte existe ou non pour l'adresse : on ne révèle jamais
// qui est inscrit.
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSend() {
    const address = email.trim();
    if (!address) return;
    setError(null);
    setSubmitting(true);
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: recoveryRedirectUrl() });
    setSubmitting(false);
    if (sendError) {
      setError(translateAuthError(sendError.message));
      return;
    }
    setSentTo(address);
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/sign-in");
  }

  return (
    <SafeAreaView style={styles.screen}>
      <Pressable onPress={goBack} hitSlop={12} style={styles.nav} accessibilityRole="button" accessibilityLabel="Retour">
        <Text style={styles.back}>‹</Text>
      </Pressable>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.content}>
          {sentTo ? (
            <>
              <Text style={styles.title} accessibilityRole="header">{fr.auth.forgot.sentTitle}</Text>
              <Text style={styles.subtitle} accessibilityLiveRegion="polite">{fr.auth.forgot.sentBody(sentTo)}</Text>
              <Pressable style={styles.cta} onPress={() => router.replace("/sign-in")} accessibilityRole="button">
                <Text style={styles.ctaLabel}>{fr.auth.forgot.back}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.title} accessibilityRole="header">{fr.auth.forgot.title}</Text>
              <Text style={styles.subtitle}>{fr.auth.forgot.subtitle}</Text>
              {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}
              <View style={styles.field}>
                <Text style={styles.label}>{fr.auth.email}</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={email}
                  onChangeText={setEmail}
                  onSubmitEditing={handleSend}
                  returnKeyType="send"
                  accessibilityLabel={fr.auth.email}
                />
              </View>
              <Pressable
                style={[styles.cta, submitting || !email.trim() ? styles.ctaDisabled : null]}
                onPress={handleSend}
                disabled={submitting || !email.trim()}
                accessibilityRole="button"
              >
                <Text style={styles.ctaLabel}>{submitting ? fr.auth.forgot.ctaLoading : fr.auth.forgot.cta}</Text>
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
  nav: { height: 47, justifyContent: "center", paddingHorizontal: 12 },
  back: { fontSize: 26, color: color.encre },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, maxWidth: 480, alignSelf: "center", width: "100%" },
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
