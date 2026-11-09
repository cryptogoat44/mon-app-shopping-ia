import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import type { IndexedPiece } from "@/lib/result-sections";
import { withoutPriceShown, type ClickPlacement } from "@/lib/price-first";
import { ProposalCard } from "@/components/proposal-card";
import type { SendAction } from "@/lib/send-to-friend";
import { themedStyles } from "@/theme/themed-styles";

// Prix d'abord (décision du fondateur du 2026-11-03) : les propositions de la
// recherche visuelle sans prix, en dernier, repliées derrière un bouton qui
// dit combien il y en a, sous un titre de section (relecture E5 : à l'œil
// comme à la navigation par titres de VoiceOver, elle ne se confond plus avec
// la section du dessus). Le bouton ne bouge pas : la liste s'ouvre dessous,
// précédée du texte qui dit ce que sont ces pièces (noPriceText), 12 cartes
// d'emblée puis son propre « Voir plus » (relecture E6). VoiceOver : état
// « déplié » sur le bouton. L'écran garde l'état ouvert (result.tsx : « Ce
// n'est pas la bonne pièce ? » peut aussi l'ouvrir), dit ce qui change et la
// rend toujours : elle reste ouverte même si la grande carte la vide un moment.

export function NoPriceSection({
  pieces,
  open,
  onToggle,
  caption = true,
  onSelect,
  placements,
  sendAction,
}: {
  /** Propositions sans prix, sans celle montrée en grand ; `index` désigne la liste complète de l'écran. */
  pieces: IndexedPiece[];
  open: boolean;
  onToggle: () => void;
  /** Texte d'explication sous le bouton ; pas quand le même texte est déjà en haut de l'écran (NoPriceNotice). */
  caption?: boolean;
  onSelect: (index: number) => void;
  /** Place de chaque proposition à l'écran, pour les statistiques du clic (lib/price-first.ts). */
  placements: ReadonlyMap<number, ClickPlacement>;
  /** « Envoyer à un ami » de chaque carte, sur sa propre pièce (lib/send-to-friend.ts). */
  sendAction?: SendAction;
}) {
  const [showAll, setShowAll] = useState(false);
  if (pieces.length === 0) return null;
  const count = pieces.length;
  const { visible, hiddenCount } = withoutPriceShown(pieces, showAll);

  return (
    <>
      <Text style={styles.title} accessibilityRole="header">
        {t.result.withoutPriceTitle}
      </Text>
      {/* État « déplié » : accessibilityState pour l'iPhone ; aria-expanded aussi, que le site
          (react-native-web ignore accessibilityState) donne au lecteur d'écran. */}
      <Pressable
        style={styles.toggle}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        testID="sans-prix"
      >
        <Text style={styles.toggleLabel}>{open ? t.result.hideWithoutPrice(count) : t.result.showWithoutPrice(count)}</Text>
      </Pressable>
      {open ? (
        <>
          {caption ? <Text style={styles.caption}>{t.result.noPriceText}</Text> : null}
          <View style={styles.grid}>
            {visible.map(({ piece, index }) => (
              <ProposalCard key={piece.id} piece={piece} onSelect={() => onSelect(index)} placement={placements.get(index)} onSend={sendAction?.(piece)} />
            ))}
          </View>
          {hiddenCount > 0 ? (
            <Pressable style={styles.more} onPress={() => setShowAll(true)} accessibilityRole="button">
              <Text style={styles.toggleLabel}>{t.result.showMore(hiddenCount)}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </>
  );
}

// Même titre que les autres sections ; mêmes boutons que « Voir plus » ;
// même grille que « Autres propositions ».
const styles = themedStyles(() => ({
  title: { fontSize: font.body, fontWeight: "600", color: color.encre, marginTop: space.xl, marginBottom: space.md },
  toggle: {
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  more: {
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginTop: space.sm,
  },
  toggleLabel: { color: color.encre, fontSize: font.body, fontWeight: "500", textAlign: "center" },
  caption: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginTop: space.md },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: space.lg, marginTop: space.md },
}));
