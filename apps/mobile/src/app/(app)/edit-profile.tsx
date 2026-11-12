import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { BIO_MAX_LENGTH, BIO_MAX_LINES, normalizeBio } from "@monapp/shared-types";
import { useAuth } from "@/lib/auth-context";
import { ApiError, updateMyProfile } from "@/lib/api";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { useToast } from "@/lib/toast-context";
import { ErrorMessage } from "@/components/error-message";
import { Avatar } from "@/components/avatar";
import { AvatarPhotoFlow } from "@/components/avatar-photo-flow";
import { bioCounter, bioError, nextBioInput } from "@/lib/bio-input";
import { themedStyles } from "@/theme/themed-styles";

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
  // Lot « profil et icône des réglages » : photo de profil et bio limitée.
  const [photoOpen, setPhotoOpen] = useState(false);
  const counter = bioCounter(bio);
  const bioIssue = bioError(bio);

  function safeBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/profile");
  }

  async function handleSubmit() {
    setError(null);

    const normalizedUsername = username.trim().toLowerCase();
    if (!USERNAME_REGEX.test(normalizedUsername)) {
      setError(t.editProfile.usernameError);
      return;
    }
    if (!displayName.trim()) {
      setError(t.editProfile.displayNameError);
      return;
    }
    if (bioIssue) {
      setError(bioIssue);
      return;
    }

    setSubmitting(true);
    try {
      await updateMyProfile({
        username: normalizedUsername,
        displayName: displayName.trim(),
        bio: normalizeBio(bio),
      });
      await refreshProfile();
      showToast(t.editProfile.saved);
      safeBack();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(t.editProfile.usernameTaken);
      } else {
        setError(e instanceof ApiError ? e.message : t.editProfile.saveError);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={safeBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={t.common.back}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
      </View>
      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Text style={styles.title} accessibilityRole="header">{t.editProfile.title}</Text>

          {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}

          <View style={styles.photoRow}>
            <Pressable onPress={() => setPhotoOpen(true)} accessibilityRole="button" accessibilityLabel={t.profile.changeAvatar}>
              <Avatar uri={profile?.avatarUrl} userId={profile?.id ?? ""} displayName={displayName || profile?.displayName} username={username} size={72} />
            </Pressable>
            <Pressable onPress={() => setPhotoOpen(true)} hitSlop={8} accessibilityRole="button" style={styles.photoLink}>
              <Text style={styles.photoLinkLabel}>{profile?.avatarUrl ? t.editProfile.changePhoto : t.editProfile.addPhoto}</Text>
            </Pressable>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t.editProfile.username}</Text>
            <TextInput
              style={styles.input}
              placeholderTextColor={color.acier}
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={setUsername}
              maxLength={20}
              accessibilityLabel={t.editProfile.username}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>{t.editProfile.displayName}</Text>
            <TextInput
              style={styles.input}
              placeholderTextColor={color.acier}
              autoCapitalize="words"
              value={displayName}
              onChangeText={setDisplayName}
              maxLength={60}
              accessibilityLabel={t.editProfile.displayName}
            />
          </View>
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>{t.editProfile.bio}</Text>
              <Text style={[styles.counter, counter.over ? styles.counterOver : null]} accessibilityLabel={counter.label} accessibilityLiveRegion="polite" testID="compteur-bio">
                {counter.text}
              </Text>
            </View>
            <TextInput
              style={[styles.input, styles.bioInput]}
              placeholderTextColor={color.acier}
              placeholder={t.editProfile.bioPlaceholder}
              value={bio}
              onChangeText={(typed) => setBio((previous) => nextBioInput(previous, typed))}
              maxLength={Math.max(BIO_MAX_LENGTH, bio.length)}
              multiline
              numberOfLines={4}
              accessibilityLabel={t.editProfile.bio}
              accessibilityHint={t.editProfile.bioHint(BIO_MAX_LENGTH, BIO_MAX_LINES)}
            />
            {bioIssue ? <ErrorMessage style={styles.fieldError}>{bioIssue}</ErrorMessage> : <Text style={styles.hint}>{t.editProfile.bioHint(BIO_MAX_LENGTH, BIO_MAX_LINES)}</Text>}
          </View>

          <Pressable
            style={[styles.cta, submitting || !username || !displayName || bioIssue ? styles.ctaDisabled : null]}
            onPress={handleSubmit}
            disabled={submitting || !username || !displayName || bioIssue !== null}
            accessibilityRole="button"
            accessibilityLabel={t.editProfile.save}
          >
            <Text style={[styles.ctaLabel, submitting || !username || !displayName || bioIssue ? styles.ctaLabelDisabled : null]}>
              {submitting ? t.editProfile.saving : t.editProfile.save}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
      <AvatarPhotoFlow open={photoOpen} onClose={() => setPhotoOpen(false)} />
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
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
  // Trois lignes de bio, dont une longue qui passe à la ligne : toutes visibles.
  bioInput: { minHeight: 112, textAlignVertical: "top" },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  counter: { fontSize: font.caption, color: color.acier, fontVariant: ["tabular-nums"] },
  counterOver: { color: color.erreur, fontWeight: "600" },
  hint: { fontSize: font.caption, color: color.acier, marginTop: space.xs },
  fieldError: { fontSize: font.caption, marginTop: space.xs },
  photoRow: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.lg },
  photoLink: { minHeight: 44, justifyContent: "center" },
  photoLinkLabel: { fontSize: font.body, color: color.vert, fontWeight: "600" },
  cta: { backgroundColor: color.vert, borderRadius: radius.md, paddingVertical: 16, alignItems: "center", marginTop: space.lg },
  ctaDisabled: { backgroundColor: color.inactif, borderColor: color.inactif },
  ctaLabelDisabled: { color: color.surInactif },
  ctaLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
}));
