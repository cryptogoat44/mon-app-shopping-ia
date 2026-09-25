import { useCallback, useState } from "react";
import { Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { ConsentStatus } from "@monapp/shared-types";
import { color, font, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { useAuth } from "@/lib/auth-context";
import { ApiError, deleteMyAccount, exportMyData, fetchConsentStatus } from "@/lib/api";
import { ErrorMessage } from "@/components/error-message";
import { consentFor, formatLongDate, pendingConsents } from "@/lib/legal";

async function shareExportedData(data: unknown) {
  const json = JSON.stringify(data, null, 2);
  if (Platform.OS === "web") {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mes-donnees-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }
  const [{ File, Paths }, Sharing] = await Promise.all([import("expo-file-system"), import("expo-sharing")]);
  const file = new File(Paths.cache, `mes-donnees-${Date.now()}.json`);
  file.write(json);
  await Sharing.shareAsync(file.uri);
}

export default function SettingsScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [consents, setConsents] = useState<ConsentStatus[] | null>(null);
  const [consentsFailed, setConsentsFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setConsentsFailed(false);
      fetchConsentStatus()
        .then(setConsents)
        .catch(() => setConsentsFailed(true));
    }, [])
  );

  async function handleExport() {
    setError(null);
    setExporting(true);
    try {
      const data = await exportMyData();
      await shareExportedData(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "L'export a échoué, réessayez.");
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      await deleteMyAccount();
      await signOut();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "La suppression a échoué.");
      setDeleting(false);
    }
  }

  function consentLine(type: "terms" | "privacy_policy"): string {
    if (consentsFailed) return fr.settings.consentFailed;
    if (!consents) return fr.settings.consentLoading;
    const consent = consentFor(consents, type);
    return pendingConsents(consents, type).length === 0 && consent?.grantedAt
      ? fr.settings.acceptedOn(formatLongDate(consent.grantedAt))
      : fr.settings.notAccepted;
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/profile"))}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Retour"
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">{fr.settings.title}</Text>

        {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{fr.settings.account}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push("/edit-profile")} hitSlop={12}>
            <Text style={styles.link}>{fr.settings.editProfile}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push("/blocked-users")} hitSlop={12} style={styles.secondLink}>
            <Text style={styles.link}>{fr.blockedUsers.title}</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{fr.settings.documents}</Text>
          <Pressable accessibilityRole="link" onPress={() => router.push("/conditions")} hitSlop={12}>
            <Text style={styles.link}>{fr.settings.terms}</Text>
          </Pressable>
          <Text style={styles.sectionBody}>{consentLine("terms")}</Text>
          <Pressable accessibilityRole="link" onPress={() => router.push("/confidentialite")} hitSlop={12}>
            <Text style={styles.link}>{fr.settings.privacyPolicy}</Text>
          </Pressable>
          <Text style={styles.sectionBody}>{consentLine("privacy_policy")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Vos données</Text>
          <Pressable accessibilityRole="button" onPress={handleExport} disabled={exporting} hitSlop={12}>
            <Text style={styles.link}>{exporting ? "Préparation de l'export…" : fr.settings.exportData}</Text>
          </Pressable>
        </View>

        <Pressable accessibilityRole="button" onPress={signOut} hitSlop={12} style={styles.section}>
          <Text style={styles.link}>{fr.settings.signOut}</Text>
        </Pressable>

        <View style={styles.dangerSection}>
          <Text style={styles.sectionLabel}>Zone sensible</Text>
          {!confirmingDelete ? (
            <Pressable accessibilityRole="button" onPress={() => setConfirmingDelete(true)} hitSlop={12}>
              <Text style={styles.deleteLabel}>{fr.settings.deleteAccount}</Text>
            </Pressable>
          ) : (
            <View>
              <Text style={styles.sectionBody}>{fr.settings.deleteConfirm}</Text>
              <View style={styles.confirmRow}>
                <Pressable accessibilityRole="button" onPress={() => setConfirmingDelete(false)} disabled={deleting} hitSlop={12}>
                  <Text style={styles.cancelLabel}>Annuler</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={handleDelete} disabled={deleting} hitSlop={12}>
                  <Text style={styles.deleteLabel}>{deleting ? "Suppression…" : "Confirmer la suppression"}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, justifyContent: "center", paddingHorizontal: 12 },
  back: { fontSize: 26, color: color.encre },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, marginBottom: space.lg },
  error: { fontSize: font.secondary, color: color.acier, marginBottom: space.md },
  section: { marginBottom: space.lg },
  sectionLabel: { fontSize: font.caption, fontWeight: "600", color: color.acier, marginBottom: space.sm },
  sectionBody: { fontSize: font.secondary, color: color.acier, marginBottom: space.sm, lineHeight: 19 },
  link: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  secondLink: { marginTop: space.sm },
  dangerSection: { borderTopWidth: 1, borderTopColor: color.filet, paddingTop: space.lg },
  deleteLabel: { color: color.danger, fontSize: font.secondary, fontWeight: "600" },
  confirmRow: { flexDirection: "row", gap: space.lg, marginTop: space.xs },
  cancelLabel: { color: color.acier, fontSize: font.secondary, fontWeight: "600" },
});
