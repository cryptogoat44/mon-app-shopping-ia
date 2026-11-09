import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { SharedCollectionSummary } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { fetchUserCollections } from "@/lib/api";
import { friendSectionVisible } from "@/lib/collections";
import { useCollectionsStatus } from "@/lib/use-collections-status";
import { ImageUnavailable } from "@/components/image-unavailable";
import { SpotImage } from "@/components/spot-image";
import { themedStyles } from "@/theme/themed-styles";

// Section « Collections » du profil d'un ami (lot collections) : les
// collections qu'il montre à ses amis — nom, couverture (copie Spotto de
// l'image de sa première envie), nombre d'envies. Rien pour les autres
// visiteurs, ni sans les collections sur le serveur. `refreshKey` : relue
// quand l'abonnement change (devenir amis, ou ne plus l'être).
export function FriendCollections({ userId, displayName, refreshKey }: { userId: string; displayName: string; refreshKey: string }) {
  const router = useRouter();
  const status = useCollectionsStatus();
  const [collections, setCollections] = useState<SharedCollectionSummary[] | null>(null);

  useEffect(() => {
    if (!status.enabled) {
      setCollections(null);
      return;
    }
    let cancelled = false;
    fetchUserCollections(userId)
      .then((list) => {
        if (!cancelled) setCollections(list);
      })
      // En échec : la section reste cachée (le reste du profil s'affiche).
      .catch(() => {
        if (!cancelled) setCollections(null);
      });
    return () => {
      cancelled = true;
    };
  }, [status.enabled, userId, refreshKey]);

  if (!friendSectionVisible(status, collections) || !collections) return null;
  return (
    <View style={styles.section} testID="collections-ami">
      <Text style={styles.title} accessibilityRole="header">
        {t.collections.friendSection}
      </Text>
      <Text style={styles.hint}>{t.collections.friendSectionHint(displayName)}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {collections.map((collection) => (
          <Pressable
            key={collection.id}
            style={styles.card}
            onPress={() => router.push({ pathname: "/collection-ami", params: { id: collection.id } })}
            accessibilityRole="button"
            accessibilityLabel={t.collections.openCollection(collection.name, collection.itemCount)}
          >
            <View style={styles.cover}>
              {collection.coverUrl ? (
                <SpotImage hdUri={null} fallbackUri={collection.coverUrl} style={styles.fill} fit="cover" size="small" recyclingKey={collection.id} />
              ) : (
                <ImageUnavailable variant="thumb" accessible={false} />
              )}
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {collection.name}
            </Text>
            <Text style={styles.count}>{t.collections.itemCount(collection.itemCount)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { alignSelf: "stretch", marginTop: space.xl },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre },
  hint: { fontSize: font.caption, color: color.acier, marginTop: 2, marginBottom: space.sm },
  row: { gap: space.sm },
  card: { width: 120 },
  cover: { width: 120, height: 120, borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.plinthe },
  fill: { width: "100%", height: "100%" },
  name: { fontSize: font.caption, fontWeight: "600", color: color.encre, marginTop: space.xs },
  count: { fontSize: 11.5, color: color.acier },
}));
