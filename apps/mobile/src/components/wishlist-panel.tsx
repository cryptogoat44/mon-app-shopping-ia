import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { color, font, radius, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { getWishlist } from "@/api/client";
import type { Piece, WishlistItem } from "@/api/types";
import { ApiError } from "@/lib/api";
import { ClockIcon } from "@/components/icons";
import { Skeleton } from "@/components/skeleton";
import { ErrorMessage } from "@/components/error-message";
import { MerchantLinkButton } from "@/components/merchant-link-button";
import { SpotImage } from "@/components/spot-image";

function formatPrice(item: Piece): string | null {
  if (item.priceFrom === null) return null;
  const currency = item.currency === "EUR" ? "€" : (item.currency ?? "");
  return `${item.priceFrom.toLocaleString("fr-FR")} ${currency}`.trim();
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

// Envies (Lot F) : un onglet du Profil (Vault · Lifestyle · Envies), plus
// dans la barre de navigation. Strictement privées : n'apparaissent que sur
// son propre profil, jamais sur le profil vu par quelqu'un d'autre.
export function WishlistPanel() {
  const router = useRouter();
  const [items, setItems] = useState<WishlistItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    () =>
      getWishlist()
        .then((page) => {
          setItems(page.items);
          setNextCursor(page.nextCursor);
          setError(null);
        })
        .catch((e) => {
          setItems([]);
          setNextCursor(null);
          setError(e instanceof ApiError ? e.message : fr.wishlist.loadError);
        }),
    []
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleLoadMore() {
    if (!nextCursor || loadingMore || refreshing) return;
    setLoadingMore(true);
    try {
      const page = await getWishlist(nextCursor);
      setItems((prev) => (prev ? [...prev, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch {
      // silencieux : re-scroller vers le bas redéclenche onEndReached
    } finally {
      setLoadingMore(false);
    }
  }

  const loading = items === null;
  const isEmpty = !error && items?.length === 0;

  return (
    <>
      <Text style={styles.privateNote}>{fr.wishlist.privateNote}</Text>
      {loading ? (
        <View style={styles.grid}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.card}>
              <Skeleton style={styles.thumb} />
              <Skeleton style={{ width: "80%", height: 11 }} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={chunk(items ?? [], 3)}
          keyExtractor={(row) => row.map((item) => item.id).join("-")}
          contentContainerStyle={isEmpty || error ? styles.emptyContent : styles.gridContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={color.encre} />}
          renderItem={({ item: row }) => (
            <View style={styles.gridRow}>
              {row.map((item) => (
                <View key={item.id} style={styles.card}>
                  <Pressable
                    onPress={() => router.push({ pathname: "/envie", params: { id: item.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={item.name}
                  >
                    <View style={styles.thumb}>
                      {item.imageUrl ? (
                        <SpotImage hdUri={item.imageHdUrl} fallbackUri={item.imageUrl} style={styles.thumbImage} fit="cover" accessibilityLabel={item.name} />
                      ) : (
                        <ClockIcon size={30} tint={color.encre} />
                      )}
                    </View>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {formatPrice(item) ? <Text style={styles.price}>{formatPrice(item)}</Text> : null}
                  </Pressable>
                  {item.merchantUrl ? (
                    <MerchantLinkButton
                      url={item.affiliateUrl ?? item.merchantUrl}
                      merchantName={item.merchantName}
                      matchId={item.productMatchId}
                      context="wishlist"
                      isAffiliate={item.affiliateUrl !== null && item.affiliateUrl !== item.merchantUrl}
                      compact
                    />
                  ) : null}
                </View>
              ))}
            </View>
          )}
          ListHeaderComponent={error ? <ErrorMessage style={styles.emptyText}>{error}</ErrorMessage> : null}
          ListEmptyComponent={
            !error ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>{fr.wishlist.empty}</Text>
                <Pressable accessibilityRole="button" onPress={() => router.push("/")}>
                  <Text style={styles.emptyCta}>{fr.wishlist.emptyCta}</Text>
                </Pressable>
              </View>
            ) : null
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={color.encre} style={styles.footerLoader} /> : null}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  privateNote: { fontSize: font.caption, color: color.acier, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xs, maxWidth: 640, alignSelf: "center", width: "100%" },
  emptyContent: { flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl, marginTop: -60 },
  emptyText: { fontSize: font.secondary, color: color.acier, textAlign: "center", lineHeight: 20, marginBottom: space.md },
  emptyCta: { fontSize: font.body, color: color.vert, fontWeight: "600" },
  grid: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xxl,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.md,
    maxWidth: 640,
    alignSelf: "center",
    width: "100%",
  },
  gridContent: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xxl,
    maxWidth: 640,
    alignSelf: "center",
    width: "100%",
  },
  gridRow: { flexDirection: "row", gap: space.md, marginBottom: space.md },
  card: { width: "31%" },
  thumb: { backgroundColor: color.plinthe, borderRadius: radius.sm, aspectRatio: 1, alignItems: "center", justifyContent: "center", marginBottom: space.xs, overflow: "hidden" },
  thumbImage: { width: "100%", height: "100%" },
  name: { fontSize: font.caption, color: color.encre },
  price: { fontSize: 11, color: color.acier, marginTop: 2 },
  footerLoader: { paddingVertical: space.lg },
});
