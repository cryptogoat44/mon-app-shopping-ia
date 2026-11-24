import { Pressable, Text, TextInput, View } from "react-native";
import { color, font, radius, size, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import type { Piece } from "@/api/types";
import { ClockIcon, SearchIcon } from "@/components/icons";
import { SpotImage } from "@/components/spot-image";
import { recentDayLabel } from "@/lib/recent-searches";
import { themedStyles } from "@/theme/themed-styles";

/** Une recherche récente : sa meilleure proposition et son jour. */
export interface RecentSearch {
  searchId: string;
  createdAt: string;
  piece: Piece;
}

/** Une ligne de « Récemment spottées » (accueil de Spotter) : vignette, nom, jour et boutique. */
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

/** Recherche dans l'historique (lot « historique ») : sous le titre de la
 * section, caché tant que l'historique est vide. Les mots partent au serveur
 * pour filtrer vos propres recherches ; ils ne sont gardés nulle part. */
export function HistorySearchField({ value, onChangeText, onClear }: { value: string; onChangeText: (value: string) => void; onClear: () => void }) {
  return (
    <View style={styles.searchBar}>
      <SearchIcon size={18} tint={color.acier} strokeWidth={1.6} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={t.retrouverPieces.historySearchPlaceholder}
        placeholderTextColor={color.acier}
        accessibilityLabel={t.retrouverPieces.historySearchLabel}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        maxLength={60}
        testID="recherche-historique"
      />
      {value.length > 0 ? (
        <Pressable onPress={onClear} style={styles.clearButton} accessibilityRole="button" accessibilityLabel={t.retrouverPieces.historySearchClear}>
          <Text style={styles.clearLabel}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 72, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.filet },
  thumb: { width: 64, height: 64, backgroundColor: color.plinthe, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
  text: { flex: 1, gap: 2 },
  name: { fontSize: font.secondary, color: color.encre, lineHeight: 20 },
  meta: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: size.touchTarget,
    backgroundColor: color.plinthe,
    borderRadius: radius.full,
    paddingLeft: space.md,
  },
  searchInput: { flex: 1, fontSize: font.secondary, color: color.encre, paddingVertical: 10 },
  clearButton: { minWidth: size.touchTarget, minHeight: size.touchTarget, alignItems: "center", justifyContent: "center" },
  clearLabel: { fontSize: 22, color: color.acier, lineHeight: 24 },
}));
