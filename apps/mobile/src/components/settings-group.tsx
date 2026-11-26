import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";
import { color, font, getActiveScheme, radius, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { surtitre } from "@/theme/surtitre";
import { themedStyles } from "@/theme/themed-styles";

// Blocs groupés de Réglages, à la façon d'iOS (lot « fidélité aux maquettes »,
// maquette « Écrin » 7) : un surtitre en capitales, puis une carte
// `color.surface` aux coins doux (filet très fin en thème clair seulement),
// des lignes de 44 pt séparées par un filet, les explications en 13 pt acier
// sous leur ligne, DANS la carte (ce sont des textes visibles, jamais de
// simples indices VoiceOver : choix éclairé, information RGPD). Mêmes
// composants, mêmes textes : seule la présentation change.
//
// `settingsGroupValues()` donne les valeurs brutes (calculées pour le thème
// en cours) : un composant de Réglages les reprend dans sa propre feuille
// (`label: g.label`), ce qui garde ses noms de styles ; `settingsGroup` est la
// feuille toute faite.
interface SettingsGroupValues {
  section: ViewStyle;
  label: TextStyle;
  card: ViewStyle;
  row: ViewStyle;
  rowTitle: TextStyle;
  hint: TextStyle;
  divider: ViewStyle;
  link: TextStyle;
  linkRow: ViewStyle;
  choice: ViewStyle;
}

export function settingsGroupValues(): SettingsGroupValues {
  return {
    section: { marginTop: space.md },
    label: { ...surtitre, color: color.acier, paddingHorizontal: 4, paddingBottom: space.sm },
    card: {
      backgroundColor: color.surface,
      borderRadius: radius.md,
      borderCurve: "continuous",
      overflow: "hidden",
      paddingHorizontal: space.md,
      borderWidth: getActiveScheme() === "light" ? StyleSheet.hairlineWidth : 0,
      borderColor: color.filet,
    },
    row: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
    rowTitle: { flex: 1, flexShrink: 1, fontSize: font.secondary, color: color.encre, fontWeight: "400" },
    hint: { fontSize: font.caption, lineHeight: 18, color: color.acier, paddingBottom: 12 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.filet },
    link: { ...lienSouligne, fontSize: font.secondary, color: color.vert, fontWeight: "400" },
    linkRow: { minHeight: 44, justifyContent: "center" },
    // Pastilles (« Qui peut… », Langue, Apparence) posées dans une carte : un peu d'air autour.
    choice: { paddingVertical: 12 },
  };
}

export const settingsGroup = themedStyles(settingsGroupValues);
