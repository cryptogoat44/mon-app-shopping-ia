import { describe, expect, it } from "vitest";
import { avatarColorIndex, avatarColors, avatarInitials } from "../src/lib/avatar-look";
import { avatarBackgrounds, darkPalette, lightPalette } from "../src/theme/tokens";

// Lot « profil et icône des réglages » : sans photo, les initiales de la
// personne sur une couleur stable, lisible dans les deux thèmes.

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

const ids = Array.from({ length: 400 }, (_, i) => `${(i * 2654435761 % 0xffffffff).toString(16).padStart(8, "0")}-0000-4000-8000-${String(i).padStart(12, "0")}`);

describe("initiales", () => {
  it("1 ou 2 lettres : premier et dernier mot du nom affiché", () => {
    expect(avatarInitials("Camille Durand", "camille")).toBe("CD");
    expect(avatarInitials("Camille", "camille")).toBe("C");
    expect(avatarInitials("Jean-Pierre de la Fontaine", null)).toBe("JF");
    expect(avatarInitials("  marie   claire  ", null)).toBe("MC");
    expect(avatarInitials("o'neil", null)).toBe("ON");
  });

  it("accents gardés, en majuscule ; lettres décomposées recomposées", () => {
    expect(avatarInitials("élodie", null)).toBe("É");
    expect(avatarInitials("Ève Œuvray", null)).toBe("ÈŒ");
    expect(avatarInitials("élise", null)).toBe("É");
    expect(avatarInitials("ßtraße", null)).toBe("S");
    expect(avatarInitials("Ζωή Παππά", null)).toBe("ΖΠ");
    expect(avatarInitials("王小明", null)).toBe("王");
  });

  it("émojis sautés ; sans lettre dans le nom, celles du nom d'utilisateur ; sinon rien (silhouette)", () => {
    expect(avatarInitials("🌸 Camille ✨", "x")).toBe("C");
    expect(avatarInitials("👩🏽‍🎤 Léa Martin 🇫🇷", "x")).toBe("LM");
    expect(avatarInitials("🌸✨", "camille_d")).toBe("CD");
    expect(avatarInitials("", "noa")).toBe("N");
    expect(avatarInitials(null, "007")).toBe("0");
    expect(avatarInitials("🌸", "")).toBe("");
    expect(avatarInitials(undefined, undefined)).toBe("");
  });

  it("jamais plus de 2 caractères visibles", () => {
    for (const name of ["Anne Marie Louise Durand", "𝒜lice 𝒷ob", "ǆemal ǈubo"]) expect(Array.from(avatarInitials(name, null)).length).toBeLessThanOrEqual(2);
  });
});

describe("couleur stable, tirée de l'identifiant", () => {
  it("toujours la même pour un compte, dans les deux thèmes au même rang", () => {
    for (const id of ids.slice(0, 20)) {
      expect(avatarColorIndex(id)).toBe(avatarColorIndex(id));
      const index = avatarColorIndex(id);
      expect(avatarColors(id, "light").background).toBe(avatarBackgrounds.light[index]);
      expect(avatarColors(id, "dark").background).toBe(avatarBackgrounds.dark[index]);
    }
    // Valeur figée : un changement du calcul changerait la couleur de tout le monde.
    expect([avatarColorIndex(""), avatarColorIndex("a"), avatarColorIndex("b")]).toEqual([5, 4, 5]);
    expect(avatarColorIndex("a0000000-0000-4000-8000-000000000001")).toBe(7);
  });

  it("les comptes se répartissent sur toutes les couleurs", () => {
    const counts = new Array(avatarBackgrounds.light.length).fill(0);
    for (const id of ids) counts[avatarColorIndex(id)] += 1;
    expect(counts.every((count) => count > ids.length / avatarBackgrounds.light.length / 3)).toBe(true);
  });

  it("deux palettes de même taille, sans doublon", () => {
    expect(avatarBackgrounds.light.length).toBe(avatarBackgrounds.dark.length);
    for (const list of [avatarBackgrounds.light, avatarBackgrounds.dark]) expect(new Set(list).size).toBe(list.length);
  });
});

describe("contraste des initiales (WCAG), thèmes clair et sombre", () => {
  it("au moins 4,5:1 (AA texte normal, donc aussi AA grand texte) pour chaque couleur", () => {
    for (const [scheme, palette] of [["light", lightPalette], ["dark", darkPalette]] as const) {
      const ratios = avatarBackgrounds[scheme].map((background) => contrast(background, palette.blanc));
      expect(Math.min(...ratios), scheme).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("les couleurs rendues par avatarColors respectent ce contraste pour tous les comptes", () => {
    for (const id of ids) {
      for (const scheme of ["light", "dark"] as const) {
        const { background, text } = avatarColors(id, scheme);
        expect(contrast(background, text)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("la pastille se détache du fond de l'écran (au moins 3:1, comme un élément graphique)", () => {
    for (const [scheme, palette] of [["light", lightPalette], ["dark", darkPalette]] as const) {
      for (const background of avatarBackgrounds[scheme]) expect(contrast(background, palette.porcelaine)).toBeGreaterThanOrEqual(3);
    }
  });
});
