import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FLOATING_BAR, tabBarSpace } from "./tab-bar-metrics";

/** Espace du bas des listes des quatre onglets : la barre flottante passe
 * par-dessus le contenu, la dernière ligne doit pouvoir remonter au-dessus
 * d'elle (même calcul que la pilule, lib/tab-bar-metrics.ts). À donner au
 * `paddingBottom` du contenu et à `scrollIndicatorInsets.bottom`. */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return tabBarSpace(insets.bottom, Platform.OS === "web" ? FLOATING_BAR.webHeight : FLOATING_BAR.height);
}
