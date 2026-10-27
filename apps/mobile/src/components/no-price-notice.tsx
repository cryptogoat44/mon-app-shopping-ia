import { useEffect } from "react";
import { AccessibilityInfo, Platform, Text, View } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { themedStyles } from "@/theme/themed-styles";

// « Aucune de ces propositions n'affiche de prix » (petit lot ; textes validés
// par le fondateur le 2026-10-21) : au-dessus des propositions, visible sans
// défilement, annoncé aux lecteurs d'écran (charte, règle 8). Il ne promet ni
// vente ni prix, et ne cache aucune proposition (charte, règle 4).
export function NoPriceNotice() {
  useEffect(() => {
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(`${t.result.noPriceTitle} ${t.result.noPriceText}`);
  }, []);

  return (
    <View style={styles.box} accessibilityLiveRegion="polite" testID="no-price-notice">
      <Text style={styles.title} accessibilityRole="header">
        {t.result.noPriceTitle}
      </Text>
      <Text style={styles.text}>{t.result.noPriceText}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  box: { backgroundColor: color.surface, borderColor: color.filet, borderWidth: 1, borderRadius: radius.sm, padding: space.md, marginBottom: space.md },
  title: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  text: { fontSize: font.caption, color: color.acier, marginTop: space.xs, lineHeight: 18 },
}));
