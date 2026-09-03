import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import type { VaultCategory, VaultItem } from "@monapp/shared-types";
import { ApiError, fetchVault } from "@/lib/api";
import { VAULT_CATEGORIES, VAULT_CATEGORY_LABELS } from "@/lib/vault-labels";
import { theme } from "@/lib/theme";

function groupByCategory(items: VaultItem[]): Partial<Record<VaultCategory, VaultItem[]>> {
  const groups: Partial<Record<VaultCategory, VaultItem[]>> = {};
  for (const item of items) {
    (groups[item.category] ??= []).push(item);
  }
  return groups;
}

function VaultCard({ item, onPress }: { item: VaultItem; onPress: () => void }) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <Image source={{ uri: item.imageUrl }} style={styles.cardImage} contentFit="cover" />
      {item.verified ? (
        <View style={styles.verifiedBadge}>
          <Text style={styles.verifiedBadgeText}>Vérifié</Text>
        </View>
      ) : null}
      <Text style={styles.cardTitle} numberOfLines={1}>
        {item.title}
      </Text>
    </Pressable>
  );
}

export default function VaultScreen() {
  const router = useRouter();
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchVault()
        .then((data) => {
          if (!cancelled) {
            setItems(data);
            setError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : "Impossible de charger le vault.");
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const groups = items ? groupByCategory(items) : {};
  const hasAnyItem = (items?.length ?? 0) > 0;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Mon vault</Text>
        <Pressable onPress={() => router.push("/vault-item/new")} hitSlop={8}>
          <Text style={styles.addLabel}>+ Ajouter</Text>
        </Pressable>
      </View>

      {items === null && !error ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.color.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {!hasAnyItem && !error ? (
            <Text style={styles.empty}>
              Votre vault est vide. Ajoutez un produit identifié ou une photo de vos achats.
            </Text>
          ) : null}

          {VAULT_CATEGORIES.filter((c) => groups[c]?.length).map((category) => (
            <View key={category} style={styles.section}>
              <Text style={styles.sectionTitle}>{VAULT_CATEGORY_LABELS[category]}</Text>
              <View style={styles.grid}>
                {groups[category]!.map((item) => (
                  <VaultCard
                    key={item.id}
                    item={item}
                    onPress={() => router.push({ pathname: "/vault-item/[id]", params: { id: item.id } })}
                  />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.ground },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.sm,
  },
  title: { fontSize: theme.font.title, fontWeight: "700", color: theme.color.ink },
  addLabel: { fontSize: theme.font.small, color: theme.color.accentInk, fontWeight: "600" },
  content: { padding: theme.space.lg, paddingTop: theme.space.sm, maxWidth: 640, alignSelf: "center", width: "100%" },
  errorBanner: {
    backgroundColor: theme.color.dangerSoft,
    borderRadius: theme.radius.md,
    padding: theme.space.sm,
    marginBottom: theme.space.md,
  },
  errorText: { color: theme.color.danger, fontSize: theme.font.small },
  empty: { fontSize: theme.font.body, color: theme.color.muted, textAlign: "center", marginTop: theme.space.xl },
  section: { marginBottom: theme.space.lg },
  sectionTitle: {
    fontSize: theme.font.small,
    fontWeight: "600",
    color: theme.color.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: theme.space.sm,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
  card: { width: "31%" },
  cardImage: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.line,
    marginBottom: theme.space.xs,
  },
  cardTitle: { fontSize: theme.font.small, color: theme.color.ink },
  verifiedBadge: {
    position: "absolute",
    top: theme.space.xs,
    left: theme.space.xs,
    backgroundColor: theme.color.verified,
    borderRadius: 100,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  verifiedBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
});
