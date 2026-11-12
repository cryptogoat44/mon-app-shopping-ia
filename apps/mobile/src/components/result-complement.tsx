import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { TextSearchStatus } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { COMPLEMENT_SHOWN_FIRST, firstShown, type IndexedPiece } from "@/lib/result-sections";
import type { ClickPlacement } from "@/lib/price-first";
import { ProposalCard } from "@/components/proposal-card";
import type { SendAction } from "@/lib/send-to-friend";
import type { StockAction } from "@/lib/wish-alerts";
import { themedStyles } from "@/theme/themed-styles";

// Voie C (lot c) : une section du complément, sous les propositions de la
// recherche visuelle — jamais à leur place. « ai » : la même pièce dans
// d'autres boutiques (requête tirée des titres des propositions) ; « words » :
// la recherche lancée avec les mots de la personne. Même grille et mêmes
// cartes que « Autres propositions » (components/proposal-card.tsx), 6
// d'emblée puis son propre « Voir plus ». Pas de nom de fournisseur (décision
// du fondateur du 2026-10-21) ; la requête de la section « ai » dit qu'elle est
// écrite par une IA (point 4.3 du document pour l'avocat, 2026-11-05).

/** Issue de la recherche par les mots quand elle n'a rien montré : une phrase,
 * sous les résultats ou après « rien trouvé » ; null sinon. */
export function textSearchStatusNote(textStatus: TextSearchStatus | null | undefined): string | null {
  if (textStatus === "empty") return t.result.textSearchEmpty;
  if (textStatus === "shopping_failed") return t.result.textSearchFailed;
  return null;
}

/** Boutiques ensuite (2026-11-08) : ligne discrète à la place de « Cette
 * pièce dans d'autres boutiques », le temps de la recherche ; elle disparaît
 * à l'arrivée des boutiques, ou sans message si rien n'est trouvé. */
export function ShopsPending() {
  return (
    <View style={styles.pending} accessibilityLiveRegion="polite" testID="shops-pending">
      <ActivityIndicator size="small" color={color.acier} />
      <Text style={styles.pendingText}>{t.result.shopsPending}</Text>
    </View>
  );
}

export function ResultComplement({
  source,
  others,
  query,
  textStatus,
  onSelect,
  placements,
  cheapestIndex = null,
  sendAction,
  stockAction,
}: {
  source: "ai" | "words";
  /** Propositions de la section, sans celle montrée en grand ; `index` désigne la liste complète de l'écran. */
  others: IndexedPiece[];
  /** Section « ai » : requête envoyée (réponse du lancement seulement). */
  query?: string | null;
  /** Section « words » : issue de la recherche par les mots, pour dire qu'elle n'a rien donné. */
  textStatus?: TextSearchStatus | null;
  onSelect: (index: number) => void;
  /** Place de chaque proposition à l'écran, pour les statistiques du clic (lib/price-first.ts). */
  placements?: ReadonlyMap<number, ClickPlacement>;
  /** Proposition marquée « Le moins cher » (lib/result-sort.ts), indice dans la liste complète de l'écran. */
  cheapestIndex?: number | null;
  /** « Envoyer à un ami » de chaque carte, sur sa propre pièce (lib/send-to-friend.ts). */
  sendAction?: SendAction;
  /** Lot 2 : « Plus disponible ? » de chaque carte, sur sa propre pièce (lib/wish-alerts.ts). */
  stockAction?: StockAction;
}) {
  const [showAll, setShowAll] = useState(false);
  const note = source === "words" && others.length === 0 ? textSearchStatusNote(textStatus) : null;
  if (others.length === 0 && !note) return null;
  const { visible, hiddenCount } = firstShown(others, showAll, COMPLEMENT_SHOWN_FIRST);

  return (
    <>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {source === "ai" ? t.result.complementTitleAi : t.result.complementTitleWords}
      </Text>
      {query ? <Text style={styles.caption}>{t.result.complementQuery(query)}</Text> : null}
      {note ? <Text style={styles.caption}>{note}</Text> : null}
      {visible.length > 0 ? (
        <View style={styles.grid}>
          {visible.map(({ piece, index }) => (
            <ProposalCard key={piece.id} piece={piece} onSelect={() => onSelect(index)} placement={placements?.get(index)} cheapest={index === cheapestIndex} onSend={sendAction?.(piece)} onReportGone={stockAction?.(piece)} />
          ))}
        </View>
      ) : null}
      {hiddenCount > 0 ? (
        <Pressable style={styles.secondary} onPress={() => setShowAll(true)} accessibilityRole="button">
          <Text style={styles.secondaryLabel}>{t.result.showMore(hiddenCount)}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

// Mêmes mesures que la grille « Autres propositions » de l'écran Résultat.
const styles = themedStyles(() => ({
  sectionTitle: { fontSize: font.body, fontWeight: "600", color: color.encre, marginTop: space.xl, marginBottom: space.md },
  caption: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginTop: -space.sm, marginBottom: space.md },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: space.lg },
  secondary: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: space.sm },
  secondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "500" },
  pending: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xl, minHeight: 24 },
  pendingText: { fontSize: font.caption, color: color.acier },
}));
