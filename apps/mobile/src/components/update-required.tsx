import { Linking, Pressable, Text } from "react-native";
import { t } from "@/i18n";
import { ConnectingScreen } from "@/components/connecting";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

// Lot « app iPhone prête » (chantier 4, point 11) : ce build est sous le
// minimum réglé sur le serveur. L'écran remplace toute l'app : rien d'autre
// n'est possible avant la mise à jour. Le bouton ouvre la fiche de Spotto sur
// l'App Store quand le serveur en donne l'adresse ; sinon, la marche à suivre.
export function UpdateRequiredScreen({ storeUrl }: { storeUrl: string | null }) {
  return (
    <ConnectingScreen>
      <Text style={styles.title} accessibilityRole="header">
        {t.appUpdate.title}
      </Text>
      <Text style={styles.body}>{t.appUpdate.body}</Text>
      {storeUrl ? (
        <Pressable style={styles.cta} onPress={() => void Linking.openURL(storeUrl).catch(() => {})} accessibilityRole="link">
          <Text style={styles.ctaLabel}>{t.appUpdate.openStore}</Text>
        </Pressable>
      ) : (
        <Text style={styles.body}>{t.appUpdate.searchStore}</Text>
      )}
    </ConnectingScreen>
  );
}

const styles = themedStyles(() => ({
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, lineHeight: 30 },
  body: { fontSize: font.secondary, color: color.acier, marginTop: space.sm, lineHeight: 21 },
  cta: { backgroundColor: color.vert, borderRadius: radius.md, paddingVertical: space.md, alignItems: "center", marginTop: space.xl },
  ctaLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
}));
