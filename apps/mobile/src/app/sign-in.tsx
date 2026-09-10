import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { translateAuthError } from "@/lib/auth-errors";
import { supabase } from "@/lib/supabase";
import { fr } from "@/i18n/fr";
import { color, font, radius, serifFont, space } from "@/theme/tokens";

export default function SignInScreen() {
  const router = useRouter();
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
      setError(translateAuthError(signInError.message));
    }
    // Si succès : onAuthStateChange met à jour la session, le layout racine redirige automatiquement.
  }

  return (
    <SafeAreaView style={styles.screen}>
      <Pressable onPress={() => router.back()} hitSlop={8} style={styles.nav}>
        <Text style={styles.back}>‹</Text>
      </Pressable>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.content}>
          <Text style={styles.title}>{fr.auth.signIn.title}</Text>
          <Text style={styles.subtitle}>{fr.auth.signIn.subtitle}</Text>

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
              textContentType="password"
              autoCapitalize="none"
              autoCorrect={false}
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <Pressable
            style={[styles.cta, (submitting || !email || !password) ? styles.ctaDisabled : null]}
            onPress={handleSignIn}
            disabled={submitting || !email || !password}
          >
            <Text style={styles.ctaLabel}>{submitting ? fr.auth.signIn.ctaLoading : fr.auth.signIn.cta}</Text>
          </Pressable>

          <Link href="/sign-up" asChild>
            <Pressable hitSlop={8}>
              <Text style={styles.link}>{fr.auth.signIn.noAccount}</Text>
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
  cta: { backgroundColor: color.vert, borderRadius: radius.md, paddingVertical: 16, alignItems: "center", marginTop: space.lg },
  ctaDisabled: { opacity: 0.5 },
  ctaLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  link: { fontSize: font.secondary, color: color.acier, fontWeight: "600", textAlign: "center", marginTop: space.lg },
});
