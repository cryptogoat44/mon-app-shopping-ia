import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { color, font, radius, size, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { t } from "@/i18n";
import type { ResultSort, ResultView } from "@/lib/result-sort";
import { useReduceMotion } from "@/lib/use-hero-reveal";
import { CheckIcon, ChevronIcon } from "@/components/icons";
import { themedStyles } from "@/theme/themed-styles";

// Tri des résultats (2026-11-08, lib/result-sort.ts) : « Pertinence »,
// « Prix croissant », « Prix décroissant », la ligne « N offres · à partir de
// X € » et le filtre « Avec prix seulement ». Annoncés comme un groupe de
// boutons radio et un interrupteur ; sur le site, l'état passe par
// aria-checked (react-native-web ignore accessibilityState). Zones tactiles
// de 44 points au moins, sans zone élargie invisible (le site l'ignore).
// Lot « fidélité aux maquettes » (décision 11, maquette « Écrin » 4) : une
// seule ligne de pastilles — le tri choisi (« Pertinence ⌄ ») ouvre une
// feuille avec les trois tris en boutons radio, puis « Avec prix » et
// « En stock » (libellés visibles courts, contenus dans leur nom lu) ; puis
// la ligne des prix. Aucun tri ni filtre ne disparaît.

function sortOptions(): { value: ResultSort; label: string }[] {
  return [
    { value: "relevance", label: t.result.sortRelevance },
    { value: "price_asc", label: t.result.sortPriceAsc },
    { value: "price_desc", label: t.result.sortPriceDesc },
  ];
}

export function ResultSortBar({
  view,
  onChange,
  summary,
  stockShown = false,
}: {
  view: ResultView;
  onChange: (view: ResultView) => void;
  summary: string | null;
  /** « En stock seulement » : quand une offre dit son stock, ou qu'il est déjà choisi (lib/result-sort.ts, stockFilterShown). */
  stockShown?: boolean;
}) {
  return (
    <View style={styles.bar} testID="result-sort-bar">
      <View style={styles.filters}>
        <SortMenuButton view={view} onChange={onChange} />
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: view.withPriceOnly }}
          aria-checked={view.withPriceOnly}
          accessibilityLabel={t.result.withPriceOnly}
          accessibilityHint={t.result.withPriceOnlyHint}
          onPress={() => onChange({ ...view, withPriceOnly: !view.withPriceOnly })}
          style={styles.chipZone}
          testID="with-price-only"
        >
          <View style={[styles.chip, view.withPriceOnly ? styles.chipActive : null]}>
            <Text style={[styles.chipLabel, view.withPriceOnly ? styles.chipLabelActive : null]} numberOfLines={1}>
              {view.withPriceOnly ? "✓ " : ""}
              {t.result.withPriceShort}
            </Text>
          </View>
        </Pressable>
        {stockShown ? <InStockOnlyToggle view={view} onChange={onChange} /> : null}
      </View>
      {/* Mise à jour à l'arrivée des boutiques : annoncée sans couper (site, Android). */}
      <Text style={styles.summary} accessibilityLiveRegion="polite" testID="price-summary">
        {summary ?? ""}
      </Text>
    </View>
  );
}

/** La pastille du tri : le tri choisi, pleine, et sa feuille. Deux touches
 * pour changer de tri (les deux filtres restent à une touche). La feuille
 * garde le groupe radio d'avant ; toucher une ligne la ferme toujours (celui
 * qui vérifie le tri, ou confirme la ligne cochée avec VoiceOver, n'a pas à
 * chercher le fond) ; le tri ne change que si le choix est nouveau. Site :
 * le Modal de react-native-web (Échap ferme) ; jamais la feuille d'actions d'iOS (absente du site). */
function SortMenuButton({ view, onChange }: { view: ResultView; onChange: (view: ResultView) => void }) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReduceMotion();
  const close = () => setOpen(false);
  const current = sortOptions().find((option) => option.value === view.sort) ?? sortOptions()[0];
  return (
    <>
      <Pressable
        style={styles.chipZone}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t.result.sortMenuLabel(current.label)}
        accessibilityState={{ expanded: open }}
        testID="sort-menu"
      >
        <View style={[styles.chip, styles.chipActive]}>
          <Text style={[styles.chipLabel, styles.chipLabelActive]} numberOfLines={1}>
            {current.label}
          </Text>
          <View accessible={false}>
            <ChevronIcon direction="down" size={14} tint={color.blanc} strokeWidth={1.7} />
          </View>
        </View>
      </Pressable>
      {open ? (
        <Modal visible transparent animationType={reduceMotion ? "none" : "slide"} onRequestClose={close}>
          <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel={t.common.close} />
          <View style={styles.sheet} accessibilityViewIsModal>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {t.result.sortLabel}
            </Text>
            <View accessibilityRole="radiogroup" accessibilityLabel={t.result.sortLabel}>
              {sortOptions().map((option) => {
                const selected = option.value === view.sort;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    aria-checked={selected}
                    accessibilityLabel={option.label}
                    onPress={() => { if (!selected) onChange({ ...view, sort: option.value }); close(); }}
                    style={styles.option}
                    testID={`sort-${option.value}`}
                  >
                    <Text style={[styles.optionLabel, selected ? styles.optionLabelSelected : null]}>{option.label}</Text>
                    {selected ? (
                      <View accessible={false}>
                        <CheckIcon size={16} tint={color.encre} strokeWidth={2} />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

/** « En stock seulement » (lot « stock visible ») : à côté de « Avec prix
 * seulement », sur la même ligne de pastilles (dessous si la place manque :
 * écran de 320 points, grand texte). Retire les offres que Google disait
 * épuisées au moment de la recherche ; garde celles au stock inconnu (le
 * libellé lu par VoiceOver le dit). Même interrupteur, mêmes zones tactiles. */
export function InStockOnlyToggle({ view, onChange }: { view: ResultView; onChange: (view: ResultView) => void }) {
  const checked = view.inStockOnly === true;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked }}
      aria-checked={checked}
      accessibilityLabel={t.result.inStockOnly}
      accessibilityHint={t.result.inStockOnlyHint}
      onPress={() => onChange({ ...view, inStockOnly: !checked })}
      style={styles.chipZone}
      testID="in-stock-only"
    >
      <View style={[styles.chip, checked ? styles.chipActive : null]}>
        <Text style={[styles.chipLabel, checked ? styles.chipLabelActive : null]} numberOfLines={1}>
          {checked ? "✓ " : ""}
          {t.result.inStockShort}
        </Text>
      </View>
    </Pressable>
  );
}

/** « En stock seulement » choisi et plus aucune proposition à montrer (avec
 * ou sans « Avec prix seulement ») : le dire, et proposer de retirer les
 * filtres, plutôt qu'une page vide. */
export function FiltersEmpty({ onShowAll }: { onShowAll: () => void }) {
  return (
    <View style={styles.empty} testID="filters-empty">
      <Text style={styles.emptyText}>{t.result.filtersEmpty}</Text>
      <Pressable style={styles.emptyButton} onPress={onShowAll} accessibilityRole="button">
        <Text style={styles.emptyButtonLabel}>{t.result.showAllWithoutFilters}</Text>
      </Pressable>
    </View>
  );
}

/** « Avec prix seulement » et aucune proposition avec prix (pour l'instant :
 * les boutiques peuvent encore en apporter) : le dire, et proposer de tout
 * afficher, plutôt qu'une page vide. */
export function WithPriceOnlyEmpty({ onShowAll }: { onShowAll: () => void }) {
  return (
    <View style={styles.empty} testID="with-price-only-empty">
      <Text style={styles.emptyText}>{t.result.noPriceTitle}</Text>
      <Pressable style={styles.emptyButton} onPress={onShowAll} accessibilityRole="button">
        <Text style={styles.emptyButtonLabel}>{t.result.showAllProposals}</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => ({
  bar: { marginBottom: 12 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs },
  // Zone tactile de 44 points autour d'une pastille de 32 (maquette « Écrin » 4).
  chipZone: { minHeight: size.touchTarget, justifyContent: "center", flexShrink: 0 },
  chip: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.filet,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  chipActive: { backgroundColor: color.vert, borderColor: color.vert },
  chipLabel: { fontSize: font.caption, fontWeight: "500", color: color.encre },
  chipLabelActive: { color: color.blanc },
  summary: { fontSize: font.caption, lineHeight: 18, color: color.acier, fontWeight: "400", marginTop: space.xs },
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: {
    backgroundColor: color.porcelaine,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingBottom: space.xl,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  handle: { width: size.sheetHandle.width, height: size.sheetHandle.height, borderRadius: radius.full, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.sm },
  sheetTitle: { fontSize: font.body, fontWeight: "600", color: color.encre, marginBottom: space.xs },
  option: { minHeight: size.touchTarget, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  optionLabel: { fontSize: font.secondary, color: color.encre },
  optionLabelSelected: { fontWeight: "500" },
  empty: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.sm, padding: space.md, marginBottom: space.md },
  emptyText: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  emptyButton: { minHeight: size.touchTarget, justifyContent: "center", marginTop: space.xs },
  emptyButtonLabel: { ...lienSouligne, fontSize: font.caption, color: color.vert, fontWeight: "600" },
}));
