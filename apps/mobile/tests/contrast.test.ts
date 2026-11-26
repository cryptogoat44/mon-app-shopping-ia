import { describe, expect, it } from "vitest";
import { avatarBackgrounds, darkPalette, lightPalette, type Palette } from "../src/theme/tokens";

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

// Lot « couleurs et logo » (« Noir et ivoire », validé le 25 novembre 2026).
describe("noir et ivoire : l'accent a la couleur du texte", () => {
  it("l'accent est l'encre en clair et l'ivoire en sombre ; ce qui est posé dessus reste lisible", () => {
    expect(lightPalette.vert).toBe(lightPalette.encre);
    expect(darkPalette.vert).toBe(darkPalette.encre);
    expect(contrast(lightPalette.blanc, lightPalette.vert)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkPalette.blanc, darkPalette.vert)).toBeGreaterThanOrEqual(4.5);
    // Refusé : l'ancien « blanc » du thème clair posé sur l'ivoire ne se lirait pas.
    expect(contrast(lightPalette.blanc, darkPalette.vert)).toBeLessThan(4.5);
  });

  // Interrupteurs (theme/accent.ts) : allumé, le curseur prend `blanc` du thème.
  it("interrupteur allumé : le curseur se détache de la piste (au moins 3:1) dans les deux thèmes", () => {
    for (const palette of [lightPalette, darkPalette]) expect(contrast(palette.blanc, palette.vert)).toBeGreaterThanOrEqual(3);
    // Éteint, en sombre : curseur blanc sur le filet.
    expect(contrast(darkPalette.surImage, darkPalette.filet)).toBeGreaterThanOrEqual(3);
    // Refusé : le curseur blanc d'iOS, laissé tel quel sur la piste ivoire.
    expect(contrast("#FFFFFF", darkPalette.vert)).toBeLessThan(3);
  });

  it("le « + » de la barre du bas : or sur vert anglais (au moins 3:1, pictogramme), le même dans les deux thèmes", () => {
    expect(lightPalette.vertAnglais).toBe("#004225");
    expect(lightPalette.dorure).toBe("#D4AF37");
    expect(darkPalette.vertAnglais).toBe(lightPalette.vertAnglais);
    expect(darkPalette.dorure).toBe(lightPalette.dorure);
    expect(contrast(lightPalette.dorure, lightPalette.vertAnglais)).toBeGreaterThanOrEqual(3);
    // Il se détache du fond de la barre : par le disque en clair, par le cercle doré en sombre.
    for (const palette of [lightPalette, darkPalette]) {
      expect(Math.max(contrast(palette.vertAnglais, palette.porcelaine), contrast(palette.dorure, palette.porcelaine))).toBeGreaterThanOrEqual(3);
    }
    // Refusé : sans le disque, le cercle doré seul ne se verrait pas assez sur le fond clair.
    expect(contrast(lightPalette.dorure, lightPalette.porcelaine)).toBeLessThan(3);
  });
});

/** Teinte HSV (0-360) d'une couleur, ou null pour un gris. */
function teinte(hex: string): number | null {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.08) return null; // un gris
  return max === r ? (60 * ((g - b) / (max - min)) + 360) % 360 : max === g ? 60 * ((b - r) / (max - min)) + 120 : 60 * ((r - g) / (max - min)) + 240;
}

/** Vert clair ou pastel : teinte entre le jaune-vert et le vert d'eau, assez saturée, et claire. */
function vertClair(hex: string): boolean {
  const h = teinte(hex);
  return h !== null && h >= 75 && h <= 170 && luminance(hex) > 0.2;
}

/** Bleu-vert clair (pétrole pâle, vert d'eau) : il se lit comme un vert pâle. */
function bleuVertClair(hex: string): boolean {
  const h = teinte(hex);
  return h !== null && h > 170 && h <= 200 && luminance(hex) > 0.2;
}

/** Vert vif : saturé et lumineux (un vert « fluo »), même s'il n'est pas pâle. */
function vertVif(hex: string): boolean {
  const h = teinte(hex);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  return h !== null && h >= 75 && h <= 170 && (max - Math.min(r, g, b)) / max >= 0.5 && max >= 0.5;
}

const interdit = (hex: string) => vertClair(hex) || bleuVertClair(hex) || vertVif(hex);

describe("plus aucun vert clair à l'écran", () => {
  it("ni dans les deux palettes, ni dans les photos de profil par défaut", () => {
    const couleurs = [...Object.values(lightPalette), ...Object.values(darkPalette), ...avatarBackgrounds.light, ...avatarBackgrounds.dark].filter((valeur) => /^#[0-9A-F]{6}$/i.test(valeur));
    expect(couleurs.length).toBeGreaterThan(50);
    expect(couleurs.filter(interdit)).toEqual([]);
  });

  it("photos de profil : chacune des huit valeurs des DEUX listes est lue, aucune n'est un vert ou bleu-vert pâle ni un vert vif", () => {
    for (const liste of [avatarBackgrounds.light, avatarBackgrounds.dark]) {
      expect(liste).toHaveLength(8);
      for (const valeur of liste) {
        expect(valeur).toMatch(/^#[0-9A-F]{6}$/i);
        expect(interdit(valeur), valeur).toBe(false);
      }
    }
  });

  it("le garde-fou reconnaît l'ancienne sauge, pas le vert anglais foncé ni les gris", () => {
    expect(vertClair("#9CC3AE")).toBe(true);
    expect(vertClair("#7FCFA3")).toBe(true);
    expect(vertClair("#004225")).toBe(false);
    expect(vertClair("#F4F2EE")).toBe(false);
    expect(vertClair("#C8C38A")).toBe(false); // olive des photos de profil : un jaune sourd
  });

  it("le garde-fou refuse le bleu-vert pâle et le vert vif, et laisse le pétrole foncé, l'ardoise et le bois de rose", () => {
    expect(bleuVertClair("#9CC8CC")).toBe(true); // l'ancien pétrole du thème sombre
    expect(vertVif("#00C853")).toBe(true);
    expect(interdit("#9CC8CC")).toBe(true);
    expect(bleuVertClair("#2F5D62")).toBe(false); // pétrole foncé du thème clair : sombre et sourd
    expect(vertVif("#004225")).toBe(false); // vert anglais : profond, pas vif
    expect(interdit("#A7BBCF")).toBe(false); // ardoise : un bleu
    expect(interdit("#C4948C")).toBe(false); // bois de rose
  });
});
