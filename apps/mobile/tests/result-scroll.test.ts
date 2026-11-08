import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sectionArrivedAbove, shouldRevealHero } from "../src/lib/result-scroll";

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

// Prix d'abord, relecture E2 : « Résultats pour vos mots » apparaissent
// d'eux-mêmes. La page les amène en haut de l'écran quand ils arrivent
// au-dessus de la partie visible (section « Sans prix » dépliée, la personne
// en bas, au champ « Que cherchez-vous ? ») ; sinon elle reste où elle est :
// la personne a pu toucher une carte pendant l'attente, passée en grand en
// haut de l'écran (relecture indépendante : la page sautait loin d'elle).
describe("« Résultats pour vos mots » arrivés : la page bouge seulement s'ils sont au-dessus de l'écran", () => {
  it("section « Sans prix » dépliée, la personne en bas : la section arrive au-dessus, la page l'amène en haut", () => {
    expect(sectionArrivedAbove({ scrollY: 3200, height: PHONE }, 1450)).toBe(true);
  });

  it("carte touchée pendant l'attente, page en haut sur la grande carte : la section arrive plus bas, la page ne bouge pas", () => {
    expect(sectionArrivedAbove({ scrollY: 0, height: PHONE }, 1450)).toBe(false);
  });

  it("section déjà à l'écran : la page ne bouge pas", () => {
    expect(sectionArrivedAbove({ scrollY: 1200, height: PHONE }, 1450)).toBe(false);
    expect(sectionArrivedAbove({ scrollY: 1450, height: PHONE }, 1450)).toBe(false);
  });

  it("l'écran Résultat n'y défile plus sans condition (spot/result.tsx, onWordsLayout)", () => {
    const source = readFileSync(join(__dirname, "../src/app/(app)/spot/result.tsx"), "utf8");
    const body = source.slice(source.indexOf("function onWordsLayout("), source.indexOf("function scrollToWithoutPrice("));
    expect(body).toContain("heroReveal.revealArrivedSection(y)");
    expect(body).not.toContain("scrollToSection(");
  });
});
