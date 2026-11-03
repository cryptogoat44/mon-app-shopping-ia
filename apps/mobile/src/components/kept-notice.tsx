import { useEffect } from "react";
import { AccessibilityInfo, Platform, Pressable, Text, View } from "react-native";
import { color, font, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { themedStyles } from "@/theme/themed-styles";

/** Après « Garder » (lot « premier essai ») : où va la pièce, et le lien pour
 * l'y retrouver — les Envies sont le 3ᵉ onglet du Profil, qui s'ouvre sur le
 * Vault. Annoncé aussi sur iPhone (VoiceOver ignore les zones annoncées). */
export function KeptNotice({ onOpen }: { onOpen: () => void }) {
  useEffect(() => {
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(t.firstTry.kept);
  }, []);
  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      <Text style={styles.text}>{t.firstTry.kept}</Text>
      <Pressable onPress={onOpen} hitSlop={8} style={styles.link} accessibilityRole="link">
        <Text style={styles.linkLabel}>{t.firstTry.viewWishlist}</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.md, marginTop: space.xs },
  text: { fontSize: font.caption, color: color.acier },
  link: { minHeight: 44, justifyContent: "center" },
  linkLabel: { fontSize: font.caption, color: color.vert, fontWeight: "600", textDecorationLine: "underline" },
}));
