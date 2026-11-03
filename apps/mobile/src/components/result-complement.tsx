import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { TextSearchStatus } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { COMPLEMENT_SHOWN_FIRST, firstShown, type IndexedPiece } from "@/lib/result-sections";
import { ProposalCard } from "@/components/proposal-card";
import { themedStyles } from "@/theme/themed-styles";

// Voie C (lot c) : une section du complément, sous les propositions de la
// recherche visuelle — jamais à leur place. « ai » : la même pièce dans
// d'autres boutiques (requête tirée des titres des propositions) ; « words » :
// la recherche lancée avec les mots de la personne. Même grille et mêmes
// cartes que « Autres propositions » (components/proposal-card.tsx), 6
// d'emblée puis son propre « Voir plus ». Ni nom de fournisseur, ni « IA »
// (décision du fondateur du 2026-10-21).

/** Issue de la recherche par les mots quand elle n'a rien montré : une phrase,
 * sous les résultats ou après « rien trouvé » ; null sinon. */
export function textSearchStatusNote(textStatus: TextSearchStatus | null | undefined): string | null {
  if (textStatus === "empty") return t.result.textSearchEmpty;
  if (textStatus === "shopping_failed") return t.result.textSearchFailed;
  return null;
}

export function ResultComplement({
  source,
  others,
  query,
  textStatus,
  onSelect,
}: {
  source: "ai" | "words";
  /** Propositions de la section, sans celle montrée en grand ; `index` désigne la liste complète de l'écran. */
  others: IndexedPiece[];
  /** Section « ai » : requête envoyée (réponse du lancement seulement). */
  query?: string | null;
  /** Section « words » : issue de la recherche par les mots, pour dire qu'elle n'a rien donné. */
  textStatus?: TextSearchStatus | null;
  onSelect: (index: number) => void;
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
            <ProposalCard key={piece.id} piece={piece} onSelect={() => onSelect(index)} />
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
}));
