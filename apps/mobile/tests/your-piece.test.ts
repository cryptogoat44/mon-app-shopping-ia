import { describe, expect, it } from "vitest";
import type { SpotDraft } from "../src/lib/spot-draft";
import { yourPieceImage, yourPieceView } from "../src/lib/your-piece";

// Lot résultats lisibles : « Votre pièce », la zone montrée à Spotto, au-dessus
// de la meilleure proposition — seulement quand l'image est encore sur
// l'appareil, juste après le lancement. Rien n'est envoyé ni gardé pour elle.
const ZONE = { x: 0.25, y: 0.5, width: 0.5, height: 0.25 };

function draft(overrides: Partial<SpotDraft> = {}): SpotDraft {
  return {
    searchId: null,
    localImageUri: "file:///cache/photo.jpg",
    imageSize: { width: 1200, height: 1600 },
    crop: ZONE,
    words: null,
    ...overrides,
  };
}

describe("« Votre pièce » : présente ou non", () => {
  it("juste après le lancement : l'image de l'appareil et la zone analysée", () => {
    expect(yourPieceImage(true, draft())).toEqual({ uri: "file:///cache/photo.jpg", size: { width: 1200, height: 1600 }, crop: ZONE });
  });

  it("résultat rouvert (historique, page rechargée) : rien, même si un brouillon traîne en mémoire", () => {
    expect(yourPieceImage(false, draft())).toBeNull();
    expect(yourPieceImage(false, null)).toBeNull();
  });

  it("brouillon déjà oublié (« Fermer », autre onglet) : rien", () => {
    expect(yourPieceImage(true, null)).toBeNull();
  });

  it("aucune image : rien", () => {
    expect(yourPieceImage(true, draft({ localImageUri: null }))).toBeNull();
  });

  it("zone connue mais taille de l'image inconnue : rien plutôt qu'une mauvaise zone", () => {
    expect(yourPieceImage(true, draft({ imageSize: null }))).toBeNull();
    expect(yourPieceImage(true, draft({ imageSize: { width: 0, height: 0 } }))).toBeNull();
  });

  it("sans zone (image entière analysée) : l'image entière, même sans sa taille", () => {
    expect(yourPieceImage(true, draft({ crop: null }))).toEqual({ uri: "file:///cache/photo.jpg", size: { width: 1200, height: 1600 }, crop: null });
    expect(yourPieceImage(true, draft({ crop: null, imageSize: null }))).toEqual({ uri: "file:///cache/photo.jpg", size: null, crop: null });
  });
});

describe("« Votre pièce » : vignette de la seule zone analysée", () => {
  it("le cadre prend les proportions de la zone, sans dépasser la taille prévue", () => {
    // Zone de 600 × 400 pixels : plus large que haute.
    const view = yourPieceView({ uri: "file:///p.jpg", size: { width: 1200, height: 1600 }, crop: ZONE }, 56, 70);
    expect(view.frame.width).toBe(56);
    expect(view.frame.height).toBeCloseTo(56 / 1.5);
    // L'image entière est décalée pour que seule la zone paraisse dans le cadre.
    expect(view.image).not.toBeNull();
    expect(view.image!.left).toBeCloseTo(-0.25 * view.image!.width);
    expect(view.image!.top).toBeCloseTo(-0.5 * view.image!.height);
  });

  it("zone haute et étroite : limitée en hauteur", () => {
    const view = yourPieceView({ uri: "file:///p.jpg", size: { width: 1000, height: 1000 }, crop: { x: 0, y: 0, width: 0.2, height: 0.8 } }, 56, 70);
    expect(view.frame.height).toBe(70);
    expect(view.frame.width).toBeCloseTo(70 / 4);
  });

  it("sans zone : l'image entière, à ses proportions", () => {
    const view = yourPieceView({ uri: "file:///p.jpg", size: { width: 1600, height: 1200 }, crop: null }, 56, 70);
    expect(view.frame).toEqual({ width: 56, height: 42 });
    expect(view.image!.width).toBeCloseTo(56);
    expect(view.image!.height).toBeCloseTo(42);
    expect(Math.abs(view.image!.left) + Math.abs(view.image!.top)).toBe(0);
  });

  it("taille inconnue : l'image entière, contenue dans le cadre le plus grand", () => {
    expect(yourPieceView({ uri: "file:///p.jpg", size: null, crop: null }, 56, 70)).toEqual({ frame: { width: 56, height: 70 }, image: null });
  });
});
