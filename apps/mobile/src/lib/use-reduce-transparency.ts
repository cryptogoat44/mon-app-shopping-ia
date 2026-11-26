import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

/** « Réduire la transparence » est-il activé sur l'iPhone (Réglages ›
 * Accessibilité) ? Suivi en direct, comme « Réduire les animations »
 * (lib/use-reduce-motion.ts). La barre du bas flottante devient alors pleine.
 * iPhone seulement : le site (react-native-web) n'a pas cette fonction et
 * l'appeler y casserait l'écran ; ailleurs, ou inconnu : false. */
export function useReduceTransparency(): boolean {
  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let active = true;
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((value) => {
        if (active) setReduceTransparency(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setReduceTransparency);
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);
  return reduceTransparency;
}
