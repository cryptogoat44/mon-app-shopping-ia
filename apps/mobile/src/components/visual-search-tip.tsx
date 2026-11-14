// Recherche d'image d'iOS (mission « liens vidéo ») : une carte « Astuce »,
// sur l'app iPhone sous iOS 26 ou suivant seulement, montrée une seule fois
// (marque rangée sur l'appareil dès qu'elle s'affiche ; stockage
// indisponible : elle n'est pas montrée, plutôt que de revenir sans fin).
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { VISUAL_SEARCH_TIP_KEY, supportsVisualSearch } from "@/lib/visual-search-link";
import { themedStyles } from "@/theme/themed-styles";

async function claimTip(): Promise<boolean> {
  try {
    if (await AsyncStorage.getItem(VISUAL_SEARCH_TIP_KEY)) return false;
    await AsyncStorage.setItem(VISUAL_SEARCH_TIP_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export function VisualSearchTip() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!supportsVisualSearch(Platform.OS, Platform.Version)) return;
    let alive = true;
    void claimTip().then((claimed) => alive && setShown(claimed));
    return () => {
      alive = false;
    };
  }, []);
  if (!shown) return null;
  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <Text style={styles.title} accessibilityRole="header">
        {t.visualSearchTip.title}
      </Text>
      <Text style={styles.body}>{t.visualSearchTip.body}</Text>
      <Pressable onPress={() => setShown(false)} style={styles.dismiss} accessibilityRole="button">
        <Text style={styles.dismissLabel}>{t.visualSearchTip.dismiss}</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => ({
  card: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md, marginTop: space.lg },
  title: { fontSize: font.caption, color: color.acier, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 },
  body: { fontSize: font.secondary, color: color.encre, lineHeight: 21, marginTop: space.xs },
  dismiss: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  dismissLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
}));
