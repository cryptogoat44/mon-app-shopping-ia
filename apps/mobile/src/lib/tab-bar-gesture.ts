// Barre d'onglets maison (retours du build 2, point 8 : « comme sur
// Instagram, on laisse son doigt et ça glisse d'un onglet à l'autre ») : la
// logique pure du glissé, lue par components/tab-bar.tsx et par les tests.
// Le doigt posé sur la barre puis déplacé de moins de TAP_SLOP points reste
// un toucher ordinaire ; au-delà, c'est un glissé : la pastille suit le
// doigt et lever le doigt ouvre l'onglet sous lui, jamais le « + ».

/** En dessous de ce déplacement horizontal (en points), c'est un toucher. */
export const TAP_SLOP = 10;

/** Au-delà de cette hauteur (en points) au-dessus de la rangée, lever le
 * doigt n'ouvre rien : le doigt est parti dans le contenu. */
export const LIFT_MARGIN = 24;

/** Le doigt a-t-il assez bougé de côté (et plus de côté que vers le haut ou
 * le bas) pour commencer un glissé ? Un pouce qui part faire défiler le
 * contenu en dérivant un peu de côté n'est pas un glissé. */
export function isSlide(dx: number, dy: number): boolean {
  return Math.abs(dx) >= TAP_SLOP && Math.abs(dx) > Math.abs(dy);
}

/** Le doigt est-il levé bien au-dessus de la rangée (dont le haut est à
 * `rowTop`, même repère que `y`) ? Alors le glissé n'ouvre rien. */
export function liftedAbove(y: number, rowTop: number): boolean {
  return y < rowTop - LIFT_MARGIN;
}

/** L'onglet sous le doigt : `x` est compté depuis le bord gauche de la rangée
 * d'onglets, de largeur `width`, partagée en `count` places égales. Hors de la
 * rangée, la place du bord le plus proche. */
export function tabIndexAt(x: number, width: number, count: number): number {
  if (count <= 0 || width <= 0) return 0;
  const index = Math.floor((x / width) * count);
  return Math.min(count - 1, Math.max(0, index));
}

/** Ce qu'un glissé peut ouvrir : l'onglet sous le doigt, sauf les places qui
 * ne s'ouvrent qu'au toucher (le « + » de la publication) : null. */
export function slideTarget(index: number, tapOnly: ReadonlySet<number>): number | null {
  return tapOnly.has(index) ? null : index;
}
