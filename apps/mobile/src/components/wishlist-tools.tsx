import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { color, font, radius, size, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { t } from "@/i18n";
import { searchFieldOpen, type WishlistSort } from "@/lib/wishlist-view";
import { SearchIcon } from "@/components/icons";
import { themedStyles } from "@/theme/themed-styles";

// Écran Envies (2026-11-09, lib/wishlist-view.ts) : en haut de la liste, la
// recherche (nom ou boutique), le tri (« Récentes », « Prix croissant »,
// « Prix décroissant ») et la ligne du total. Le tri est annoncé comme un
// groupe de boutons radio ; sur le site, l'état passe par aria-checked
// (react-native-web ignore accessibilityState). Zones tactiles de 44 points
// au moins.
// Retours du build 2 (« ça prend beaucoup trop de place ») : une seule ligne.
// À gauche le total ; à droite une loupe, qui ouvre le champ de recherche à
// la place de la ligne, et un bouton qui montre le tri choisi en court
// (« Prix ↑ ») et ouvre les trois choix dans une petite feuille. La ligne
// passe sur deux lignes en grand texte (flexWrap, minHeight).

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
  const [searchOpened, setSearchOpened] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const searching = searchFieldOpen(searchOpened, query);
  const currentSort = sortOptions().find((option) => option.value === sort) ?? sortOptions()[0]!;

  const totalLine = total ? (
    // Change avec la recherche ou la puce : annoncée sans couper (site, Android).
    <Text style={[styles.total, searching ? styles.totalUnder : null]} accessibilityLabel={total.label} accessibilityLiveRegion="polite" testID="total-envies">
      {total.text}
    </Text>
  ) : null;

  return (
    <View style={styles.tools} testID="outils-envies">
      <View style={styles.row}>
        {searching ? (
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
              autoFocus={searchOpened}
              returnKeyType="search"
              maxLength={80}
              testID="recherche-envies"
            />
            {/* Ferme le champ et efface le texte tapé (le champ reste ouvert tant qu'un texte est là). */}
            <Pressable
              onPress={() => {
                onQueryChange("");
                setSearchOpened(false);
              }}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel={t.wishlist.searchClose}
              testID="fermer-recherche-envies"
            >
              <Text style={styles.clearLabel}>×</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.totalSlot}>{totalLine}</View>
            <Pressable
              onPress={() => setSearchOpened(true)}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel={t.wishlist.searchLabel}
              testID="ouvrir-recherche-envies"
            >
              <SearchIcon size={20} tint={color.encre} strokeWidth={1.6} />
            </Pressable>
          </>
        )}
        <Pressable
          onPress={() => setSortOpen(true)}
          style={styles.sortButton}
          accessibilityRole="button"
          accessibilityLabel={t.wishlist.sortButtonLabel(currentSort.label)}
          testID="bouton-tri-envies"
        >
          <Text style={styles.sortButtonLabel} numberOfLines={1}>
            {t.wishlist.sortShort[sort]} ▾
          </Text>
        </Pressable>
      </View>
      {searching ? totalLine : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
      <Modal visible={sortOpen} animationType="slide" transparent onRequestClose={() => setSortOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSortOpen(false)} accessibilityRole="button" accessibilityLabel={t.common.close} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle} accessibilityRole="header">
            {t.wishlist.sortLabel}
          </Text>
          <View style={styles.radios} accessibilityRole="radiogroup" accessibilityLabel={t.wishlist.sortLabel}>
            {sortOptions().map((option) => {
              const selected = option.value === sort;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  aria-checked={selected}
                  accessibilityLabel={option.label}
                  onPress={() => {
                    if (!selected) onSortChange(option.value);
                    setSortOpen(false);
                  }}
                  style={[styles.radio, selected ? styles.radioActive : null]}
                  testID={`tri-envies-${option.value}`}
                >
                  <Text style={[styles.radioLabel, selected ? styles.radioLabelActive : null]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable style={styles.closeButton} onPress={() => setSortOpen(false)} accessibilityRole="button">
            <Text style={styles.closeLabel}>{t.common.close}</Text>
          </Pressable>
        </View>
      </Modal>
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
  tools: { paddingBottom: space.sm },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.xs, minHeight: size.touchTarget },
  totalSlot: { flex: 1, minWidth: 140 },
  searchBar: {
    flex: 1,
    minWidth: 180,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: size.touchTarget,
    backgroundColor: color.plinthe,
    borderRadius: radius.full,
    paddingLeft: space.md,
  },
  searchInput: { flex: 1, fontSize: font.secondary, color: color.encre, paddingVertical: 10 },
  iconButton: { minWidth: size.touchTarget, minHeight: size.touchTarget, alignItems: "center", justifyContent: "center" },
  clearLabel: { fontSize: 22, color: color.acier, lineHeight: 24 },
  sortButton: {
    minWidth: size.touchTarget,
    minHeight: size.touchTarget,
    paddingHorizontal: space.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.filet,
    alignItems: "center",
    justifyContent: "center",
  },
  sortButtonLabel: { fontSize: font.caption, color: color.encre, fontWeight: "600" },
  total: { fontSize: font.caption, color: color.encre, fontWeight: "600", lineHeight: 18 },
  totalUnder: { marginTop: space.xs },
  note: { fontSize: font.caption, color: color.acier, marginTop: 2, lineHeight: 18 },
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: { backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.sm },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.xs },
  sheetTitle: { fontSize: font.body, fontWeight: "600", color: color.encre },
  radios: { gap: space.xs },
  radio: { minHeight: size.touchTarget, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, justifyContent: "center", paddingHorizontal: space.md },
  radioActive: { backgroundColor: color.vert, borderColor: color.vert },
  radioLabel: { fontSize: font.secondary, color: color.encre },
  radioLabelActive: { color: color.blanc, fontWeight: "600" },
  closeButton: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center", marginTop: space.xs },
  closeLabel: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  empty: { alignItems: "center", paddingHorizontal: space.md, paddingTop: space.lg },
  emptyText: { fontSize: font.secondary, color: color.acier, textAlign: "center", lineHeight: 20 },
  emptyButton: { minHeight: size.touchTarget, justifyContent: "center", paddingHorizontal: space.md, marginTop: space.xs },
  emptyButtonLabel: { ...lienSouligne, fontSize: font.secondary, color: color.vert, fontWeight: "600" },
}));
