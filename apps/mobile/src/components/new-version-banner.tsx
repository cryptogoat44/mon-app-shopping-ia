import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { color, font, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { entryScriptOf, isNewVersion } from "@/lib/site-version";
import { themedStyles } from "@/theme/themed-styles";

/** Une vérification au plus par minute. */
const MIN_INTERVAL_MS = 60_000;

/** Site seulement : quand on revient sur l'onglet (il redevient visible, ou
 * la fenêtre reprend la main), la page en ligne est relue sans cache et
 * comparée à celle qui est chargée. Aucune vérification à intervalle
 * régulier : rien ne tourne quand personne ne regarde. */
function useNewVersionAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const script = document.querySelector('script[src*="/_expo/static/js/web/entry-"]');
    const loaded = entryScriptOf(script?.getAttribute("src") ?? "");
    if (!loaded) return;
    let last = 0;
    async function check() {
      if (document.visibilityState !== "visible" || Date.now() - last < MIN_INTERVAL_MS) return;
      last = Date.now();
      try {
        const response = await fetch(`/?version=${last}`, { cache: "no-store" });
        if (response.ok && isNewVersion(loaded, entryScriptOf(await response.text()))) setAvailable(true);
      } catch {
        // Hors ligne : nouvel essai au prochain retour sur l'onglet.
      }
    }
    const onChange = () => void check();
    document.addEventListener("visibilitychange", onChange);
    window.addEventListener("focus", onChange);
    return () => {
      document.removeEventListener("visibilitychange", onChange);
      window.removeEventListener("focus", onChange);
    };
  }, []);
  return available;
}

/** Bandeau discret en haut du site : « Nouvelle version disponible. Recharger ». */
export function NewVersionBanner() {
  const available = useNewVersionAvailable();
  if (!available) return null;
  return (
    <View style={styles.bar} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <View style={styles.inner}>
        <Text style={styles.text}>{t.siteVersion.available}</Text>
        <Pressable onPress={() => window.location.reload()} style={styles.action} accessibilityRole="button">
          <Text style={styles.actionLabel}>{t.siteVersion.reload}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  bar: { backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.filet, paddingHorizontal: space.lg },
  inner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, maxWidth: 480, width: "100%", alignSelf: "center" },
  text: { flex: 1, fontSize: font.caption, color: color.encre, lineHeight: 18 },
  action: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" },
  actionLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
}));
