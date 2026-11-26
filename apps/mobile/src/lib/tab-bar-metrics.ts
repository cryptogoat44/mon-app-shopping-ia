// Barre du bas flottante (retours du build 3, point 5 : « quelque chose comme
// Instagram… légèrement transparent mais très très légèrement et pas collé
// aux bords de l'iPhone ») : les mesures de la pilule, en logique pure, lues
// par components/tab-bar.tsx, par l'espace laissé sous les listes des quatre
// onglets (lib/use-tab-bar-space.ts), par le bandeau d'annonces et par les
// tests. Maquettes « Écrin » (1-accueil, 7-reglages) : pilule de 60 pt, à
// 16 pt des côtés, environ 26 pt du bas sur un iPhone à Face ID.

export const FLOATING_BAR = {
  /** Hauteur de la pilule sur le téléphone. */
  height: 60,
  /** Sur le site : 62, comme la barre d'avant (libellés jamais coupés). */
  webHeight: 62,
  /** Écart à gauche et à droite (en plus de la zone sûre des côtés). */
  side: 16,
  /** Site large : la pilule ne s'étire pas (même largeur que les contenus). */
  maxWidth: 480,
  /** La pilule reste au-dessus du trait d'accueil d'iOS : elle descend dans
   * la zone sûre du bas, mais s'arrête à 8 pt au-dessus de son haut. */
  aboveHomeIndicator: 8,
  /** Jamais à moins de 12 pt du bord (iPhone à bouton, site). */
  minBottom: 12,
  /** Air entre la dernière ligne d'une liste et le haut de la pilule. */
  contentGap: 16,
} as const;

/** Distance entre le bas de l'écran et le bas de la pilule : iPhone à Face ID
 * (zone du bas de 34 pt) → 26 ; sans zone du bas → 12 ; jamais sous 12. */
export function barBottom(insetBottom: number): number {
  const inset = Number.isFinite(insetBottom) && insetBottom > 0 ? insetBottom : 0;
  return Math.max(FLOATING_BAR.minBottom, inset - FLOATING_BAR.aboveHomeIndicator);
}

/** Espace à laisser sous le contenu d'un onglet pour que sa dernière ligne
 * remonte entièrement au-dessus de la pilule. */
export function tabBarSpace(insetBottom: number, height: number = FLOATING_BAR.height): number {
  return barBottom(insetBottom) + height + FLOATING_BAR.contentGap;
}

/** Position de la pilule : 16 pt de chaque côté (plus la zone sûre des côtés,
 * iPhone couché), 480 de large au plus, toujours centrée. */
export function barFrame(windowWidth: number, insetSide: number): { left: number; width: number } {
  const window = Number.isFinite(windowWidth) && windowWidth > 0 ? windowWidth : 0;
  const inset = Number.isFinite(insetSide) && insetSide > 0 ? insetSide : 0;
  const width = Math.max(0, Math.min(window - 2 * (FLOATING_BAR.side + inset), FLOATING_BAR.maxWidth));
  return { left: (window - width) / 2, width };
}
