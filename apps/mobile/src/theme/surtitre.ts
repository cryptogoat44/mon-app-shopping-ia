import type { TextStyle } from "react-native";

// Surtitre en capitales des maquettes « Écrin » (lot « fidélité aux
// maquettes ») : « MEILLEURE PROPOSITION », « COMPTE »… Défini ici une seule
// fois : la seule taille de texte hors des jetons (11). La couleur est donnée
// par l'écran : `{ ...surtitre, color: color.acier }`. Les capitales viennent
// de `textTransform` : VoiceOver lit le texte d'origine, pas des lettres épelées.
export const surtitre: TextStyle = { fontSize: 11, lineHeight: 14, letterSpacing: 1, textTransform: "uppercase", fontWeight: "500" };
