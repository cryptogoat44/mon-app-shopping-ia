// Carrousel des photos d'une publication (components/post-carousel.tsx) : la
// logique sans écran, testée à part (tests/photos-identifications.test.ts).

/** Une place valable, de 0 à count − 1 (0 pour une liste vide). */
export function clampIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 0) return 0;
  return Math.min(Math.max(Math.round(index), 0), count - 1);
}

/** La photo montrée après un défilement : la page la plus proche. */
export function indexFromOffset(offsetX: number, pageWidth: number, count: number): number {
  if (!(pageWidth > 0)) return 0;
  return clampIndex(offsetX / pageWidth, count);
}

/** Photo suivante (+1) ou précédente (−1), sans sortir de la liste. */
export function stepIndex(index: number, delta: 1 | -1, count: number): number {
  return clampIndex(index + delta, count);
}

/** Le compteur « 2/5 » (chiffres seulement, le même dans les deux langues). */
export function counterText(index: number, count: number): string {
  return `${clampIndex(index, count) + 1}/${count}`;
}

/** Le cadre du carrousel pour les lecteurs d'écran (`position` : « Photo 2
 * sur 5 »). iPhone : un seul élément « réglable » (VoiceOver : balayer vers
 * le haut ou le bas change de photo), la position en valeur. Site : un
 * simple groupe, la position dans son libellé. Jamais « réglable » sur le
 * site : react-native-web en fait un « slider », dont le contenu est caché
 * aux lecteurs d'écran (les boutons « Photo précédente » et « Photo
 * suivante » disparaîtraient) et qui ne réagit à aucune touche. */
export function carouselFrameAccessibility(web: boolean, label: string, position: string) {
  return web
    ? { accessible: false, role: "group" as const, accessibilityLabel: `${label}, ${position}` }
    : { accessible: true, accessibilityRole: "adjustable" as const, accessibilityLabel: label };
}
