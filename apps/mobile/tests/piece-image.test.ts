import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { imageAfterErrors, imageSources, keepHdImage, twoStepLayers, twoStepSources, type TwoStepState } from "../src/lib/piece-image";

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
    // La petite case ne change pas (grille des résultats : la 4G).
    expect(twoStepSources("small", HD, THUMB)).toBeNull();
    // Retours du build 2 : la grande carte et les fiches aussi, en deux temps.
    expect(twoStepSources("large", HD, THUMB)).toEqual({ thumb: THUMB, hd: HD });
    expect(twoStepSources("large", null, THUMB)).toBeNull();
    expect(twoStepSources("large", HD, HD)).toBeNull();
  });

  it("les cartes « Autres propositions » (et les compléments, mêmes cartes) passent en deux temps", () => {
    const card = readFileSync(join(__dirname, "../src/components/proposal-card.tsx"), "utf8");
    expect(card.match(/size="card"/g)).toHaveLength(2);
    expect(card).not.toContain('size="small"');
    const image = readFileSync(join(__dirname, "../src/components/spot-image.tsx"), "utf8");
    // L'originale arrivée remplace la vignette ; bloquée par le marchand, la vignette reste.
    expect(image).toContain('onLoad={(event) => update({ hd: "loaded", hdWidth: event.source?.width ?? null })}');
    expect(image).toContain('onError={() => update({ hd: "failed" })}');
    expect(image).toContain("onLoad={(event) => update({ thumbLoaded: true, thumbWidth: event.source?.width ?? null })}");
    expect(image).toContain("const { showThumb, showHd } = twoStepLayers(current);");
    // Les images déjà vues restent en mémoire et sur le disque.
    expect(image.match(/cachePolicy="memory-disk"/g)?.length).toBeGreaterThanOrEqual(3);
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

// Retours du build 2 (24 novembre 2026) : « quand je reviens dans ma wishlist
// la qualité est très mauvaise ». La plus nette des deux images, jamais la
// plus petite ; les grilles des Envies et du Vault en deux temps.
const state = (patch: Partial<TwoStepState>): TwoStepState => ({ hd: "loading", hdWidth: null, thumbLoaded: false, thumbWidth: null, thumbFailed: false, ...patch });

describe("la plus nette des deux images, jamais la plus petite", () => {
  it("refusé : une « originale » plus étroite que la vignette ne la remplace pas", () => {
    expect(keepHdImage(200, 280)).toBe(false);
    expect(twoStepLayers(state({ hd: "loaded", hdWidth: 200, thumbLoaded: true, thumbWidth: 280 }))).toEqual({ showThumb: true, showHd: false });
  });

  it("permis : une originale aussi large ou plus large remplace la vignette", () => {
    expect(keepHdImage(1200, 280)).toBe(true);
    expect(keepHdImage(280, 280)).toBe(true);
    expect(twoStepLayers(state({ hd: "loaded", hdWidth: 1200, thumbLoaded: true, thumbWidth: 280 }))).toEqual({ showThumb: false, showHd: true });
  });

  it("largeur inconnue : l'originale est gardée (jamais retirée sur un doute)", () => {
    expect(keepHdImage(null, 280)).toBe(true);
    expect(keepHdImage(1200, undefined)).toBe(true);
    expect(keepHdImage(0, 0)).toBe(true);
    expect(twoStepLayers(state({ hd: "loaded", hdWidth: null, thumbLoaded: true, thumbWidth: null }))).toEqual({ showThumb: false, showHd: true });
  });

  it("la vignette tout de suite ; elle reste sous l'originale tant qu'elle n'est pas arrivée (pour comparer)", () => {
    expect(twoStepLayers(state({}))).toEqual({ showThumb: true, showHd: true });
    expect(twoStepLayers(state({ hd: "loaded", hdWidth: 1200 }))).toEqual({ showThumb: true, showHd: true });
    // Vignette en échec : l'originale seule.
    expect(twoStepLayers(state({ hd: "loaded", hdWidth: 1200, thumbFailed: true }))).toEqual({ showThumb: false, showHd: true });
  });

  it("originale bloquée par le marchand : la vignette reste", () => {
    expect(twoStepLayers(state({ hd: "failed", thumbLoaded: true, thumbWidth: 280 }))).toEqual({ showThumb: true, showHd: false });
  });
});

describe("grilles des Envies et du Vault en deux temps ; la grille des résultats ne change pas", () => {
  const src = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");

  it("les vignettes des Envies et du Vault du profil : « card » (vignette, puis l'originale si plus nette)", () => {
    const panel = src("components/wishlist-panel.tsx");
    expect(panel).toContain('fit="cover" size="card" accessibilityLabel={item.name}');
    expect(panel).not.toContain('size="small"');
    const profile = src("app/(app)/(tabs)/profile/index.tsx");
    expect(profile).toContain('fit="cover" size="card" accessibilityLabel={item.title}');
  });

  it("la fiche d'une envie : le cadre de la pièce charge en « large » (deux temps), sans taille imposée", () => {
    const frame = src("components/product-frame.tsx");
    expect(frame).toContain("<SpotImage");
    expect(frame).not.toMatch(/size="(small|card)"/);
  });
});

// Contre-lecture du lot : « large » en deux temps par défaut faisait charger
// la photo entière (1600 px) dans chaque case des grilles de publications
// (Lifestyle du profil, profil d'un ami, publications enregistrées), en plus
// de la miniature de 480 px. Ces grilles restent sur une seule image : la
// miniature, la photo entière seulement en repli.
describe("grilles de publications : la miniature d'abord, jamais la photo entière en plus", () => {
  const src = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
  const MINI = "https://cdn.example/mini-480.jpg";
  const FULL = "https://cdn.example/photo-1600.jpg";

  it("refusé : en « large », la photo entière passée en repli serait chargée en premier (deux temps)", () => {
    expect(twoStepSources("large", MINI, FULL)).toEqual({ thumb: FULL, hd: MINI });
  });

  it("permis : en « small », une seule image, la miniature d'abord, la photo entière seulement après un échec", () => {
    expect(twoStepSources("small", FULL, MINI)).toBeNull();
    expect(imageSources("small", FULL, MINI)).toEqual([MINI, FULL]);
  });

  it("les trois grilles passent « small » avec la photo entière en hdUri, jamais en premier", () => {
    const grids: Array<[string, string]> = [
      ["app/(app)/(tabs)/profile/index.tsx", "fallbackUri={post.mediaThumbUrl ?? post.mediaUrl}"],
      ["app/(app)/profil.tsx", "fallbackUri={post.mediaThumbUrl ?? post.mediaHdUrl ?? post.mediaUrl}"],
      ["app/(app)/enregistrees.tsx", "fallbackUri={post.mediaThumbUrl ?? post.mediaHdUrl ?? post.mediaUrl}"],
    ];
    for (const [path, fallback] of grids) {
      const code = src(path).replace(/\s+/g, " ");
      expect(code, path).toContain(`<SpotImage size="small" hdUri={post.mediaUrl} ${fallback}`);
      expect(code, path).not.toContain("fallbackUri={post.mediaUrl}");
    }
  });
});
