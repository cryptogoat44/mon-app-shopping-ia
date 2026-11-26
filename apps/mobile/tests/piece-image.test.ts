import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  edgeBackground,
  edgeColorApplies,
  FILL_TOLERANCE,
  fillsTile,
  HERO_MAX_POINTS_PER_PIXEL,
  honestSize,
  imageAfterErrors,
  imageSources,
  keepHdImage,
  TILE_RATIO,
  twoStepLayers,
  twoStepSources,
  type TwoStepState,
} from "../src/lib/piece-image";

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
    // (Lot « vitrine » : la taille naturelle est gardée en plus, pour la tuile de pièce.)
    expect(image).toContain('onLoad={(event) => update({ hd: "loaded", hdWidth: event.source?.width ?? null, hdSize: naturalSize(event.source) })}');
    expect(image).toContain('onError={() => update({ hd: "failed" })}');
    expect(image).toContain("onLoad={(event) => update({ thumbLoaded: true, thumbWidth: event.source?.width ?? null, thumbSize: naturalSize(event.source) })}");
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
    // Lot « vitrine » : la tuile « Écrin » des grilles (4:5, la pièce entière), toujours en « card ».
    const panel = src("components/wishlist-panel.tsx");
    expect(panel).toContain('<PieceTile variant="grid" size="card" hdUri={item.imageHdUrl} fallbackUri={item.imageUrl}');
    expect(panel).not.toContain('size="small"');
    const profile = src("app/(app)/(tabs)/profile/index.tsx");
    expect(profile).toContain('<PieceTile variant="grid" size="card" hdUri={item.imageHdUrl} fallbackUri={item.imageUrl} accessibilityLabel={item.title}');
  });

  it("la fiche d'une envie : le cadre de la pièce charge en « large » (deux temps), sans taille imposée", () => {
    // Lot « vitrine » : le cadre est une grande tuile de pièce, qui passe par SpotImage sans taille imposée.
    const frame = src("components/product-frame.tsx");
    expect(frame).toContain("<PieceTile");
    expect(frame).not.toMatch(/size="(small|card)"/);
    expect(src("components/piece-tile.tsx")).toContain("<SpotImage");
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

// Lot « vitrine » (retours du build 3, 26 novembre 2026) : la tuile « Écrin »
// (components/piece-tile.tsx). Une photo presque 4:5 remplit la tuile ;
// grille : la pièce remplit toujours sa tuile ; grande image : jamais plus
// d'un point par pixel de l'image.
describe("tuile de pièce : remplir, taille honnête, couleur des bords", () => {
  const HERO = { width: 358, height: 447.5 };
  const GRID = { width: 170, height: 212.5 };

  it("constantes : 4:5, 12 %, un point par pixel", () => {
    expect(TILE_RATIO).toBe(4 / 5);
    expect(FILL_TOLERANCE).toBe(0.12);
    expect(HERO_MAX_POINTS_PER_PIXEL).toBe(1);
  });

  it("permis : une grande photo 4:5 remplit la tuile, grande comme petite", () => {
    expect(fillsTile({ width: 1200, height: 1500 }, HERO, "hero")).toBe(true);
    expect(fillsTile({ width: 1200, height: 1500 }, GRID, "grid")).toBe(true);
  });

  it("refusé : une photo carrée (écart de 25 %) ne remplit pas, elle se pose sur son fond", () => {
    expect(fillsTile({ width: 1000, height: 1000 }, HERO, "hero")).toBe(false);
    expect(fillsTile({ width: 1000, height: 1000 }, GRID, "grid")).toBe(false);
  });

  it("photo presque 4:5 (0,85, écart 6 %) mais petite (200 px) : refusé en grand, permis en grille", () => {
    const small = { width: 200, height: 200 / 0.85 };
    expect(fillsTile(small, HERO, "hero")).toBe(false);
    expect(fillsTile(small, GRID, "grid")).toBe(true);
  });

  it("dimensions inconnues ou nulles : ne remplit pas", () => {
    expect(fillsTile(null, HERO, "hero")).toBe(false);
    expect(fillsTile({ width: 0, height: 0 }, GRID, "grid")).toBe(false);
  });

  it("refusé : une vignette de 260 px n'est jamais étirée sur 358 pt dans une grande tuile", () => {
    const shown = honestSize({ width: 260, height: 260 }, HERO, "hero");
    expect(shown.width).toBeLessThanOrEqual(260);
    expect(shown.width).not.toBe(358);
    expect(shown).toEqual({ width: 260, height: 260 });
  });

  it("permis : une grande image prend toute la place du cadre (comme contain)", () => {
    expect(honestSize({ width: 1200, height: 1500 }, HERO, "hero")).toEqual(HERO);
    // Paysage : toute la largeur, hauteur au ratio.
    const wide = honestSize({ width: 2000, height: 1000 }, HERO, "hero");
    expect(wide.width).toBe(358);
    expect(wide.height).toBe(179);
  });

  it("grille : une vignette carrée de 200 px touche les deux bords (170 × 170), jamais rapetissée", () => {
    expect(honestSize({ width: 200, height: 200 }, GRID, "grid")).toEqual({ width: 170, height: 170 });
    // Même une très petite image remplit la largeur dans une grille.
    expect(honestSize({ width: 100, height: 100 }, GRID, "grid")).toEqual({ width: 170, height: 170 });
  });

  it("le ratio est conservé ; dimensions inconnues : le cadre", () => {
    const shown = honestSize({ width: 300, height: 450 }, HERO, "hero");
    expect(shown.width / shown.height).toBeCloseTo(300 / 450);
    expect(honestSize(null, HERO, "hero")).toEqual(HERO);
    expect(honestSize({ width: 0, height: 10 }, GRID, "grid")).toEqual(GRID);
  });

  it("couleur des bords : « #RRGGBB » seulement", () => {
    expect(edgeBackground("#F2F1EE")).toBe("#F2F1EE");
    for (const refused of ["red", "#FFF", "rgba(0,0,0,1)", "#F2F1EEAA", "", null, undefined]) {
      expect(edgeBackground(refused)).toBeNull();
    }
  });

  it("couleur des bords : refusé, une petite photo en grande image (bandes sur les quatre côtés : copie floue) ; permis, une photo qui touche le cadre", () => {
    // 200 × 300 px dans une grande image de 358 pt : 200 × 300 pt au centre, rien ne touche le cadre.
    expect(edgeColorApplies({ width: 200, height: 300 }, HERO, "hero")).toBe(false);
    expect(edgeColorApplies({ width: 300, height: 300 }, HERO, "hero")).toBe(false);
    // Assez grande : elle touche le cadre sur un axe.
    expect(edgeColorApplies({ width: 1000, height: 1000 }, HERO, "hero")).toBe(true);
    expect(edgeColorApplies({ width: 600, height: 1200 }, HERO, "hero")).toBe(true);
    // Grille : la photo touche toujours deux côtés ; taille ou cadre inconnus : oui.
    expect(edgeColorApplies({ width: 100, height: 100 }, GRID, "grid")).toBe(true);
    expect(edgeColorApplies(null, HERO, "hero")).toBe(true);
    expect(edgeColorApplies({ width: 200, height: 300 }, { width: 0, height: 0 }, "hero")).toBe(true);
    expect(readFileSync(join(__dirname, "../src/components/piece-tile.tsx"), "utf8")).toContain("const background = edgeColorApplies(naturalSize, frame, variant) ? edgeBackground(edgeColor) : null;");
  });
});
