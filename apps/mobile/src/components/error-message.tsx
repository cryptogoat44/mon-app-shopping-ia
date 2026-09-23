import { useEffect } from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import { color } from "@/theme/tokens";

// Message d'erreur affiché à l'écran. Avant, les erreurs utilisaient le même
// gris que les libellés et n'étaient jamais annoncées aux lecteurs d'écran
// (audit Lot Q, A11Y-03). Ici : couleur d'erreur contrastée (AA), rôle
// « alerte » (web), zone annoncée (Android), annonce explicite (iOS).
export function ErrorMessage({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  useEffect(() => {
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(children);
  }, [children]);

  return (
    <Text style={[style, styles.error]} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  error: { color: color.erreur },
});
