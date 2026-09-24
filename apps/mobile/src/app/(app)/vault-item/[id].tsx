import { useCallback, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import type { PrivacyLevel, VaultItemDetail } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { ApiError, changeVaultItemPhoto, deleteVaultItem, fetchVaultItem, sharePurchasePost } from "@/lib/api";
import { importPhotoForSpotter } from "@/lib/image-import";
import { SpotImage } from "@/components/spot-image";
import { PRIVACY_LABELS, PRIVACY_LEVELS, VAULT_CATEGORY_LABELS } from "@/lib/vault-labels";
import { VerifiedIcon } from "@/components/icons";
import { useToast } from "@/lib/toast-context";
import { useAuth } from "@/lib/auth-context";
import { Skeleton } from "@/components/skeleton";
import { ErrorMessage } from "@/components/error-message";
import { MerchantLinkButton } from "@/components/merchant-link-button";

// Décision du fondateur (journal, 2026-09-23, décision 1) : retirer un
// objet partagé supprime aussi ses publications "achat" — on le dit avant
// la confirmation, jamais après.
function removeConfirmText(purchasePostCount: number): string {
  if (purchasePostCount === 0) return fr.vaultItem.removeConfirm;
  if (purchasePostCount === 1) return fr.vaultItem.removeConfirmWithPost;
  return fr.vaultItem.removeConfirmWithPosts(purchasePostCount);
}

export default function VaultItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useToast();

  // La nouvelle photo remplace l'ancienne (supprimée côté serveur si c'était
  // une photo personnelle) ; les publications « achat » suivent.
  async function handleChangePhoto() {
    if (!item) return;
    setError(null);
    const picked = await importPhotoForSpotter();
    if (picked.kind === "denied") {
      setError(fr.spotter.photoDenied);
      return;
    }
    if (picked.kind !== "picked") return;
    setChangingPhoto(true);
    try {
      const updated = await changeVaultItemPhoto(item.id, picked.uri);
      setItem((current) => (current ? { ...current, ...updated } : current));
      showToast(fr.vaultItem.photoChanged);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fr.vaultItem.changePhotoError);
    } finally {
      setChangingPhoto(false);
    }
  }

  function safeBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/profile");
  }

  const [item, setItem] = useState<VaultItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [changingPhoto, setChangingPhoto] = useState(false);
  const { profile } = useAuth();
  const [sharePrivacy, setSharePrivacy] = useState<PrivacyLevel>(profile?.defaultPrivacy ?? "followers");
  const [sharing, setSharing] = useState(false);

  // Relu à chaque retour sur l'écran : une publication supprimée depuis son
  // détail rend la pièce de nouveau partageable (Lot F).
  useFocusEffect(
    useCallback(() => {
      fetchVaultItem(id)
        .then(setItem)
        .catch((e) => setError(e instanceof ApiError ? e.message : fr.vaultItem.loadError));
    }, [id])
  );

  async function handleShare() {
    if (!item) return;
    setSharing(true);
    setError(null);
    try {
      const post = await sharePurchasePost(item.id, sharePrivacy);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(fr.vaultItem.shared);
      // L'état du partage s'affiche tout de suite ; le retrait de l'objet
      // supprimerait désormais aussi cette publication (avertissement).
      setItem((current) =>
        current
          ? {
              ...current,
              purchasePostCount: current.purchasePostCount + 1,
              sharedPost: { id: post.id, privacy: post.privacy, createdAt: post.createdAt },
            }
          : current
      );
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
        <View style={styles.content}>
          {error ? (
            <ErrorMessage style={styles.errorText}>{error}</ErrorMessage>
          ) : (
            <>
              <Skeleton style={styles.image} />
              <Skeleton style={{ width: "60%", height: 20, marginBottom: space.xs }} />
              <Skeleton style={{ width: "35%", height: 14, marginBottom: space.lg }} />
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          onPress={safeBack}
          hitSlop={12}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Retour au vault"
        >
          <Text style={styles.backLabel}>‹ {fr.vaultItem.back}</Text>
        </Pressable>

        {error ? <ErrorMessage style={styles.banner}>{error}</ErrorMessage> : null}

        {/* Image entière (jamais rognée), en haute définition quand elle existe. */}
        <View style={styles.image}>
          <SpotImage hdUri={item.imageHdUrl} fallbackUri={item.imageUrl} style={styles.fill} accessibilityLabel={item.title} />
        </View>
        <Pressable
          onPress={handleChangePhoto}
          disabled={changingPhoto || busy}
          hitSlop={8}
          style={styles.changePhoto}
          accessibilityRole="button"
        >
          <Text style={styles.changePhotoLabel}>{changingPhoto ? fr.vaultItem.changingPhoto : fr.vaultItem.changePhoto}</Text>
        </Pressable>

        <View style={styles.titleRow}>
          <Text style={styles.title} accessibilityRole="header">{item.title}</Text>
          {item.verified ? (
            <View style={styles.verifiedBadge}>
              <VerifiedIcon size={13} tint={color.vert} />
              <Text style={styles.verifiedBadgeText}>{fr.profile.verified}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.subtitle}>{VAULT_CATEGORY_LABELS[item.category]}</Text>

        {item.merchantUrl ? (
          <View style={styles.merchant}>
            <MerchantLinkButton
              url={item.affiliateUrl ?? item.merchantUrl}
              merchantName={item.merchantName}
              matchId={item.productMatchId}
              context="vault"
              isAffiliate={item.affiliateUrl !== null}
            />
          </View>
        ) : null}

        {/* Décision 5 du Lot Q : le Vault est toujours privé. La seule façon
            de montrer une pièce est de la partager, avec la confidentialité
            choisie pour cette publication. */}
        <Text style={styles.privateNote}>{fr.vaultItem.privateNote}</Text>
        {item.sharedPost ? (
          // Déjà partagée (Lot F) : l'état réel, jamais un choix reproposé
          // comme si rien ne s'était passé. Une pièce ne se partage qu'une
          // fois à la fois : pour la montrer autrement, on supprime d'abord
          // la publication (depuis son détail).
          <View style={styles.sharedBox}>
            <Text style={styles.sharedTitle}>{fr.vaultItem.sharedState(PRIVACY_LABELS[item.sharedPost.privacy])}</Text>
            <Pressable
              onPress={() => router.push({ pathname: "/publication", params: { id: item.sharedPost!.id } })}
              hitSlop={8}
              accessibilityRole="link"
            >
              <Text style={styles.sharedLink}>{fr.vaultItem.viewPost}</Text>
            </Pressable>
            <Text style={styles.sharedHint}>{fr.vaultItem.shareAgainHint}</Text>
          </View>
        ) : (
          <>
            <Text style={styles.label}>{fr.vaultItem.shareVisibility}</Text>
            <View style={styles.pillRow} accessibilityRole="radiogroup">
              {PRIVACY_LEVELS.map((level) => (
                <Pressable
                  key={level}
                  hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
                  style={[styles.privacyPill, sharePrivacy === level ? styles.privacyPillActive : null]}
                  onPress={() => setSharePrivacy(level)}
                  disabled={sharing}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: sharePrivacy === level }}
                >
                  <Text style={[styles.privacyLabel, sharePrivacy === level ? styles.privacyLabelActive : null]}>
                    {PRIVACY_LABELS[level]}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              style={[styles.shareButton, sharing ? styles.shareButtonDisabled : null]}
              onPress={handleShare}
              disabled={sharing}
            >
              <Text style={styles.shareLabel}>{sharing ? fr.vaultItem.sharing : fr.vaultItem.share}</Text>
            </Pressable>
          </>
        )}

        {!confirmingDelete ? (
          <Pressable accessibilityRole="button" onPress={() => setConfirmingDelete(true)} disabled={busy} hitSlop={12} style={styles.removeRow}>
            <Text style={styles.deleteLabel}>{fr.vaultItem.remove}</Text>
          </Pressable>
        ) : (
          <View style={styles.confirmRow}>
            <Text style={styles.confirmText} accessibilityRole="alert">
              {removeConfirmText(item.purchasePostCount)}
            </Text>
            <View style={styles.confirmButtons}>
              <Pressable accessibilityRole="button" onPress={() => setConfirmingDelete(false)} disabled={busy} hitSlop={12}>
                <Text style={styles.cancelLabel}>{fr.vaultItem.cancel}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={handleDelete} disabled={busy} hitSlop={12}>
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
  content: { padding: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  back: { marginBottom: space.lg },
  backLabel: { color: color.encre, fontSize: font.secondary },
  errorText: { color: color.danger, fontSize: font.body, textAlign: "center" },
  banner: { fontSize: font.secondary, color: color.danger, marginBottom: space.md },
  image: {
    width: "100%",
    maxWidth: 360,
    aspectRatio: 4 / 5,
    alignSelf: "center",
    borderRadius: radius.sm,
    backgroundColor: color.plinthe,
    overflow: "hidden",
  },
  fill: { width: "100%", height: "100%" },
  changePhoto: { alignSelf: "center", minHeight: 40, justifyContent: "center", marginBottom: space.sm },
  changePhotoLabel: { fontSize: font.caption, color: color.acier, fontWeight: "600" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.xs },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, flexShrink: 1 },
  subtitle: { fontSize: font.secondary, color: color.acier, marginBottom: space.lg },
  merchant: { marginBottom: space.lg },
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
  sharedBox: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md, marginBottom: space.lg, gap: 6 },
  sharedTitle: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  sharedLink: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  sharedHint: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
  privateNote: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginBottom: space.md },
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
