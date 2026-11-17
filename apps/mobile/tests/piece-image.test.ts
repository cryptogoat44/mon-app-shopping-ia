import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { imageAfterErrors, imageSources, twoStepSources } from "../src/lib/piece-image";

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

describe("carte des résultats : chargement en deux temps", () => {
  it("la vignette d'abord, l'originale ensuite, quand les deux existent et diffèrent", () => {
    expect(twoStepSources("card", HD, THUMB)).toEqual({ thumb: THUMB, hd: HD });
    // Une seule image, ou la même adresse : chargée comme dans une petite case.
    expect(twoStepSources("card", null, THUMB)).toBeNull();
    expect(twoStepSources("card", HD, "")).toBeNull();
    expect(twoStepSources("card", HD, HD)).toBeNull();
    expect(imageSources("card", null, THUMB)).toEqual([THUMB]);
    // Les autres cases ne changent pas.
    expect(twoStepSources("small", HD, THUMB)).toBeNull();
    expect(twoStepSources("large", HD, THUMB)).toBeNull();
  });

  it("les cartes « Autres propositions » (et les compléments, mêmes cartes) passent en deux temps", () => {
    const card = readFileSync(join(__dirname, "../src/components/proposal-card.tsx"), "utf8");
    expect(card.match(/size="card"/g)).toHaveLength(2);
    expect(card).not.toContain('size="small"');
    const image = readFileSync(join(__dirname, "../src/components/spot-image.tsx"), "utf8");
    // L'originale arrivée remplace la vignette ; bloquée par le marchand, la vignette reste.
    expect(image).toContain('onLoad={() => update({ hd: "loaded" })}');
    expect(image).toContain('onError={() => update({ hd: "failed" })}');
    expect(image).toContain('current.hd !== "loaded" && !current.thumbFailed');
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
