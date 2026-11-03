import { useEffect } from "react";
import { AccessibilityInfo, Platform, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { getActiveLocale } from "@/i18n";
import { noticeText, type LimitsNotice } from "@/lib/search-limits";
import { themedStyles } from "@/theme/themed-styles";

// Lot limites annoncées (2026-11-03) : Spotter en pause ou part du jour
// épuisée, dit AVANT de choisir une photo (accueil) ou de la cadrer — un
// encadré annoncé aux lecteurs d'écran, sans couleur d'erreur (rien n'a
// échoué). Les dernières recherches du jour : une ligne discrète.
export function SearchLimitsNotice({ notice, style }: { notice: LimitsNotice | null; style?: StyleProp<ViewStyle> }) {
  const text = notice ? noticeText(notice, Date.now(), getActiveLocale()) : null;
  const spoken = text && notice?.kind !== "low" ? [text.title, text.body].filter(Boolean).join(" ") : null;

  // VoiceOver ignore les zones annoncées (Android seulement) : dit une fois, à l'apparition.
  useEffect(() => {
    if (spoken && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(spoken);
  }, [spoken]);

  if (!notice || !text) return null;
  // Le style reçu (marges, place dans l'écran) est un style de bloc : il va sur
  // un conteneur, jamais sur le texte (la CI, avec les types de routes Expo, le refuse).
  if (notice.kind === "low")
    return (
      <View style={style}>
        <Text style={styles.low}>{text.title}</Text>
      </View>
    );
  return (
    <View style={[styles.box, style]} accessibilityLiveRegion="polite" testID="search-limits-notice">
      <Text style={styles.title} accessibilityRole="header">
        {text.title}
      </Text>
      {text.body ? <Text style={styles.body}>{text.body}</Text> : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  box: { backgroundColor: color.surface, borderColor: color.filet, borderWidth: 1, borderRadius: radius.md, padding: space.md, marginTop: space.md },
  title: { fontSize: font.secondary, color: color.encre, fontWeight: "600", lineHeight: 21 },
  body: { fontSize: font.caption, color: color.acier, marginTop: space.xs, lineHeight: 18 },
  low: { fontSize: font.caption, color: color.acier, marginTop: space.sm, lineHeight: 18 },
}));
