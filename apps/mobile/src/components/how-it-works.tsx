import type { ComponentType } from "react";
import { Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { TagIcon, VideoIcon } from "@/components/icons";
import { themedStyles } from "@/theme/themed-styles";

/** Un rond tracé à main levée, qui se chevauche : « entourez la pièce » (lot entourer la pièce). */
function LoopIcon({ size = 18, tint }: { size?: number; tint: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path d="M6.6 4.2A6.5 5 0 1 1 3.6 6.5C4.6 4 7.8 2.4 11.8 2.9" stroke={tint} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Pause et capture, tracé autour de la pièce, boutique : une icône par étape.
const STEP_ICONS: ComponentType<{ size?: number; tint: string }>[] = [VideoIcon, LoopIcon, TagIcon];

/** Tant qu'aucune pièce n'a été spottée (lot « premier essai ») : le geste en
 * trois étapes, avec des icônes et du texte seulement — jamais d'image
 * d'exemple, ni de vraie recherche (chaque recherche coûte). */
export function HowItWorksCard() {
  return (
    <View style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">
        {t.firstTry.howItWorks.title}
      </Text>
      {t.firstTry.howItWorks.steps(t.spotter.addPhoto).map((text, index) => {
        const Icon = STEP_ICONS[index] ?? TagIcon;
        return (
          <View key={index} style={styles.step} accessible accessibilityLabel={`${index + 1}. ${text}`}>
            <View style={styles.icon}>
              <Icon size={18} tint={color.vert} />
            </View>
            <Text style={styles.text}>{text}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = themedStyles(() => ({
  card: { marginTop: space.xxl - space.xs, borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md, gap: space.md },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.body, color: color.encre },
  step: { flexDirection: "row", alignItems: "center", gap: space.md },
  icon: { width: 36, height: 36, borderRadius: radius.full, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, fontSize: font.secondary, color: color.encre, lineHeight: 21 },
}));
