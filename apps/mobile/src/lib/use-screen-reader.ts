import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** VoiceOver (ou un autre lecteur d'écran) est-il allumé ? Suivi en direct,
 * même forme que use-reduce-motion.ts. Inconnu : false. Sert au zoom sur
 * place (components/image-viewer.tsx) : avec VoiceOver, le pincement est
 * pris par VoiceOver lui-même ; le double toucher ouvre alors le plein
 * écran, où l'on zoome en balayant. */
export function useScreenReader(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", setEnabled);
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);
  return enabled;
}
