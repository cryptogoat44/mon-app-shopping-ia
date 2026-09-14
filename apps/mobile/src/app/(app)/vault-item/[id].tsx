import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import type { PrivacyLevel, VaultItem } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { ApiError, deleteVaultItem, fetchVaultItem, sharePurchasePost, updateVaultItem } from "@/lib/api";
import { PRIVACY_LABELS, PRIVACY_LEVELS, VAULT_CATEGORY_LABELS } from "@/lib/vault-labels";
import { VerifiedIcon } from "@/components/icons";
import { useToast } from "@/lib/toast-context";

export default function VaultItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useToast();

  function safeBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/profile");
  }

  const [item, setItem] = useState<VaultItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    fetchVaultItem(id)
      .then(setItem)
      .catch((e) => setError(e instanceof ApiError ? e.message : fr.vaultItem.loadError));
  }, [id]);

  async function handlePrivacyChange(privacy: PrivacyLevel) {
    if (!item || item.privacy === privacy) return;
    setBusy(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const updated = await updateVaultItem(item.id, { privacy });
      setItem(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fr.vaultItem.updateError);
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setShared(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fr.vaultItem.shareError);
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(fr.vaultItem.removedToast);
      safeBack();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fr.vaultItem.removeError);
      setBusy(false);
    }
  }

  if (!item) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          {error ? <Text style={styles.errorText}>{error}</Text> : <ActivityIndicator color={color.encre} />}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          onPress={safeBack}
          hitSlop={8}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Retour au vault"
        >
          <Text style={styles.backLabel}>‹ {fr.vaultItem.back}</Text>
        </Pressable>

        {error ? <Text style={styles.banner}>{error}</Text> : null}

        <Image source={{ uri: item.imageUrl }} style={styles.image} contentFit="cover" />

        <View style={styles.titleRow}>
          <Text style={styles.title}>{item.title}</Text>
          {item.verified ? (
            <View style={styles.verifiedBadge}>
              <VerifiedIcon size={13} tint={color.vert} />
              <Text style={styles.verifiedBadgeText}>{fr.profile.verified}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.subtitle}>{VAULT_CATEGORY_LABELS[item.category]}</Text>

        <Text style={styles.label}>{fr.vaultItem.visibility}</Text>
        <View style={styles.pillRow}>
          {PRIVACY_LEVELS.map((level) => (
            <Pressable
              key={level}
              style={[styles.privacyPill, item.privacy === level ? styles.privacyPillActive : null]}
              onPress={() => handlePrivacyChange(level)}
              disabled={busy}
              accessibilityRole="radio"
              accessibilityState={{ selected: item.privacy === level }}
            >
              <Text style={[styles.privacyLabel, item.privacy === level ? styles.privacyLabelActive : null]}>
                {PRIVACY_LABELS[level]}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          style={[styles.shareButton, sharing || shared ? styles.shareButtonDisabled : null]}
          onPress={handleShare}
          disabled={sharing || shared}
        >
          <Text style={styles.shareLabel}>
            {shared ? fr.vaultItem.shared : sharing ? fr.vaultItem.sharing : fr.vaultItem.share}
          </Text>
        </Pressable>

        {!confirmingDelete ? (
          <Pressable onPress={() => setConfirmingDelete(true)} disabled={busy} hitSlop={8} style={styles.removeRow}>
            <Text style={styles.deleteLabel}>{fr.vaultItem.remove}</Text>
          </Pressable>
        ) : (
          <View style={styles.confirmRow}>
            <Text style={styles.confirmText}>{fr.vaultItem.removeConfirm}</Text>
            <View style={styles.confirmButtons}>
              <Pressable onPress={() => setConfirmingDelete(false)} disabled={busy} hitSlop={8}>
                <Text style={styles.cancelLabel}>{fr.vaultItem.cancel}</Text>
              </Pressable>
              <Pressable onPress={handleDelete} disabled={busy} hitSlop={8}>
                <Text style={styles.deleteLabel}>{busy ? fr.vaultItem.removing : fr.vaultItem.confirm}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg },
  content: { padding: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  back: { marginBottom: space.lg },
  backLabel: { color: color.encre, fontSize: font.secondary },
  errorText: { color: color.danger, fontSize: font.body, textAlign: "center" },
  banner: { fontSize: font.secondary, color: color.danger, marginBottom: space.md },
  image: {
    width: "100%",
    maxWidth: 320,
    aspectRatio: 1,
    alignSelf: "center",
    borderRadius: radius.sm,
    backgroundColor: color.plinthe,
    marginBottom: space.md,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.xs },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, flexShrink: 1 },
  subtitle: { fontSize: font.secondary, color: color.acier, marginBottom: space.lg },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: color.plinthe,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  verifiedBadgeText: { color: color.vert, fontSize: font.caption, fontWeight: "600" },
  label: { fontSize: font.caption, color: color.acier, marginBottom: 10 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginBottom: space.lg },
  privacyPill: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.full, paddingVertical: 6, paddingHorizontal: 12 },
  privacyPillActive: { backgroundColor: color.vert, borderColor: color.vert },
  privacyLabel: { fontSize: font.caption, color: color.acier },
  privacyLabelActive: { color: color.blanc, fontWeight: "600" },
  shareButton: {
    backgroundColor: color.vert,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: space.lg,
  },
  shareButtonDisabled: { opacity: 0.6 },
  shareLabel: { color: color.blanc, fontSize: font.secondary, fontWeight: "600" },
  removeRow: { alignItems: "center" },
  deleteLabel: { color: color.danger, fontSize: font.secondary, fontWeight: "600" },
  confirmRow: {
    backgroundColor: color.plinthe,
    borderRadius: radius.md,
    padding: space.md,
  },
  confirmText: { fontSize: font.secondary, color: color.encre, marginBottom: space.sm },
  confirmButtons: { flexDirection: "row", gap: space.lg },
  cancelLabel: { color: color.acier, fontSize: font.secondary, fontWeight: "600" },
});
