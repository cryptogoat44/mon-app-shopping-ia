import type { ComponentType } from "react";
import { Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { TagIcon, VideoIcon } from "@/components/icons";
import { themedStyles } from "@/theme/themed-styles";

/** Les quatre coins du cadre « Entourez la pièce ». */
function FrameIcon({ size = 18, tint }: { size?: number; tint: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path d="M3 6.5V3h3.5M11.5 3H15v3.5M15 11.5V15h-3.5M6.5 15H3v-3.5" stroke={tint} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Pause et capture, cadre, boutique : une icône par étape.
const STEP_ICONS: ComponentType<{ size?: number; tint: string }>[] = [VideoIcon, FrameIcon, TagIcon];

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
