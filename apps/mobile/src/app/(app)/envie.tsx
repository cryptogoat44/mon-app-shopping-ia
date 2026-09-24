import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { WishlistItem } from "@monapp/shared-types";
import { ApiError, deleteWishlistItem, fetchWishlistItem } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { SpotImage } from "@/components/spot-image";
import { MerchantLinkButton } from "@/components/merchant-link-button";
import { ErrorMessage } from "@/components/error-message";

function formatPrice(item: WishlistItem): string | null {
  if (item.priceMin === null) return null;
  const currency = item.currency === "EUR" ? "€" : (item.currency ?? "");
  return `${item.priceMin.toLocaleString("fr-FR")} ${currency}`.trim();
}

// Détail d'une Envie (Lot Q, bloc 3, UX-04) : l'image entière, « Voir chez
// … » (lien affilié signalé) et « Retirer de mes Envies ».
export default function WishlistItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useToast();
  const [item, setItem] = useState<WishlistItem | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not_found" | "error">("loading");
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setState("loading");
    try {
      setItem(await fetchWishlistItem(id));
      setState("ready");
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? "not_found" : "error");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/profile");
  }

  async function handleRemove() {
    if (!item) return;
    setRemoving(true);
    setError(null);
    try {
      await deleteWishlistItem(item.id);
      showToast(fr.wishlistItem.removed);
      goBack();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fr.wishlistItem.removeError);
      setRemoving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={goBack} hitSlop={12} style={styles.navBack} accessibilityRole="button" accessibilityLabel="Retour aux Envies">
          <Text style={styles.backLabel}>‹ {fr.wishlistItem.back}</Text>
        </Pressable>
      </View>

      {state !== "ready" || !item ? (
        <View style={styles.centered}>
          {state === "loading" ? (
            <ActivityIndicator color={color.encre} />
          ) : (
            <>
              <ErrorMessage style={styles.message}>{state === "not_found" ? fr.wishlistItem.notFound : fr.wishlist.loadError}</ErrorMessage>
              {state === "error" ? (
                <Pressable onPress={load} style={styles.retry} accessibilityRole="button">
                  <Text style={styles.retryLabel}>Réessayer</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.image}>
            <SpotImage hdUri={item.imageHdUrl} fallbackUri={item.imageUrl} style={styles.fill} accessibilityLabel={item.title} />
          </View>
          <Text style={styles.title} accessibilityRole="header">{item.title}</Text>
          <Text style={styles.meta}>{[item.merchantName, formatPrice(item)].filter(Boolean).join(" · ")}</Text>

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

          {error ? <ErrorMessage style={styles.message}>{error}</ErrorMessage> : null}
          {!confirming ? (
            <Pressable onPress={() => setConfirming(true)} hitSlop={12} style={styles.removeRow} accessibilityRole="button">
              <Text style={styles.removeLabel}>{fr.wishlistItem.remove}</Text>
            </Pressable>
          ) : (
            <View style={styles.confirm}>
              <Text style={styles.confirmText} accessibilityRole="alert">{fr.wishlistItem.removeConfirm}</Text>
              <View style={styles.confirmButtons}>
                <Pressable onPress={() => setConfirming(false)} disabled={removing} hitSlop={12} accessibilityRole="button">
                  <Text style={styles.cancelLabel}>{fr.wishlistItem.cancel}</Text>
                </Pressable>
                <Pressable onPress={handleRemove} disabled={removing} hitSlop={12} accessibilityRole="button">
                  <Text style={styles.removeLabel}>{removing ? fr.wishlistItem.removing : fr.wishlistItem.confirm}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, justifyContent: "center", paddingHorizontal: space.lg },
  navBack: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  backLabel: { color: color.encre, fontSize: font.secondary },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl },
  message: { fontSize: font.secondary, textAlign: "center", marginBottom: space.sm },
  retry: { marginTop: space.md, minHeight: 44, justifyContent: "center" },
  retryLabel: { fontSize: font.body, color: color.vert, fontWeight: "600" },
  content: { padding: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  image: { width: "100%", maxWidth: 360, aspectRatio: 4 / 5, alignSelf: "center", borderRadius: radius.sm, backgroundColor: color.plinthe, overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, marginTop: space.md },
  meta: { fontSize: font.secondary, color: color.acier, marginTop: 4, marginBottom: space.lg },
  merchant: { marginBottom: space.lg },
  removeRow: { alignItems: "center", minHeight: 44, justifyContent: "center" },
  removeLabel: { color: color.danger, fontSize: font.secondary, fontWeight: "600" },
  confirm: { backgroundColor: color.plinthe, borderRadius: radius.md, padding: space.md },
  confirmText: { fontSize: font.secondary, color: color.encre, marginBottom: space.sm },
  confirmButtons: { flexDirection: "row", gap: space.lg },
  cancelLabel: { color: color.acier, fontSize: font.secondary, fontWeight: "600" },
});
