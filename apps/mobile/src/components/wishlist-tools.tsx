import { Pressable, Text, TextInput, View } from "react-native";
import { color, font, radius, size, space } from "@/theme/tokens";
import { t } from "@/i18n";
import type { WishlistSort } from "@/lib/wishlist-view";
import { SearchIcon } from "@/components/icons";
import { themedStyles } from "@/theme/themed-styles";

// Écran Envies (2026-11-09, lib/wishlist-view.ts) : en haut de la liste, la
// recherche (nom ou boutique), le tri en trois segments, comme sur l'écran
// Résultat (« Récentes », « Prix croissant », « Prix décroissant »), puis la
// ligne du total. Le tri est annoncé comme un groupe de boutons radio ; sur
// le site, l'état passe par aria-checked (react-native-web ignore
// accessibilityState). Zones tactiles de 44 points au moins.

function sortOptions(): { value: WishlistSort; label: string }[] {
  return [
    { value: "recent", label: t.wishlist.sortRecent },
    { value: "price_asc", label: t.wishlist.sortPriceAsc },
    { value: "price_desc", label: t.wishlist.sortPriceDesc },
  ];
}

export function WishlistTools({
  query,
  onQueryChange,
  sort,
  onSortChange,
  total,
  note,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  sort: WishlistSort;
  onSortChange: (sort: WishlistSort) => void;
  /** Ligne du total et sa version lue par VoiceOver ; null : rien à afficher. */
  total: { text: string; label: string } | null;
  /** Total calculé sur une partie des envies seulement : le dire. */
  note: string | null;
}) {
  return (
    <View style={styles.tools} testID="outils-envies">
      <View style={styles.searchBar}>
        <SearchIcon size={18} tint={color.acier} strokeWidth={1.6} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={onQueryChange}
          placeholder={t.wishlist.searchPlaceholder}
          placeholderTextColor={color.acier}
          accessibilityLabel={t.wishlist.searchLabel}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          maxLength={80}
          testID="recherche-envies"
        />
        {query.length > 0 ? (
          <Pressable
            onPress={() => onQueryChange("")}
            style={styles.clear}
            accessibilityRole="button"
            accessibilityLabel={t.wishlist.clearSearch}
            testID="effacer-recherche-envies"
          >
            <Text style={styles.clearLabel}>×</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.segments} accessibilityRole="radiogroup" accessibilityLabel={t.wishlist.sortLabel}>
        {sortOptions().map((option) => {
          const selected = option.value === sort;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              accessibilityLabel={option.label}
              onPress={() => (selected ? undefined : onSortChange(option.value))}
              style={[styles.segment, selected ? styles.segmentActive : null]}
              testID={`tri-envies-${option.value}`}
            >
              <Text style={[styles.segmentLabel, selected ? styles.segmentLabelActive : null]} numberOfLines={2}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {total ? (
        // Change avec la recherche ou la puce : annoncée sans couper (site, Android).
        <Text style={styles.total} accessibilityLabel={total.label} accessibilityLiveRegion="polite" testID="total-envies">
          {total.text}
        </Text>
      ) : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

/** Recherche sans résultat : le dire, et proposer de l'effacer. */
export function WishlistSearchEmpty({ message, onClear }: { message: string; onClear: () => void }) {
  return (
    <View style={styles.empty} testID="recherche-envies-vide">
      <Text style={styles.emptyText}>{message}</Text>
      <Pressable style={styles.emptyButton} onPress={onClear} accessibilityRole="button">
        <Text style={styles.emptyButtonLabel}>{t.wishlist.clearSearch}</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => ({
  tools: { paddingBottom: space.md },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: size.touchTarget,
    backgroundColor: color.plinthe,
    borderRadius: radius.full,
    paddingLeft: space.md,
    paddingRight: space.xs,
  },
  searchInput: { flex: 1, fontSize: font.secondary, color: color.encre, paddingVertical: 10 },
  clear: { minWidth: size.touchTarget, minHeight: size.touchTarget, alignItems: "center", justifyContent: "center" },
  clearLabel: { fontSize: 22, color: color.acier, lineHeight: 24 },
  segments: { flexDirection: "row", borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: 2, gap: 2, marginTop: space.sm },
  segment: {
    flex: 1,
    minHeight: size.touchTarget,
    borderRadius: radius.md - 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.xs,
  },
  segmentActive: { backgroundColor: color.vert },
  segmentLabel: { fontSize: font.caption, color: color.encre, textAlign: "center" },
  segmentLabelActive: { color: color.blanc, fontWeight: "600" },
  total: { fontSize: font.caption, color: color.encre, fontWeight: "600", marginTop: space.sm, lineHeight: 18 },
  note: { fontSize: font.caption, color: color.acier, marginTop: 2, lineHeight: 18 },
  empty: { alignItems: "center", paddingHorizontal: space.md, paddingTop: space.lg },
  emptyText: { fontSize: font.secondary, color: color.acier, textAlign: "center", lineHeight: 20 },
  emptyButton: { minHeight: size.touchTarget, justifyContent: "center", paddingHorizontal: space.md, marginTop: space.xs },
  emptyButtonLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
}));
