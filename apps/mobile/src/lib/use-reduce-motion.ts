import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** « Réduire les animations » est-il activé sur le téléphone (ou dans le
 * navigateur, prefers-reduced-motion) ? Suivi en direct : le réglage changé
 * pendant que l'app est ouverte s'applique tout de suite. Inconnu : false. */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduceMotion(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);
  return reduceMotion;
}
