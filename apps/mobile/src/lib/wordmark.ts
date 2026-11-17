// Mot-symbole de l'app (logo « Maison », choisi par le fondateur le
// 2026-11-17) : le nom en capitales très espacées, dans la police éditoriale.
// Ici, les seuls calculs (taille, espacement) ; l'affichage est dans
// components/wordmark.tsx, le texte dans constants/brand.ts (APP_WORDMARK).
import { font } from "../theme/tokens";

/** « large » : écran Bienvenue ; « small » : en-tête d'un écran. */
export type WordmarkSize = "large" | "small";

/** Espace ajouté après chaque capitale, en part de la taille du texte
 * (« 0,32 em » sur le logo validé). */
export const WORDMARK_TRACKING = 0.32;

/** Hauteur de ligne, en part de la taille du texte : assez pour que l'iPhone
 * ne coupe pas l'accent d'une capitale, si le nom en porte un jour (voir
 * serifLineHeight, theme/tokens.ts). */
const LINE_HEIGHT = 1.4;

/** Place prise par une capitale, en part de la taille du texte : sa largeur
 * (0,69 en moyenne dans Bodoni Moda Medium), puis l'espace qui la suit. */
const LETTER_WIDTH = 0.69 + WORDMARK_TRACKING;

// `maxWidth` : la largeur que le mot ne dépasse pas — pour « large », celle du
// plus étroit des écrans (320 points) moins les marges de l'écran Bienvenue.
// `minFontSize` : en dessous, les capitales ne se lisent plus.
const SIZES: Record<WordmarkSize, { fontSize: number; maxWidth: number; minFontSize: number }> = {
  large: { fontSize: font.display, maxWidth: 256, minFontSize: 20 },
  small: { fontSize: font.secondary, maxWidth: 160, minFontSize: 11 },
};

export interface WordmarkMetrics {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  /** Même valeur que `letterSpacing` : l'espace ajouté après la DERNIÈRE
   * capitale décalerait le mot vers la gauche ; le même espace devant lui le
   * recentre à l'œil. */
  paddingLeft: number;
}

/** Réglages du mot-symbole pour un nom de `letters` signes. Le nom de l'app
 * changera (MARQUE.md) : un nom plus long s'écrit plus petit, pour tenir sur
 * une ligne, sans descendre sous la taille lisible. */
export function wordmarkMetrics(size: WordmarkSize, letters: number): WordmarkMetrics {
  const { fontSize: wanted, maxWidth, minFontSize } = SIZES[size];
  const fitting = Math.floor(maxWidth / (Math.max(1, letters) * LETTER_WIDTH));
  const fontSize = Math.max(minFontSize, Math.min(wanted, fitting));
  const letterSpacing = Math.round(fontSize * WORDMARK_TRACKING * 100) / 100;
  return { fontSize, lineHeight: Math.ceil(fontSize * LINE_HEIGHT), letterSpacing, paddingLeft: letterSpacing };
}
