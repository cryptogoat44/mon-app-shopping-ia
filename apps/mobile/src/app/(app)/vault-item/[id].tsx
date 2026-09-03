import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { PrivacyLevel, VaultItem } from "@monapp/shared-types";
import { ChipSelector, FormError, PrimaryButton } from "@/components/form";
import { ApiError, deleteVaultItem, fetchVaultItem, sharePurchasePost, updateVaultItem } from "@/lib/api";
import { PRIVACY_LABELS, PRIVACY_LEVELS, VAULT_CATEGORY_LABELS } from "@/lib/vault-labels";
import { theme } from "@/lib/theme";

export default function VaultItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<VaultItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    fetchVaultItem(id)
      .then(setItem)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Impossible de charger cet objet."));
  }, [id]);

  async function handlePrivacyChange(privacy: PrivacyLevel) {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateVaultItem(item.id, { privacy });
      setItem(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "La mise à jour a échoué.");
    } finally {
      setBusy(false);
    }
  }

  async function handleShare() {
    if (!item) return;
    setSharing(true);
    setError(null);
    try {
      await sharePurchasePost(item.id);
      setShared(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Le partage a échoué.");
    } finally {
      setSharing(false);
    }
  }

  async function handleDelete() {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      await deleteVaultItem(item.id);
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "La suppression a échoué.");
      setBusy(false);
    }
  }

  if (!item) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          {error ? <Text style={styles.errorText}>{error}</Text> : <ActivityIndicator color={theme.color.accent} />}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <Text style={styles.backLabel}>← Vault</Text>
        </Pressable>

        <FormError message={error} />

        <Image source={{ uri: item.imageUrl }} style={styles.image} contentFit="cover" />

        <View style={styles.titleRow}>
          <Text style={styles.title}>{item.title}</Text>
          {item.verified ? (
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedBadgeText}>Achat vérifié</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.subtitle}>{VAULT_CATEGORY_LABELS[item.category]}</Text>

        <ChipSelector
          label="Qui peut voir cet objet"
          value={item.privacy}
          options={PRIVACY_LEVELS}
          labels={PRIVACY_LABELS}
          onChange={handlePrivacyChange}
        />

        <PrimaryButton
          label={shared ? "Partagé dans le fil ✓" : sharing ? "Partage…" : "Partager dans mon fil"}
          onPress={handleShare}
          disabled={sharing || shared}
        />

        {!confirmingDelete ? (
          <Pressable onPress={() => setConfirmingDelete(true)} disabled={busy} hitSlop={8}>
            <Text style={styles.deleteLabel}>Retirer du vault</Text>
          </Pressable>
        ) : (
          <View style={styles.confirmRow}>
            <Text style={styles.confirmText}>Retirer définitivement cet objet ?</Text>
            <View style={styles.confirmButtons}>
              <Pressable onPress={() => setConfirmingDelete(false)} disabled={busy} hitSlop={8}>
                <Text style={styles.cancelLabel}>Annuler</Text>
              </Pressable>
              <Pressable onPress={handleDelete} disabled={busy} hitSlop={8}>
                <Text style={styles.deleteLabel}>{busy ? "Suppression…" : "Confirmer"}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.ground },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.space.lg },
  content: { padding: theme.space.lg, paddingBottom: theme.space.xl, maxWidth: 480, alignSelf: "center", width: "100%" },
  back: { marginBottom: theme.space.lg },
  backLabel: { color: theme.color.accentInk, fontSize: theme.font.small },
  errorText: { color: theme.color.danger, fontSize: theme.font.body, textAlign: "center" },
  image: {
    width: "100%",
    maxWidth: 320,
    aspectRatio: 1,
    alignSelf: "center",
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.line,
    marginBottom: theme.space.md,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, marginBottom: theme.space.xs },
  title: { fontSize: theme.font.title, fontWeight: "700", color: theme.color.ink },
  subtitle: { fontSize: theme.font.body, color: theme.color.muted, marginBottom: theme.space.lg },
  verifiedBadge: { backgroundColor: theme.color.verifiedSoft, borderRadius: 100, paddingHorizontal: 10, paddingVertical: 3 },
  verifiedBadgeText: { color: theme.color.verified, fontSize: theme.font.small, fontWeight: "600" },
  deleteLabel: { color: theme.color.danger, fontSize: theme.font.small, fontWeight: "600" },
  confirmRow: {
    backgroundColor: theme.color.dangerSoft,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    marginTop: theme.space.sm,
  },
  confirmText: { fontSize: theme.font.small, color: theme.color.ink, marginBottom: theme.space.sm },
  confirmButtons: { flexDirection: "row", gap: theme.space.lg },
  cancelLabel: { color: theme.color.muted, fontSize: theme.font.small, fontWeight: "600" },
});
