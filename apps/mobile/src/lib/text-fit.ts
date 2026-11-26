// Lot « finitions de l'œil » : un texte tient-il sur une ligne ? Logique pure,
// pour décider d'une mise en page AVANT de dessiner (rangée d'actions du
// Résultat, boutons de la fiche d'une envie, textes d'attente des champs),
// sans mesure qui ferait sauter l'écran. La largeur d'un texte est estimée
// d'après son nombre de caractères : 0,48 fois la taille de la police par
// caractère, un peu plus que la police système de l'iPhone et du site
// (« Je l'ai achetée » en 12 points : 83 points mesurés sur le site, 86,4
// estimés). L'estimation est volontairement large : dans le doute, la mise en
// page « grand texte » (plus de place), jamais un mot coupé.

/** Largeur d'un caractère, en fois la taille de la police (estimation large). */
export const CHAR_WIDTH_EM = 0.48;

/** Largeur estimée (points) d'un texte d'une ligne, à la taille du texte de l'appareil. */
export function estimatedTextWidth(text: string, fontSize: number, fontScale: number): number {
  return [...text].length * CHAR_WIDTH_EM * fontSize * Math.max(1, fontScale || 1);
}

/** Le texte tient-il sur une ligne dans `available` points ? */
export function fitsOnOneLine(text: string, fontSize: number, fontScale: number, available: number): boolean {
  return available > 0 && estimatedTextWidth(text, fontSize, fontScale) <= available;
}

/** Largeur du contenu des écrans de pièce (Résultat, fiche d'une envie) : 16 points de chaque côté, 480 au plus. */
export function contentWidth(windowWidth: number, maxWidth = 480, gutter = 16): number {
  return Math.min(windowWidth, maxWidth) - 2 * gutter;
}

/** Rangée soudée « Garder / Je l'ai achetée / Partager / Plus » (spot/result.tsx) : en deux rangées de deux dès qu'un
 * libellé ne tient plus sur une ligne dans sa case (quart de la rangée dans son cadre d'un point, moins le filet
 * de séparation ; aucune marge intérieure sur les côtés), selon la largeur ET la taille du texte. `cells` : 4
 * (ou 3 sans « Plus »). Libellés en 12 points. */
export const ACTION_LABEL_SIZE = 12;
export function actionsInTwoRows(windowWidth: number, fontScale: number, labels: readonly string[], cells = 4): boolean {
  const cell = (contentWidth(windowWidth) - 2) / cells - 1;
  return labels.some((label) => !fitsOnOneLine(label, ACTION_LABEL_SIZE, fontScale, cell));
}

/** Fiche d'une envie : « Je l'ai achetée » et « Créer une alerte » l'un sous l'autre dès que l'un des deux ne tient
 * plus sur une ligne dans sa moitié (bouton : filet, 12 points de marge de chaque côté, pictogramme de 18 et 8
 * d'écart ; 8 points entre les deux boutons). Libellés en 15 points. */
export const PAIR_LABEL_SIZE = 15;
export function pairStacked(windowWidth: number, fontScale: number, labels: readonly string[]): boolean {
  if (labels.length < 2) return false;
  const half = (contentWidth(windowWidth) - 8) / 2;
  const available = half - 2 - 24 - 18 - 8;
  return labels.some((label) => !fitsOnOneLine(label, PAIR_LABEL_SIZE, fontScale, available));
}

/** Texte d'attente d'un champ : le long s'il tient dans la largeur mesurée du champ, sinon le court (jamais coupé au
 * milieu d'une lettre). Largeur inconnue (0, pas encore mesurée) : le court si le texte est agrandi, sinon le long. */
export function placeholderFor(long: string, short: string, fieldWidth: number, fontSize: number, fontScale: number): string {
  if (!(fieldWidth > 0)) return fontScale > 1 ? short : long;
  return fitsOnOneLine(long, fontSize, fontScale, fieldWidth) ? long : short;
}
