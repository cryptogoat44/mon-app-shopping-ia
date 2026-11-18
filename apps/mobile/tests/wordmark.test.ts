import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import marque from "@monapp/shared-types/marque.json";
import { APP_NAME_DISPLAY, APP_WORDMARK } from "../src/constants/brand";
import { WORDMARK_TRACKING, wordmarkMetrics } from "../src/lib/wordmark";
import { font } from "../src/theme/tokens";

// Lot « identité de marque » (décision du fondateur, 2026-11-17) : le logo
// « Maison » — le nom de l'app en capitales très espacées, dans la police
// éditoriale. Pas de rendu de composants ici (vitest.config.ts) : la logique
// est testée directement, l'affichage en lisant les fichiers.
const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");

afterEach(() => {
  vi.doUnmock("@monapp/shared-types/marque.json");
  vi.resetModules();
});

describe("texte du mot-symbole : le nom de l'app, en capitales", () => {
  it("vient du fichier unique de la marque, jamais d'un nom écrit en dur", () => {
    expect(APP_WORDMARK).toBe(marque.nom.toUpperCase());
    expect(APP_WORDMARK).not.toBe(APP_NAME_DISPLAY);
    expect(APP_WORDMARK.toLowerCase()).toBe(APP_NAME_DISPLAY.toLowerCase());
  });

  it("suit un changement de nom, accents compris", async () => {
    for (const [nom, attendu] of [
      ["Zorglub", "ZORGLUB"],
      ["Épée d'Or", "ÉPÉE D'OR"],
    ] as const) {
      vi.resetModules();
      vi.doMock("@monapp/shared-types/marque.json", () => ({ default: { ...marque, nom } }));
      const brand = await import("../src/constants/brand");
      expect(brand.APP_WORDMARK).toBe(attendu);
      expect(brand.APP_NAME_DISPLAY).toBe(nom);
    }
  });
});

describe("réglages du mot-symbole (taille, espacement)", () => {
  const letters = APP_WORDMARK.length;

  it("grand (écran Bienvenue) : la taille du nom de l'app, capitales espacées de 0,32 fois cette taille", () => {
    expect(WORDMARK_TRACKING).toBe(0.32);
    expect(wordmarkMetrics("large", letters)).toEqual({ fontSize: font.display, lineHeight: 50, letterSpacing: 10.88, paddingLeft: 10.88 });
  });

  it("petit (en-tête d'un écran) : la taille du texte secondaire, même proportion", () => {
    expect(wordmarkMetrics("small", letters)).toEqual({ fontSize: font.secondary, lineHeight: 22, letterSpacing: 4.8, paddingLeft: 4.8 });
  });

  it("centré à l'œil : le même espace avant le mot qu'après sa dernière capitale", () => {
    for (const size of ["large", "small"] as const) {
      for (const count of [1, 6, 12, 30]) {
        const metrics = wordmarkMetrics(size, count);
        expect(metrics.paddingLeft).toBe(metrics.letterSpacing);
        expect(metrics.letterSpacing).toBeCloseTo(metrics.fontSize * WORDMARK_TRACKING, 2);
        // La place de la plus haute capitale accentuée, même sur l'iPhone (voir tests/police.test.ts).
        expect(metrics.lineHeight).toBeGreaterThanOrEqual(metrics.fontSize * 1.448);
      }
    }
  });

  it("un nom plus long s'écrit plus petit, pour tenir sur une ligne du plus étroit des écrans", () => {
    // Une capitale et son espace : 0,69 + 0,32 fois la taille, en moyenne.
    const width = (size: "large" | "small", count: number) => count * wordmarkMetrics(size, count).fontSize * (0.69 + WORDMARK_TRACKING);
    expect(wordmarkMetrics("large", 7).fontSize).toBe(font.display);
    expect(wordmarkMetrics("large", 8).fontSize).toBeLessThan(font.display);
    for (const count of [6, 7, 8, 10, 12]) {
      expect(width("large", count), `${count} lettres`).toBeLessThanOrEqual(256);
      expect(width("small", count), `${count} lettres`).toBeLessThanOrEqual(160);
    }
    const sizes = [6, 8, 10, 12, 16].map((count) => wordmarkMetrics("large", count).fontSize);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
  });

  it("jamais sous la taille lisible, même pour un nom démesuré ou vide", () => {
    expect(wordmarkMetrics("large", 60).fontSize).toBe(20);
    expect(wordmarkMetrics("small", 60).fontSize).toBe(11);
    expect(wordmarkMetrics("large", 0).fontSize).toBe(font.display);
  });
});

describe("affichage du mot-symbole (components/wordmark.tsx)", () => {
  const component = read("components/wordmark.tsx");

  it("écrit le nom en capitales, lu à voix haute comme le nom de l'app (jamais épelé)", () => {
    expect(component).toContain("{APP_WORDMARK}");
    expect(component).toContain("accessibilityLabel={APP_NAME_DISPLAY}");
    // Un seul texte : rien d'autre n'est lu, ni lettre par lettre ni deux fois.
    expect(component.match(/<Text\b/g)).toHaveLength(1);
  });

  it("grandes tailles de texte de l'iPhone : le mot grossit au plus de 1,25 fois, pour rester sur une ligne", () => {
    expect(component).toContain("const MAX_FONT_SIZE_MULTIPLIER = 1.25;");
    expect(component).toContain("maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}");
    // Sur l'iPhone, la taille du texte grossit mais pas l'espace entre les capitales (ni celui
    // qui précède le mot) : la largeur du mot, sur le plus étroit des écrans (256 points utiles).
    const { fontSize, letterSpacing, paddingLeft } = wordmarkMetrics("large", APP_WORDMARK.length);
    const width = APP_WORDMARK.length * (fontSize * 1.25 * 0.69 + letterSpacing) + paddingLeft;
    expect(width).toBeLessThanOrEqual(256);
  });

  it("titre de l'écran sur demande ; sinon annoncé comme une image qui porte ce nom", () => {
    expect(component).toContain('accessibilityRole={heading ? "header" : "image"}');
    expect(component).toContain("heading = false");
  });

  it("police éditoriale, couleur du texte principal du thème (clair et sombre), réglages calculés avec le nom", () => {
    expect(component).toContain('mark: { fontFamily: serifFont, fontWeight: "500", color: color.encre, textAlign: "center" }');
    expect(component).toContain("themedStyles(");
    expect(component).toContain('large: wordmarkMetrics("large", APP_WORDMARK.length)');
    expect(component).toContain('small: wordmarkMetrics("small", APP_WORDMARK.length)');
    expect(component).toContain("style={[styles.mark, METRICS[size]]}");
  });
});

describe("écran Bienvenue", () => {
  const welcome = read("app/bienvenue.tsx");

  it("le mot-symbole en grand, titre de l'écran, à la place du nom en minuscules", () => {
    expect(welcome).toContain("<Wordmark size=\"large\" heading />");
    expect(welcome.match(/accessibilityRole="header"/g)).toBeNull();
    expect(welcome).not.toMatch(/APP_NAME\b/);
    expect(welcome).not.toContain("toLowerCase");
  });

  it("le logo validé n'a pas de cercle : le cercle fin a disparu", () => {
    expect(welcome).not.toMatch(/ring|RING_SIZE|borderRadius: [A-Z_]+ \/ 2/);
  });
});
