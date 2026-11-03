import { describe, expect, it } from "vitest";
import { shouldRevealHero } from "../src/lib/result-scroll";

// Lot résultats lisibles : choisir une proposition ne ramène plus la page en
// haut d'office ; elle ne remonte que si la grande image n'est plus assez
// visible pour voir le changement.
const HERO = { top: 110, height: 430 };
const PHONE = 716;

describe("choisir une proposition : remonter seulement si besoin", () => {
  it("grande image entièrement à l'écran : la page ne bouge pas", () => {
    expect(shouldRevealHero({ scrollY: 0, height: PHONE }, HERO)).toBe(false);
  });

  it("au moins la moitié de la grande image à l'écran : la page ne bouge pas", () => {
    // Sur un grand écran (site), la grille et la grande image se voient ensemble.
    expect(shouldRevealHero({ scrollY: 110 + 215, height: PHONE }, HERO)).toBe(false);
  });

  it("moins de la moitié visible : la page remonte", () => {
    expect(shouldRevealHero({ scrollY: 110 + 216, height: PHONE }, HERO)).toBe(true);
  });

  it("descendu dans la grille, grande image hors de l'écran : la page remonte", () => {
    expect(shouldRevealHero({ scrollY: 1200, height: PHONE }, HERO)).toBe(true);
  });

  it("écran plus petit que la grande image (iPhone à l'horizontale) : la moitié de l'écran suffit", () => {
    expect(shouldRevealHero({ scrollY: 110, height: 300 }, HERO)).toBe(false);
    expect(shouldRevealHero({ scrollY: 110 + 430 - 149, height: 300 }, HERO)).toBe(true);
  });

  it("place de la grande image pas encore connue : la page remonte, comme avant", () => {
    expect(shouldRevealHero({ scrollY: 0, height: PHONE }, { top: 0, height: 0 })).toBe(true);
    expect(shouldRevealHero({ scrollY: 0, height: 0 }, HERO)).toBe(true);
  });
});
