import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { ApiError, acceptConsents, updateMyProfile } from "@/lib/api";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { ErrorMessage } from "@/components/error-message";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

export default function CompleteProfileScreen() {
  const { profile, refreshProfile } = useAuth();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);

    const normalizedUsername = username.trim().toLowerCase();
    if (!USERNAME_REGEX.test(normalizedUsername)) {
      setError("Le nom d'utilisateur doit faire 3 à 20 caractères : lettres minuscules, chiffres, underscore.");
      return;
    }
    if (!displayName.trim()) {
      setError("Le nom affiché est obligatoire.");
      return;
    }

    setSubmitting(true);
    try {
      // Les consentements ont été donnés à l'inscription (cases à cocher
      // obligatoires : documents et « au moins 15 ans ») ; ils sont
      // enregistrés ici, premier moment où une session existe, AVANT
      // d'ouvrir l'app : sans preuve enregistrée (avec la version acceptée),
      // pas d'accès (audit Lot Q, PRO-04).
      await acceptConsents(["terms", "privacy_policy", "age_declaration"]);
      await updateMyProfile({ username: normalizedUsername, displayName: displayName.trim() });
      await refreshProfile();
      // Le layout racine redirige automatiquement vers (app) une fois le profil complet.
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError("Ce nom d'utilisateur est déjà pris.");
      } else {
        setError("Une erreur est survenue, réessayez.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.content}>
          <Text style={styles.title} accessibilityRole="header">Dernière étape</Text>
          <Text style={styles.subtitle}>Choisissez comment on vous reconnaît sur l'app.</Text>

          {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}

          <View style={styles.field}>
            <Text style={styles.label}>Nom d'utilisateur</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={setUsername}
              maxLength={20}
              accessibilityLabel="Nom d'utilisateur"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Nom affiché</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="words"
              value={displayName}
              onChangeText={setDisplayName}
              maxLength={60}
              accessibilityLabel="Nom affiché"
            />
          </View>

          <Pressable accessibilityRole="button"
            style={[styles.cta, (submitting || !username || !displayName) ? styles.ctaDisabled : null]}
            onPress={handleSubmit}
            disabled={submitting || !username || !displayName}
          >
            <Text style={styles.ctaLabel}>{submitting ? "Enregistrement…" : "Continuer"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  flex: { flex: 1 },
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
});
