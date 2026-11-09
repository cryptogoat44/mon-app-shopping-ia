import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { SharedCollectionSummary } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { fetchUserCollections } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { canReportCollection, friendSectionVisible, withoutCollection } from "@/lib/collections";
import { useCollectionsStatus } from "@/lib/use-collections-status";
import { MoreIcon } from "@/components/icons";
import { ImageUnavailable } from "@/components/image-unavailable";
import { ReportBlockMenu } from "@/components/report-block-menu";
import { SpotImage } from "@/components/spot-image";
import { themedStyles } from "@/theme/themed-styles";

// Section « Collections » du profil d'un ami (lot collections) : les
// collections qu'il montre à ses amis — nom, couverture (copie Spotto de
// l'image de sa première envie), nombre d'envies. Rien pour les autres
// visiteurs, ni sans les collections sur le serveur. `refreshKey` : relue
// quand l'abonnement change (devenir amis, ou ne plus l'être). Lot modération
// des collections : « … » sur chaque collection pour la signaler (ou bloquer
// ce compte) ; signalée, elle disparaît aussitôt de la section.
export function FriendCollections({ userId, displayName, refreshKey }: { userId: string; displayName: string; refreshKey: string }) {
  const router = useRouter();
  const status = useCollectionsStatus();
  const { session } = useAuth();
  const [collections, setCollections] = useState<SharedCollectionSummary[] | null>(null);
  const [menuFor, setMenuFor] = useState<SharedCollectionSummary | null>(null);
  const reportable = canReportCollection(status, userId, session?.user.id);

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
          <View key={collection.id} style={styles.card}>
            <Pressable
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
            {/* Un bouton à part, jamais dans celui qui ouvre la collection. */}
            {reportable ? (
              <Pressable
                style={styles.more}
                onPress={() => setMenuFor(collection)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t.collections.optionsLabel(collection.name)}
                testID={`options-collection-${collection.id}`}
              >
                <MoreIcon size={16} tint={color.encre} />
              </Pressable>
            ) : null}
          </View>
        ))}
      </ScrollView>
      {reportable ? (
        <ReportBlockMenu
          visible={menuFor !== null}
          onClose={() => setMenuFor(null)}
          userId={userId}
          collectionId={menuFor?.id}
          onReported={() => {
            const reportedId = menuFor?.id;
            if (reportedId) setCollections((current) => withoutCollection(current, reportedId));
          }}
          // Compte bloqué : plus aucune de ses collections.
          onBlocked={() => setCollections([])}
        />
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { alignSelf: "stretch", marginTop: space.xl },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre },
  hint: { fontSize: font.caption, color: color.acier, marginTop: 2, marginBottom: space.sm },
  row: { gap: space.sm },
  card: { width: 120 },
  more: {
    position: "absolute",
    top: space.xs,
    right: space.xs,
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: color.porcelaine,
    alignItems: "center",
    justifyContent: "center",
  },
  cover: { width: 120, height: 120, borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.plinthe },
  fill: { width: "100%", height: "100%" },
  name: { fontSize: font.caption, fontWeight: "600", color: color.encre, marginTop: space.xs },
  count: { fontSize: 11.5, color: color.acier },
}));
