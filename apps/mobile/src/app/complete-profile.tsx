import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { FormError, FormField, PrimaryButton } from "@/components/form";
import { useAuth } from "@/lib/auth-context";
import { ApiError, recordConsents, updateMyProfile } from "@/lib/api";
import { theme } from "@/lib/theme";

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
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.content}>
        <Text style={styles.title}>Dernière étape</Text>
        <Text style={styles.subtitle}>Choisissez comment on vous reconnaît sur l'app.</Text>

        <FormError message={error} />

        <FormField label="Nom d'utilisateur" placeholder="ex. camille_l" value={username} onChangeText={setUsername} maxLength={20} />
        <FormField
          label="Nom affiché"
          placeholder="ex. Camille L."
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="words"
          maxLength={60}
        />

        <PrimaryButton
          label={submitting ? "Enregistrement…" : "Continuer"}
          onPress={handleSubmit}
          disabled={submitting || !username || !displayName}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.ground },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: theme.space.lg },
  title: { fontSize: theme.font.display, fontWeight: "700", color: theme.color.ink, marginBottom: theme.space.xs },
  subtitle: { fontSize: theme.font.body, color: theme.color.muted, marginBottom: theme.space.lg },
});
