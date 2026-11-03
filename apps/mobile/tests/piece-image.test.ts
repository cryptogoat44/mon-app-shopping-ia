import { describe, expect, it } from "vitest";
import { imageAfterErrors, imageSources } from "../src/lib/piece-image";

// Lot résultats lisibles : la vignette légère de Google d'abord dans une
// petite case, l'image d'origine du marchand d'abord sur la grande carte ;
// l'autre ne sert qu'en repli.
const HD = "https://boutique.test/originale.jpg";
const THUMB = "https://encrypted-tbn0.gstatic.com/images?q=tbn:vignette";

describe("image d'une proposition selon la taille de sa case", () => {
  it("petite case : la vignette légère d'abord, l'originale en repli", () => {
    expect(imageSources("small", HD, THUMB)).toEqual([THUMB, HD]);
  });

  it("grande carte : l'originale d'abord, la vignette en repli", () => {
    expect(imageSources("large", HD, THUMB)).toEqual([HD, THUMB]);
  });

  it("une seule image connue : elle seule, quelle que soit la case", () => {
    // Complément de la voie C, pièce ajoutée à la main : pas d'originale.
    expect(imageSources("small", null, THUMB)).toEqual([THUMB]);
    expect(imageSources("large", undefined, THUMB)).toEqual([THUMB]);
    expect(imageSources("small", HD, "")).toEqual([HD]);
    expect(imageSources("large", null, "")).toEqual([]);
  });

  it("même adresse pour les deux (Google sans vignette) : jamais demandée deux fois", () => {
    expect(imageSources("small", HD, HD)).toEqual([HD]);
    expect(imageSources("large", HD, HD)).toEqual([HD]);
  });
});

describe("repli en cas d'erreur", () => {
  it("l'image suivante après un échec, plus rien après le dernier", () => {
    const sources = imageSources("small", HD, THUMB);
    expect(imageAfterErrors(sources, 0)).toBe(THUMB);
    expect(imageAfterErrors(sources, 1)).toBe(HD);
    // Toutes en échec : aucun nouvel essai, le fond de la case reste.
    expect(imageAfterErrors(sources, 2)).toBeNull();
  });

  it("grande carte : l'originale refusée par le marchand laisse place à la vignette", () => {
    const sources = imageSources("large", HD, THUMB);
    expect(imageAfterErrors(sources, 1)).toBe(THUMB);
  });

  it("aucune image : rien à afficher", () => {
    expect(imageAfterErrors([], 0)).toBeNull();
  });
});
