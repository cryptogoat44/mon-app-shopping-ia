import { useCallback, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { getWishlist } from "@/api/client";
import type { WishlistItem } from "@/api/types";
import { ClockIcon } from "@/components/icons";

export default function WishlistScreen() {
  const router = useRouter();
  const [items, setItems] = useState<WishlistItem[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      getWishlist()
        .then(setItems)
        .catch(() => setItems([]));
    }, [])
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{fr.wishlist.title}</Text>
      </View>
      {items && items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{fr.wishlist.empty}</Text>
          <Pressable onPress={() => router.push("/(app)/(tabs)")}>
            <Text style={styles.emptyCta}>{fr.wishlist.emptyCta}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          {(items ?? []).map((item) => (
            <View key={item.id} style={styles.card}>
              <View style={styles.thumb}>
                <ClockIcon size={30} tint={color.encre} />
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  header: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, color: color.encre },
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
  card: { width: "31%" },
  thumb: { backgroundColor: color.plinthe, borderRadius: radius.sm, aspectRatio: 1, alignItems: "center", justifyContent: "center", marginBottom: space.xs },
  name: { fontSize: font.caption, color: color.encre },
});
