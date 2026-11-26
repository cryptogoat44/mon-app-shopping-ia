import { Pressable, Text, TextInput, View } from "react-native";
import { color, font, radius, size, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import type { Piece } from "@/api/types";
import { ClockIcon, SearchIcon } from "@/components/icons";
import { PieceTile } from "@/components/piece-tile";
import { recentDayLabel } from "@/lib/recent-searches";
import { themedStyles } from "@/theme/themed-styles";

/** Une recherche récente : sa meilleure proposition et son jour. */
export interface RecentSearch {
  searchId: string;
  createdAt: string;
  piece: Piece;
}

/** Une case de « Récemment spottées » (retours du build 3, point 7 : « deux
 * et deux côte à côte qui se suivent en descendant », « les coins arrondis
 * également sur chaque photo ») : la tuile de pièce de la grille (4:5, coins
 * doux), le nom sur deux lignes réservées, le jour et la boutique. Deux cases
 * par rangée ; toutes de même hauteur (condition de `numColumns`). Une seule
 * étiquette VoiceOver par case : la tuile n'en porte pas. Image en deux temps
 * (la vignette de la recherche, puis l'originale du marchand si elle est plus
 * nette), comme les grilles des Envies et du Vault. */
export function RecentSearchTile({ entry, column, onOpen }: { entry: RecentSearch; column: "left" | "right"; onOpen: () => void }) {
  const { piece } = entry;
  const meta = [recentDayLabel(entry.createdAt, getActiveLocale()), piece.merchantName].filter(Boolean).join(" · ");
  return (
    <Pressable
      style={({ pressed }) => [styles.cell, column === "left" ? styles.cellLeft : styles.cellRight, pressed ? styles.pressed : null]}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${piece.name}, ${meta}`}
    >
      {piece.imageUrl ? (
        <PieceTile variant="grid" size="card" hdUri={piece.imageHdUrl} fallbackUri={piece.imageUrl} edgeColor={piece.edgeColor} recyclingKey={entry.searchId} />
      ) : (
        <View style={styles.tileEmpty}>
          <ClockIcon size={22} tint={color.acier} />
        </View>
      )}
      <Text style={styles.name} numberOfLines={2}>
        {piece.name}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {meta}
      </Text>
    </Pressable>
  );
}

/** Recherche dans l'historique (lot « historique ») : sous le titre de la
 * section, caché tant que l'historique est vide. Les mots partent au serveur
 * pour filtrer vos propres recherches ; ils ne sont gardés nulle part. */
export function HistorySearchField({ value, onChangeText, onClear }: { value: string; onChangeText: (value: string) => void; onClear: () => void }) {
  return (
    <View style={styles.searchBar}>
      <View style={styles.searchIcon}>
        <SearchIcon size={18} tint={color.acier} strokeWidth={1.6} />
      </View>
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
  // Grille de deux colonnes : 12 pt entre les colonnes (6 + 6), 16 entre deux rangées.
  cell: { width: "50%", marginBottom: space.md },
  cellLeft: { paddingRight: 6 },
  cellRight: { paddingLeft: 6 },
  pressed: { opacity: 0.7 },
  tileEmpty: { width: "100%", aspectRatio: 4 / 5, backgroundColor: color.plinthe, borderRadius: radius.pieceGrid, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },
  // Deux lignes réservées : même hauteur pour toutes les cases.
  name: { fontSize: font.secondary, color: color.encre, lineHeight: 20, minHeight: 40, marginTop: space.sm },
  meta: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginTop: 2 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: size.touchTarget,
    backgroundColor: color.plinthe,
    borderRadius: radius.full,
    paddingLeft: space.md,
  },
  // Site (react-native-web) à 320 pt : sans `minWidth: 0`, le champ garde sa
  // largeur minimale de navigateur et pousse la croix hors de l'écran ; la
  // loupe et la croix ne rétrécissent jamais.
  searchIcon: { flexShrink: 0 },
  searchInput: { flex: 1, minWidth: 0, fontSize: font.secondary, color: color.encre, paddingVertical: 10 },
  clearButton: { flexShrink: 0, minWidth: size.touchTarget, minHeight: size.touchTarget, alignItems: "center", justifyContent: "center" },
  clearLabel: { fontSize: 22, color: color.acier, lineHeight: 24 },
}));
