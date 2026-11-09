import { Pressable, Text, View } from "react-native";
import { color, font, radius, size, space } from "@/theme/tokens";
import { t } from "@/i18n";
import type { ResultSort, ResultView } from "@/lib/result-sort";
import { themedStyles } from "@/theme/themed-styles";

// Tri des résultats (2026-11-08, lib/result-sort.ts) : en haut de la liste,
// trois segments (« Pertinence », « Prix croissant », « Prix décroissant »),
// puis la ligne « N offres · à partir de X € » et le filtre « Avec prix
// seulement ». Annoncés comme un groupe de boutons radio et un interrupteur ;
// sur le site, l'état passe par aria-checked (react-native-web ignore
// accessibilityState). Zones tactiles de 44 points au moins.

function sortOptions(): { value: ResultSort; label: string }[] {
  return [
    { value: "relevance", label: t.result.sortRelevance },
    { value: "price_asc", label: t.result.sortPriceAsc },
    { value: "price_desc", label: t.result.sortPriceDesc },
  ];
}

export function ResultSortBar({ view, onChange, summary }: { view: ResultView; onChange: (view: ResultView) => void; summary: string | null }) {
  return (
    <View style={styles.bar} testID="result-sort-bar">
      <View style={styles.segments} accessibilityRole="radiogroup" accessibilityLabel={t.result.sortLabel}>
        {sortOptions().map((option) => {
          const selected = option.value === view.sort;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              accessibilityLabel={option.label}
              onPress={() => (selected ? undefined : onChange({ ...view, sort: option.value }))}
              style={[styles.segment, selected ? styles.segmentActive : null]}
              testID={`sort-${option.value}`}
            >
              <Text style={[styles.segmentLabel, selected ? styles.segmentLabelActive : null]} numberOfLines={2}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.line}>
        {/* Mise à jour à l'arrivée des boutiques : annoncée sans couper (site, Android). */}
        <Text style={styles.summary} accessibilityLiveRegion="polite" testID="price-summary">
          {summary ?? ""}
        </Text>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: view.withPriceOnly }}
          aria-checked={view.withPriceOnly}
          accessibilityLabel={t.result.withPriceOnly}
          accessibilityHint={t.result.withPriceOnlyHint}
          onPress={() => onChange({ ...view, withPriceOnly: !view.withPriceOnly })}
          style={[styles.filter, view.withPriceOnly ? styles.filterActive : null]}
          testID="with-price-only"
        >
          <Text style={[styles.filterLabel, view.withPriceOnly ? styles.filterLabelActive : null]} numberOfLines={1}>
            {view.withPriceOnly ? "✓ " : ""}
            {t.result.withPriceOnly}
          </Text>
        </Pressable>
      </View>
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
  bar: { marginBottom: space.md },
  segments: { flexDirection: "row", borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: 2, gap: 2 },
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
  line: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm },
  summary: { flex: 1, fontSize: font.caption, color: color.encre, fontWeight: "600" },
  filter: {
    minHeight: size.touchTarget,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.filet,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  filterActive: { backgroundColor: color.vert, borderColor: color.vert },
  filterLabel: { fontSize: font.caption, color: color.encre },
  filterLabelActive: { color: color.blanc, fontWeight: "600" },
  empty: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.sm, padding: space.md, marginBottom: space.md },
  emptyText: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  emptyButton: { minHeight: size.touchTarget, justifyContent: "center", marginTop: space.xs },
  emptyButtonLabel: { fontSize: font.caption, color: color.vert, fontWeight: "600", textDecorationLine: "underline" },
}));
