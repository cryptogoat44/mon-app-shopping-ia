import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { ApiError, acceptConsents, updateMyProfile } from "@/lib/api";
import { forgetSignupConsents, hasSignupConsents } from "@/lib/signup-consents";
import { fr } from "@/i18n/fr";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { ErrorMessage } from "@/components/error-message";
import { CHECKBOX_SIZE, CheckboxRow } from "@/components/checkbox-row";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

export default function CompleteProfileScreen() {
  const { session, profile, refreshProfile } = useAuth();
  // Cases déjà cochées à l'inscription, dans cette session : on ne les
  // redemande pas. Sinon (compte créé ailleurs, autre appareil, page
  // rechargée…), elles sont affichées et obligatoires.
  const [needsConsents] = useState(() => !hasSignupConsents(session?.user.email));
  const [ageChecked, setAgeChecked] = useState(false);
  const [documentsChecked, setDocumentsChecked] = useState(false);
  const consentsMissing = needsConsents && (!ageChecked || !documentsChecked);
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
    if (needsConsents && !ageChecked) {
      setError(fr.auth.signUp.ageRequired);
      return;
    }
    if (needsConsents && !documentsChecked) {
      setError(fr.auth.signUp.consentRequired);
      return;
    }

    setSubmitting(true);
    try {
      // Consentements (cases de l'inscription dans cette session, ou cases
      // de cet écran) enregistrés ici, premier moment où une session existe,
      // AVANT d'ouvrir l'app : sans preuve enregistrée (avec la version
      // acceptée), pas d'accès (audit Lot Q, PRO-04).
      await acceptConsents(["terms", "privacy_policy", "age_declaration"]);
      forgetSignupConsents();
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
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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

          {needsConsents ? (
            <View style={styles.consents}>
              <CheckboxRow label={fr.auth.signUp.ageDeclaration} checked={ageChecked} onToggle={() => setAgeChecked((c) => !c)} />
              <CheckboxRow
                style={styles.consentRow}
                label={fr.auth.signUp.consent}
                checked={documentsChecked}
                onToggle={() => setDocumentsChecked((c) => !c)}
              />
              <View style={styles.legalLinks}>
                <Link href="/conditions" asChild>
                  <Pressable accessibilityRole="link" hitSlop={12}>
                    <Text style={styles.legalLink}>{fr.legal.readTerms}</Text>
                  </Pressable>
                </Link>
                <Link href="/confidentialite" asChild>
                  <Pressable accessibilityRole="link" hitSlop={12}>
                    <Text style={styles.legalLink}>{fr.legal.readPrivacy}</Text>
                  </Pressable>
                </Link>
              </View>
            </View>
          ) : null}

          <Pressable accessibilityRole="button"
            style={[styles.cta, (submitting || !username || !displayName || consentsMissing) ? styles.ctaDisabled : null]}
            onPress={handleSubmit}
            disabled={submitting || !username || !displayName || consentsMissing}
          >
            <Text style={styles.ctaLabel}>{submitting ? "Enregistrement…" : "Continuer"}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center", paddingVertical: space.lg, paddingHorizontal: space.xl, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, color: color.encre },
  subtitle: { fontSize: font.secondary, color: color.acier, marginTop: space.xs, marginBottom: space.xl, lineHeight: 20 },
  error: { fontSize: font.caption, color: color.acier, marginBottom: space.md },
  field: { marginBottom: space.md },
  label: { fontSize: font.caption, color: color.acier, marginBottom: space.xs },
  consents: { marginTop: space.sm },
  consentRow: { marginTop: space.sm },
  legalLinks: { marginLeft: CHECKBOX_SIZE + space.sm, marginTop: space.xs, gap: space.sm },
  legalLink: { fontSize: font.caption, color: color.vert, fontWeight: "600", minHeight: 20 },
  input: { borderBottomWidth: 1, borderBottomColor: color.filet, paddingVertical: 10, fontSize: font.body, color: color.encre },
  cta: { backgroundColor: color.vert, borderRadius: radius.md, paddingVertical: 16, alignItems: "center", marginTop: space.lg },
  ctaDisabled: { opacity: 0.5 },
  ctaLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
});
