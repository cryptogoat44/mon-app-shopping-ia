import { useState } from "react";
import { AccessibilityInfo, Platform, Pressable, Text, View } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { track } from "@/lib/analytics";
import type { IndexedPiece } from "@/lib/result-sections";
import type { ClickPlacement } from "@/lib/price-first";
import { ProposalCard } from "@/components/proposal-card";
import { themedStyles } from "@/theme/themed-styles";

// Prix d'abord (décision du fondateur du 2026-11-03) : les propositions de la
// recherche visuelle sans prix, en dernier, repliées derrière un bouton qui
// dit combien il y en a. Le bouton ne bouge pas : la liste s'ouvre dessous,
// précédée du texte qui dit ce que sont ces pièces (noPriceText). VoiceOver :
// état « déplié » sur le bouton, et ce qui change est dit (iPhone ; sur le
// site, le lecteur d'écran lit l'état du bouton). L'écran la rend toujours :
// elle reste ouverte même si la grande carte la vide un moment.

export function NoPriceSection({
  pieces,
  onSelect,
  placements,
}: {
  /** Propositions sans prix, sans celle montrée en grand ; `index` désigne la liste complète de l'écran. */
  pieces: IndexedPiece[];
  onSelect: (index: number) => void;
  /** Place de chaque proposition à l'écran, pour les statistiques du clic (lib/price-first.ts). */
  placements: ReadonlyMap<number, ClickPlacement>;
}) {
  const [open, setOpen] = useState(false);
  if (pieces.length === 0) return null;
  const count = pieces.length;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) track("no_price_results_opened", { results_count: count });
    // En file d'attente : dit après ce que VoiceOver lit déjà, sans le couper.
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibilityWithOptions(next ? t.result.withoutPriceShown(count) : t.result.withoutPriceHidden(count), { queue: true });
    }
  }

  return (
    <>
      {/* État « déplié » : accessibilityState pour l'iPhone ; aria-expanded aussi, que le site
          (react-native-web ignore accessibilityState) donne au lecteur d'écran. */}
      <Pressable
        style={styles.toggle}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        testID="sans-prix"
      >
        <Text style={styles.toggleLabel}>{open ? t.result.hideWithoutPrice(count) : t.result.showWithoutPrice(count)}</Text>
      </Pressable>
      {open ? (
        <>
          <Text style={styles.caption}>{t.result.noPriceText}</Text>
          <View style={styles.grid}>
            {pieces.map(({ piece, index }) => (
              <ProposalCard key={piece.id} piece={piece} onSelect={() => onSelect(index)} placement={placements.get(index)} />
            ))}
          </View>
        </>
      ) : null}
    </>
  );
}

// Même bouton que « Voir plus », séparé de la section du dessus comme un
// titre de section ; même grille que « Autres propositions ».
const styles = themedStyles(() => ({
  toggle: {
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginTop: space.xl,
  },
  toggleLabel: { color: color.encre, fontSize: font.body, fontWeight: "500", textAlign: "center" },
  caption: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginTop: space.md },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: space.lg, marginTop: space.md },
}));
