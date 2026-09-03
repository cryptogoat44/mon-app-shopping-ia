import { useState } from "react";
import { Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import type { PrivacyLevel } from "@monapp/shared-types";
import { ChipSelector, FormError, FormField, PrimaryButton } from "@/components/form";
import { useAuth } from "@/lib/auth-context";
import { ApiError, createLifestylePost } from "@/lib/api";
import { PRIVACY_LABELS, PRIVACY_LEVELS } from "@/lib/vault-labels";
import { theme } from "@/lib/theme";

export default function NewPostScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [caption, setCaption] = useState("");
  const [privacy, setPrivacy] = useState<PrivacyLevel>(profile?.defaultPrivacy ?? "followers");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handlePickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Autorisez l'accès à vos photos pour publier.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    setImageUri(result.assets[0].uri);
  }

  async function handleSubmit() {
    setError(null);
    if (!imageUri) {
      setError("Ajoutez une photo.");
      return;
    }

    setSubmitting(true);
    try {
      await createLifestylePost({ caption: caption.trim(), imageUri, privacy });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "La publication a échoué, réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <Text style={styles.backLabel}>← Annuler</Text>
        </Pressable>

        <Text style={styles.title}>Nouvelle publication</Text>

        <FormError message={error} />

        <Pressable style={styles.photoPicker} onPress={handlePickPhoto}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.photoPreview} />
          ) : (
            <Text style={styles.photoPickerLabel}>Choisir une photo</Text>
          )}
        </Pressable>

        <FormField
          label="Légende (facultatif)"
          placeholder="Racontez le contexte…"
          value={caption}
          onChangeText={setCaption}
          autoCapitalize="sentences"
          multiline
          maxLength={280}
        />

        <ChipSelector
          label="Qui peut voir cette publication"
          value={privacy}
          options={PRIVACY_LEVELS}
          labels={PRIVACY_LABELS}
          onChange={setPrivacy}
        />

        <PrimaryButton label={submitting ? "Publication…" : "Publier"} onPress={handleSubmit} disabled={submitting} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.ground },
  content: { padding: theme.space.lg, paddingBottom: theme.space.xl, maxWidth: 480, alignSelf: "center", width: "100%" },
  back: { marginBottom: theme.space.lg },
  backLabel: { color: theme.color.accentInk, fontSize: theme.font.small },
  title: { fontSize: theme.font.title, fontWeight: "700", color: theme.color.ink, marginBottom: theme.space.lg },
  photoPicker: {
    width: "100%",
    maxWidth: 320,
    aspectRatio: 1,
    alignSelf: "center",
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.line,
    backgroundColor: theme.color.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.space.md,
    overflow: "hidden",
  },
  photoPickerLabel: { color: theme.color.accentInk, fontSize: theme.font.body },
  photoPreview: { width: "100%", height: "100%" },
});
