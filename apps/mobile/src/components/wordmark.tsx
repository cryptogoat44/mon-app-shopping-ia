import { Text } from "react-native";
import { APP_NAME_DISPLAY, APP_WORDMARK } from "@/constants/brand";
import { wordmarkMetrics, type WordmarkSize } from "@/lib/wordmark";
import { color, serifFont } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

// Mot-symbole de l'app (logo « Maison », choisi par le fondateur le
// 2026-11-17) : le nom en capitales très espacées, dans la police éditoriale.
// Le nom n'est jamais écrit ici : il vient de constants/brand.ts (MARQUE.md).
//
// Lu à voix haute, c'est le nom tel qu'on le prononce : sans libellé,
// VoiceOver épellerait les capitales une à une. `heading` : le mot est le
// titre de l'écran (écran Bienvenue) ; sinon il est annoncé comme une image
// qui porte ce nom, la façon d'annoncer un logo sur l'iPhone comme sur le site.

const METRICS = {
  large: wordmarkMetrics("large", APP_WORDMARK.length),
  small: wordmarkMetrics("small", APP_WORDMARK.length),
} as const;

export function Wordmark({ size = "large", heading = false }: { size?: WordmarkSize; heading?: boolean }) {
  return (
    <Text style={[styles.mark, METRICS[size]]} accessibilityRole={heading ? "header" : "image"} accessibilityLabel={APP_NAME_DISPLAY}>
      {APP_WORDMARK}
    </Text>
  );
}

// Couleur du texte principal : clair sur sombre, sombre sur clair, selon le thème.
const styles = themedStyles(() => ({
  mark: { fontFamily: serifFont, fontWeight: "500", color: color.encre, textAlign: "center" },
}));
