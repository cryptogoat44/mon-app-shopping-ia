import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { FormError, FormField, PrimaryButton } from "@/components/form";
import { useAuth } from "@/lib/auth-context";
import { createSearch, ApiError } from "@/lib/api";
import { theme } from "@/lib/theme";

export default function HomeScreen() {
  const { profile, signOut } = useAuth();
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleAnalyze() {
    setError(null);
    setSubmitting(true);
    try {
      const search = await createSearch({ sourceUrl: url.trim() });
      setUrl("");
      router.push({ pathname: "/search/[id]", params: { id: search.id } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Une erreur est survenue, réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Bonjour {profile?.displayName ?? ""}</Text>
            <Text style={styles.title}>Identifier un produit</Text>
          </View>
          <Pressable onPress={signOut} hitSlop={8}>
            <Text style={styles.logout}>Se déconnecter</Text>
          </Pressable>
        </View>

        <View style={styles.content}>
          <Text style={styles.subtitle}>
            Collez le lien d'une vidéo TikTok ou Instagram — on identifie les produits qui y apparaissent.
          </Text>

          <FormError message={error} />

          <FormField
            label="Lien de la vidéo"
            placeholder="https://www.tiktok.com/@..."
            autoCapitalize="none"
            keyboardType="url"
            value={url}
            onChangeText={setUrl}
          />

          <PrimaryButton
            label={submitting ? "Analyse…" : "Analyser"}
            onPress={handleAnalyze}
            disabled={submitting || !url.trim()}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.ground },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.md,
  },
  eyebrow: { fontSize: theme.font.small, color: theme.color.accentInk, letterSpacing: 0.3, marginBottom: theme.space.xs },
  title: { fontSize: theme.font.title, fontWeight: "700", color: theme.color.ink },
  logout: { fontSize: theme.font.small, color: theme.color.muted },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: theme.space.lg,
    maxWidth: 480,
    alignSelf: "center",
    width: "100%",
  },
  subtitle: { fontSize: theme.font.body, color: theme.color.muted, marginBottom: theme.space.lg },
});
