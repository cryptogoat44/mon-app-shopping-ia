import { describe, expect, it } from "vitest";
import { darkPalette, lightPalette, type Palette } from "../src/theme/tokens";

// Contrastes AA (4,5:1 pour le texte) des couples de couleurs réellement
// utilisés, dans les deux thèmes — états désactivés compris (charte, règle 9).
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

const TEXT_PAIRS: [keyof Palette, keyof Palette][] = [
  ["encre", "porcelaine"],
  ["encre", "surface"],
  ["acier", "porcelaine"],
  ["acier", "surface"],
  ["acierSurPlinthe", "plinthe"],
  ["vert", "porcelaine"],
  ["vert", "surface"],
  ["blanc", "vert"],
  ["blanc", "encre"],
  ["erreur", "porcelaine"],
  ["danger", "porcelaine"],
  ["surInactif", "inactif"],
  ["surNuit", "nuit"],
  ["brume", "nuit"],
];

describe("contrastes AA des deux palettes (lot 3)", () => {
  for (const [name, palette] of [["clair", lightPalette], ["sombre", darkPalette]] as const) {
    it(`thème ${name}`, () => {
      const failing = TEXT_PAIRS.map(([text, background]) => ({ pair: `${text}/${background}`, ratio: contrast(palette[text], palette[background]) })).filter(
        ({ ratio }) => ratio < 4.5
      );
      expect(failing).toEqual([]);
    });
  }

  it("le fond sombre n'est jamais un noir pur", () => {
    expect(darkPalette.porcelaine).not.toBe("#000000");
    expect(luminance(darkPalette.porcelaine)).toBeGreaterThan(0.005);
  });
});
