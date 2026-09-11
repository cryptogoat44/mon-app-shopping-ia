import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { ApiError, recordConsents, updateMyProfile } from "@/lib/api";
import { color, font, radius, serifFont, space } from "@/theme/tokens";

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
      await updateMyProfile({ username: normalizedUsername, displayName: displayName.trim() });
      // Le consentement a déjà été donné explicitement à l'écran d'inscription
      // (case à cocher obligatoire) — on l'enregistre ici côté serveur, au
      // premier moment où une session authentifiée existe. Best-effort : un
      // échec réseau ici ne doit pas bloquer l'accès à l'app.
      recordConsents(["terms", "privacy_policy"]).catch(() => {});
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
          <Text style={styles.title}>Dernière étape</Text>
          <Text style={styles.subtitle}>Choisissez comment on vous reconnaît sur l'app.</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.field}>
            <Text style={styles.label}>Nom d'utilisateur</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={setUsername}
              maxLength={20}
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
            />
          </View>

          <Pressable
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
