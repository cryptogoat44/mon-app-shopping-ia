import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { color, font, radius, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import type { Piece } from "@/api/types";
import { ClockIcon } from "@/components/icons";
import { SpotImage } from "@/components/spot-image";
import { recentDayLabel } from "@/lib/recent-searches";
import { themedStyles } from "@/theme/themed-styles";

/** Une recherche récente : sa meilleure proposition et son jour. */
export interface RecentSearch {
  searchId: string;
  createdAt: string;
  piece: Piece;
}

/** « Tout voir » à côté de « Récemment spottées » (lot « Retrouver ses
 * pièces ») : la liste complète, avec les jours. Sur le site, la rangée de
 * l'accueil ne défile pas à la souris (barre de défilement cachée). */
export function SeeAllRecentLink() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push("/recentes")} hitSlop={12} accessibilityRole="link" accessibilityLabel={t.retrouverPieces.seeAllLabel}>
      <Text style={styles.seeAll}>{t.retrouverPieces.seeAll}</Text>
    </Pressable>
  );
}

/** Une ligne de « Tout voir » : vignette, nom, jour et boutique. */
export function RecentSearchRow({ entry, onOpen }: { entry: RecentSearch; onOpen: () => void }) {
  const { piece } = entry;
  const meta = [recentDayLabel(entry.createdAt, getActiveLocale()), piece.merchantName].filter(Boolean).join(" · ");
  return (
    <Pressable style={styles.row} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${piece.name}, ${meta}`}>
      <View style={styles.thumb}>
        {/* Vignette de 64 points : la petite image de la recherche suffit, sans
            télécharger 20 grandes images de marchands. */}
        {piece.imageUrl ? (
          <SpotImage fallbackUri={piece.imageUrl} style={styles.fill} fit="cover" recyclingKey={entry.searchId} />
        ) : (
          <ClockIcon size={22} tint={color.acier} />
        )}
      </View>
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={2}>
          {piece.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  seeAll: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 72, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.filet },
  thumb: { width: 64, height: 64, backgroundColor: color.plinthe, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
  text: { flex: 1, gap: 2 },
  name: { fontSize: font.secondary, color: color.encre, lineHeight: 20 },
  meta: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
}));
