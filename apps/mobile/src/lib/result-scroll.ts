// Comparer sans remonter (lot résultats lisibles) : choisir une autre
// proposition ne ramène plus la page en haut d'office. Elle ne remonte, en
// douceur, que si la grande image n'est plus assez visible pour voir le
// changement. Logique pure, testée.

/** Partie de la page à l'écran : décalage du défilement et hauteur visible. */
export interface Viewport {
  scrollY: number;
  height: number;
}

/** Place d'un bloc dans la page (haut et hauteur, en points). */
export interface Area {
  top: number;
  height: number;
}

function visibleHeight(viewport: Viewport, area: Area): number {
  const top = Math.max(viewport.scrollY, area.top);
  const bottom = Math.min(viewport.scrollY + viewport.height, area.top + area.height);
  return Math.max(0, bottom - top);
}

/** Vrai quand moins de la moitié de la grande image est à l'écran (moitié de
 * l'écran s'il est plus petit qu'elle), ou quand sa place n'est pas encore
 * connue : il faut alors remonter pour voir la proposition choisie. */
export function shouldRevealHero(viewport: Viewport, hero: Area): boolean {
  if (hero.height <= 0 || viewport.height <= 0) return true;
  return visibleHeight(viewport, hero) < Math.min(hero.height, viewport.height) / 2;
}
