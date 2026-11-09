import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Platform, Pressable, Text } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { firstShown, type IndexedPiece } from "@/lib/result-sections";
import { PRICE_LIST_SHOWN_FIRST } from "@/lib/result-sort";
import type { ClickPlacement } from "@/lib/price-first";
import { useReduceMotion } from "@/lib/use-hero-reveal";
import { ProposalCard } from "@/components/proposal-card";
import { themedStyles } from "@/theme/themed-styles";

// Tri par prix (2026-11-08, lib/result-sort.ts) : toutes les propositions en
// une seule liste, une ligne chacune, sans titre de section. Chaque ligne et
// son lien visent sa propre pièce (`index` : liste complète de l'écran).
// Les lignes sont rendues directement dans la page (fragment, aucun cadre
// autour) : l'écran garde la ligne regardée à sa place quand une boutique
// arrive au-dessus (maintainVisibleContentPosition, result.tsx ; le
// navigateur fait de même sur le site). Une ligne arrivée après l'affichage
// apparaît en fondu court, sans rien déplacer ; aucun fondu avec « Réduire
// les animations ».

export function PriceSortedList({
  items,
  cheapestIndex,
  onSelect,
  placements,
}: {
  items: IndexedPiece[];
  cheapestIndex: number | null;
  onSelect: (index: number) => void;
  placements: ReadonlyMap<number, ClickPlacement>;
}) {
  const [showAll, setShowAll] = useState(false);
  const reduceMotion = useReduceMotion();
  // Pièces déjà affichées dans la liste : null au premier affichage (aucun
  // fondu). Une pièce absente de cet ensemble vient d'arriver.
  const [known, setKnown] = useState<ReadonlySet<string> | null>(null);
  const ids = items.map(({ piece }) => piece.id).join("\n");
  useEffect(() => {
    setKnown((previous) => new Set([...(previous ?? []), ...ids.split("\n")]));
  }, [ids]);
  const { visible, hiddenCount } = firstShown(items, showAll, PRICE_LIST_SHOWN_FIRST);

  return (
    <>
      {visible.map(({ piece, index }) => (
        <FadeIn key={piece.id} active={known !== null && !known.has(piece.id) && !reduceMotion}>
          <ProposalCard variant="row" piece={piece} onSelect={() => onSelect(index)} placement={placements.get(index)} cheapest={index === cheapestIndex} />
        </FadeIn>
      ))}
      {hiddenCount > 0 ? (
        <Pressable style={styles.more} onPress={() => setShowAll(true)} accessibilityRole="button">
          <Text style={styles.moreLabel}>{t.result.showMore(hiddenCount)}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

/** Fondu de 220 ms à l'apparition (opacité seulement : la place de la ligne
 * est prise d'un coup, rien ne glisse). */
function FadeIn({ active, children }: { active: boolean; children: ReactNode }) {
  const opacity = useRef(new Animated.Value(active ? 0 : 1)).current;
  useEffect(() => {
    if (!active) return;
    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: Platform.OS !== "web" }).start();
  }, []);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

// Même bouton que « Voir plus » sous « Autres propositions ».
const styles = themedStyles(() => ({
  more: {
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: space.md,
  },
  moreLabel: { color: color.encre, fontSize: font.body, fontWeight: "500" },
}));
