import { useCallback, useState } from "react";
import { Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import type { ConsentStatus } from "@monapp/shared-types";
import { FormError, PrimaryButton } from "@/components/form";
import { useAuth } from "@/lib/auth-context";
import { ApiError, deleteMyAccount, exportMyData, fetchConsentStatus } from "@/lib/api";
import { theme } from "@/lib/theme";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

async function shareExportedData(data: unknown) {
  const json = JSON.stringify(data, null, 2);

  if (Platform.OS === "web") {
    // Sur le web, expo-sharing n'est pas disponible : on déclenche un
    // téléchargement classique via le navigateur.
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

export default function AccountScreen() {
  const { profile, signOut } = useAuth();
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

  const termsGrantedAt = consents?.find((c) => c.type === "terms")?.grantedAt ?? null;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Compte</Text>

        <FormError message={error} />

        <View style={styles.card}>
          <Text style={styles.displayName}>{profile?.displayName}</Text>
          <Text style={styles.username}>@{profile?.username}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Vos données</Text>
          <Text style={styles.sectionBody}>
            {termsGrantedAt
              ? `Conditions d'Utilisation acceptées le ${formatDate(termsGrantedAt)}.`
              : consentsFailed
                ? "Statut du consentement indisponible pour le moment."
                : "Statut du consentement en cours de chargement…"}
          </Text>
          <Pressable onPress={handleExport} disabled={exporting} hitSlop={4}>
            <Text style={styles.link}>{exporting ? "Préparation de l'export…" : "Exporter mes données"}</Text>
          </Pressable>
        </View>

        <Pressable onPress={signOut} hitSlop={4} style={styles.section}>
          <Text style={styles.link}>Se déconnecter</Text>
        </Pressable>

        <View style={styles.dangerSection}>
          <Text style={styles.sectionTitle}>Zone sensible</Text>
          {!confirmingDelete ? (
            <Pressable onPress={() => setConfirmingDelete(true)} hitSlop={4}>
              <Text style={styles.deleteLabel}>Supprimer mon compte</Text>
            </Pressable>
          ) : (
            <View>
              <Text style={styles.sectionBody}>
                Cette action est définitive : votre profil, votre vault, vos publications et toutes vos données
                seront supprimés sans possibilité de récupération.
              </Text>
              <View style={styles.confirmButtons}>
                <Pressable onPress={() => setConfirmingDelete(false)} disabled={deleting} hitSlop={8}>
                  <Text style={styles.cancelLabel}>Annuler</Text>
                </Pressable>
                <Pressable onPress={handleDelete} disabled={deleting} hitSlop={8}>
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
  screen: { flex: 1, backgroundColor: theme.color.ground },
  content: { padding: theme.space.lg, paddingTop: theme.space.md, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontSize: theme.font.title, fontWeight: "700", color: theme.color.ink, marginBottom: theme.space.lg },
  card: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.line,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    marginBottom: theme.space.lg,
  },
  displayName: { fontSize: theme.font.body, fontWeight: "700", color: theme.color.ink },
  username: { fontSize: theme.font.small, color: theme.color.muted },
  section: { marginBottom: theme.space.lg },
  sectionTitle: {
    fontSize: theme.font.small,
    fontWeight: "600",
    color: theme.color.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: theme.space.sm,
  },
  sectionBody: { fontSize: theme.font.small, color: theme.color.muted, marginBottom: theme.space.sm, lineHeight: 18 },
  link: { fontSize: theme.font.small, color: theme.color.accentInk, fontWeight: "600" },
  dangerSection: {
    borderTopWidth: 1,
    borderTopColor: theme.color.line,
    paddingTop: theme.space.lg,
  },
  deleteLabel: { color: theme.color.danger, fontSize: theme.font.small, fontWeight: "600" },
  confirmButtons: { flexDirection: "row", gap: theme.space.lg, marginTop: theme.space.xs },
  cancelLabel: { color: theme.color.muted, fontSize: theme.font.small, fontWeight: "600" },
});
