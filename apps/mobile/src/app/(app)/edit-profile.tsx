import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { ApiError, updateMyProfile } from "@/lib/api";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { useToast } from "@/lib/toast-context";
import { ErrorMessage } from "@/components/error-message";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

export default function EditProfileScreen() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();
  const { showToast } = useToast();

  const [username, setUsername] = useState(profile?.username ?? "");
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function safeBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/profile");
  }

  async function handleSubmit() {
    setError(null);

    const normalizedUsername = username.trim().toLowerCase();
    if (!USERNAME_REGEX.test(normalizedUsername)) {
      setError(fr.editProfile.usernameError);
      return;
    }
    if (!displayName.trim()) {
      setError(fr.editProfile.displayNameError);
      return;
    }

    setSubmitting(true);
    try {
      await updateMyProfile({
        username: normalizedUsername,
        displayName: displayName.trim(),
        bio: bio.trim() || undefined,
      });
      await refreshProfile();
      showToast(fr.editProfile.saved);
      safeBack();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(fr.editProfile.usernameTaken);
      } else {
        setError(e instanceof ApiError ? e.message : fr.editProfile.saveError);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={safeBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Retour">
          <Text style={styles.back}>‹</Text>
        </Pressable>
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title} accessibilityRole="header">{fr.editProfile.title}</Text>

          {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}

          <View style={styles.field}>
            <Text style={styles.label}>{fr.editProfile.username}</Text>
            <TextInput
              style={styles.input}
              placeholderTextColor={color.acier}
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={setUsername}
              maxLength={20}
              accessibilityLabel={fr.editProfile.username}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>{fr.editProfile.displayName}</Text>
            <TextInput
              style={styles.input}
              placeholderTextColor={color.acier}
              autoCapitalize="words"
              value={displayName}
              onChangeText={setDisplayName}
              maxLength={60}
              accessibilityLabel={fr.editProfile.displayName}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>{fr.editProfile.bio}</Text>
            <TextInput
              style={[styles.input, styles.bioInput]}
              placeholderTextColor={color.acier}
              placeholder={fr.editProfile.bioPlaceholder}
              value={bio}
              onChangeText={setBio}
              maxLength={280}
              multiline
              accessibilityLabel={fr.editProfile.bio}
            />
          </View>

          <Pressable
            style={[styles.cta, submitting || !username || !displayName ? styles.ctaDisabled : null]}
            onPress={handleSubmit}
            disabled={submitting || !username || !displayName}
            accessibilityRole="button"
            accessibilityLabel={fr.editProfile.save}
          >
            <Text style={styles.ctaLabel}>{submitting ? fr.editProfile.saving : fr.editProfile.save}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  flex: { flex: 1 },
  nav: { height: 47, justifyContent: "center", paddingHorizontal: 12 },
  back: { fontSize: 26, color: color.encre },
  content: { paddingHorizontal: space.xl, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, marginBottom: space.lg },
  error: { fontSize: font.caption, color: color.danger, marginBottom: space.md },
  field: { marginBottom: space.md },
  label: { fontSize: font.caption, color: color.acier, marginBottom: space.xs },
  input: { borderBottomWidth: 1, borderBottomColor: color.filet, paddingVertical: 10, fontSize: font.body, color: color.encre },
  bioInput: { minHeight: 70, textAlignVertical: "top" },
  cta: { backgroundColor: color.vert, borderRadius: radius.md, paddingVertical: 16, alignItems: "center", marginTop: space.lg },
  ctaDisabled: { opacity: 0.5 },
  ctaLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
});
