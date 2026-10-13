import { formatPrice } from "@/lib/format";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { PRIVACY_LEVELS, type PrivacyLevel, type WishlistItemDetail } from "@monapp/shared-types";
import { ApiError, deleteWishlistItem, fetchWishlistItem, republishWish } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { useAuth } from "@/lib/auth-context";
import { shareWishOutside } from "@/lib/share-wish";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { ProductFrame } from "@/components/product-frame";
import { MerchantLinkButton } from "@/components/merchant-link-button";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

function displayPrice(item: WishlistItemDetail): string | null {
  if (item.priceMin === null) return null;
  return formatPrice(item.priceMin, item.currency, getActiveLocale());
}

// Détail d'une Envie (Lot Q, bloc 3, UX-04) : l'image entière, « Voir chez
// … » (lien affilié signalé) et « Retirer de mes Envies ». Lot 5 (5.C) :
// partager l'envie, toujours par un geste volontaire — la republier sur son
// profil (confidentialité au choix), l'envoyer à une personne sur Spotto, ou
// la partager hors de l'app (mention « lien affilié » quand c'est le cas).
export default function WishlistItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useToast();
  const { profile } = useAuth();
  const [item, setItem] = useState<WishlistItemDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not_found" | "error">("loading");
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<PrivacyLevel>(profile?.defaultPrivacy ?? "followers");
  const [republishing, setRepublishing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setItem(await fetchWishlistItem(id));
      setState("ready");
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? "not_found" : "error");
    }
  }, [id]);

  // Relu à chaque retour sur l'écran : une publication supprimée depuis son
  // détail rend l'envie de nouveau republiable.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/profile");
  }

  async function handleRepublish() {
    if (!item) return;
    setRepublishing(true);
    setError(null);
    try {
      const post = await republishWish(item.id, privacy);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(t.wishlistItem.republished);
      setItem((current) => (current ? { ...current, sharedPost: { id: post.id, privacy: post.privacy, createdAt: post.createdAt } } : current));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.wishlistItem.republishError);
    } finally {
      setRepublishing(false);
    }
  }

  async function handleShareOutside() {
    if (!item) return;
    const outcome = await shareWishOutside(item);
    if (outcome === "copied") showToast(t.wishlistItem.linkCopied);
  }

  async function handleRemove() {
    if (!item) return;
    setRemoving(true);
    setError(null);
    try {
      await deleteWishlistItem(item.id);
      showToast(t.wishlistItem.removed);
      goBack();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.wishlistItem.removeError);
      setRemoving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={goBack} hitSlop={12} style={styles.navBack} accessibilityRole="button" accessibilityLabel={t.wishlistItem.backLabel}>
          <Text style={styles.backLabel}>‹ {t.wishlistItem.back}</Text>
        </Pressable>
      </View>

      {state !== "ready" || !item ? (
        <View style={styles.centered}>
          {state === "loading" ? (
            <ActivityIndicator color={color.encre} />
          ) : (
            <>
              <ErrorMessage style={styles.message}>{state === "not_found" ? t.wishlistItem.notFound : t.wishlist.loadError}</ErrorMessage>
              {state === "error" ? (
                <Pressable onPress={load} style={styles.retry} accessibilityRole="button">
                  <Text style={styles.retryLabel}>{t.common.retry}</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <ProductFrame hdUri={item.imageHdUrl} fallbackUri={item.imageUrl} accessibilityLabel={item.title} />
          <Text style={styles.title} accessibilityRole="header">{item.title}</Text>
          <Text style={styles.meta}>{[item.merchantName, displayPrice(item)].filter(Boolean).join(" · ")}</Text>

          {item.merchantUrl ? (
            <View style={styles.merchant}>
              <MerchantLinkButton
                url={item.affiliateUrl ?? item.merchantUrl}
                merchantName={item.merchantName}
                matchId={item.productMatchId}
                context="wishlist"
                isAffiliate={item.affiliateUrl !== null && item.affiliateUrl !== item.merchantUrl}
              />
            </View>
          ) : null}

          <View style={styles.shareSection}>
            <Text style={styles.sectionTitle} accessibilityRole="header">{t.wishlistItem.shareTitle}</Text>
            <Text style={styles.hint}>{t.wishlistItem.shareHint}</Text>

            {item.sharedPost ? (
              // Déjà sur le profil : l'état réel, jamais un choix reproposé.
              <View style={styles.sharedBox}>
                <Text style={styles.sharedTitle}>{t.wishlistItem.sharedState(t.vaultLabels.privacy[item.sharedPost.privacy])}</Text>
                <Pressable
                  onPress={() => router.push({ pathname: "/publication", params: { id: item.sharedPost!.id } })}
                  hitSlop={8}
                  accessibilityRole="link"
                >
                  <Text style={styles.sharedLink}>{t.wishlistItem.viewPost}</Text>
                </Pressable>
                <Text style={styles.hint}>{t.wishlistItem.shareAgainHint}</Text>
              </View>
            ) : (
              <>
                <Text style={styles.label}>{t.wishlistItem.republishVisibility}</Text>
                <View style={styles.pillRow} accessibilityRole="radiogroup" accessibilityLabel={t.wishlistItem.republishVisibility}>
                  {PRIVACY_LEVELS.map((level) => (
                    <Pressable
                      key={level}
                      hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
                      style={[styles.privacyPill, privacy === level ? styles.privacyPillActive : null]}
                      onPress={() => setPrivacy(level)}
                      disabled={republishing}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: privacy === level }}
                    >
                      <Text style={[styles.privacyLabel, privacy === level ? styles.privacyLabelActive : null]}>{t.vaultLabels.privacy[level]}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  accessibilityRole="button"
                  style={[styles.primaryButton, republishing ? styles.primaryButtonDisabled : null]}
                  onPress={handleRepublish}
                  disabled={republishing}
                  accessibilityState={{ disabled: republishing, busy: republishing }}
                >
                  <Text style={[styles.primaryLabel, republishing ? styles.primaryLabelDisabled : null]}>
                    {republishing ? t.wishlistItem.republishing : t.wishlistItem.republish}
                  </Text>
                </Pressable>
              </>
            )}

            <Pressable
              accessibilityRole="button"
              style={styles.secondaryButton}
              onPress={() => router.push({ pathname: "/envoyer-envie", params: { id: item.id } })}
            >
              <Text style={styles.secondaryLabel}>{t.wishlistItem.sendToSomeone}</Text>
            </Pressable>
            {item.merchantUrl ? (
              <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={handleShareOutside}>
                <Text style={styles.secondaryLabel}>{t.wishlistItem.shareOutside}</Text>
              </Pressable>
            ) : null}
          </View>

          {error ? <ErrorMessage style={styles.message}>{error}</ErrorMessage> : null}
          {!confirming ? (
            <Pressable onPress={() => setConfirming(true)} hitSlop={12} style={styles.removeRow} accessibilityRole="button">
              <Text style={styles.removeLabel}>{t.wishlistItem.remove}</Text>
            </Pressable>
          ) : (
            <View style={styles.confirm}>
              <Text style={styles.confirmText} accessibilityRole="alert">
                {item.sharedPost ? t.wishlistItem.removeConfirmWithPost : t.wishlistItem.removeConfirm}
              </Text>
              <View style={styles.confirmButtons}>
                <Pressable onPress={() => setConfirming(false)} disabled={removing} hitSlop={12} accessibilityRole="button">
                  <Text style={styles.cancelLabel}>{t.wishlistItem.cancel}</Text>
                </Pressable>
                <Pressable onPress={handleRemove} disabled={removing} hitSlop={12} accessibilityRole="button">
                  <Text style={styles.removeLabel}>{removing ? t.wishlistItem.removing : t.wishlistItem.confirm}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, justifyContent: "center", paddingHorizontal: space.lg },
  navBack: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  backLabel: { color: color.encre, fontSize: font.secondary },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl },
  message: { fontSize: font.secondary, textAlign: "center", marginBottom: space.sm },
  retry: { marginTop: space.md, minHeight: 44, justifyContent: "center" },
  retryLabel: { fontSize: font.body, color: color.vert, fontWeight: "600" },
  content: { padding: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, marginTop: space.md },
  meta: { fontSize: font.secondary, color: color.acier, marginTop: 4, marginBottom: space.lg },
  merchant: { marginBottom: space.lg },
  shareSection: { borderTopWidth: 1, borderTopColor: color.filet, paddingTop: space.lg, marginBottom: space.lg, gap: space.sm },
  sectionTitle: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  hint: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
  label: { fontSize: font.caption, color: color.acier, marginTop: space.xs },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  privacyPill: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.full, paddingVertical: 6, paddingHorizontal: 12, minHeight: 32, justifyContent: "center" },
  privacyPillActive: { backgroundColor: color.vert, borderColor: color.vert },
  privacyLabel: { fontSize: font.caption, color: color.acier },
  privacyLabelActive: { color: color.blanc, fontWeight: "600" },
  primaryButton: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: space.xs },
  primaryButtonDisabled: { backgroundColor: color.inactif },
  primaryLabel: { color: color.blanc, fontSize: font.secondary, fontWeight: "600" },
  primaryLabelDisabled: { color: color.surInactif },
  secondaryButton: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, minHeight: 48, alignItems: "center", justifyContent: "center" },
  secondaryLabel: { color: color.vert, fontSize: font.secondary, fontWeight: "600" },
  sharedBox: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md, gap: 6 },
  sharedTitle: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  sharedLink: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  removeRow: { alignItems: "center", minHeight: 44, justifyContent: "center" },
  removeLabel: { color: color.danger, fontSize: font.secondary, fontWeight: "600" },
  confirm: { backgroundColor: color.plinthe, borderRadius: radius.md, padding: space.md },
  confirmText: { fontSize: font.secondary, color: color.encre, marginBottom: space.sm },
  confirmButtons: { flexDirection: "row", gap: space.lg },
  cancelLabel: { color: color.acier, fontSize: font.secondary, fontWeight: "600" },
}));
