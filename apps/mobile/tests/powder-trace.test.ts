import { describe, expect, it } from "vitest";
import {
  INSIDE_VEIL,
  MASK,
  POWDER,
  POWDER_COLORS,
  SHAPE_EDGE,
  maskGray,
  powderAlpha,
  powderBands,
  powderColor,
  powderGrains,
  powderLayers,
  powderTrail,
  powderWidth,
  resample,
  type PowderLayer,
} from "../src/lib/powder-trace";

// Lot « entourer en poudre » : la traînée de lumière qui suit le doigt
// (maquette 3-entourer-poudre, retenue par le fondateur). Dessin seulement :
// rien de ce fichier ne part au serveur.

/** Un tour au doigt (en points du cadre), commencé en haut à gauche. */
function ring(count = 120, rx = 60, ry = 90, cx = 120, cy = 200) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 1.9 - Math.PI / 2;
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  });
}

const hex = (value: string) => `rgb(${[1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16)).join(",")})`;

describe("rééchantillonnage : t = fraction de la longueur", () => {
  it("points également espacés (± 0,5 pt) le long d'un trait", () => {
    const points = resample([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 60 }]);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 30, y: 60 });
    // Sur chaque droite, le pas est le même.
    for (let index = 1; index < 10; index += 1) {
      expect(Math.abs(Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y) - POWDER.spacing)).toBeLessThanOrEqual(0.5);
    }
    expect(points).toHaveLength(31);
  });

  it("160 points au plus, même pour un très long tracé (refusé : des milliers)", () => {
    const long = Array.from({ length: 300 }, (_, index) => ({ x: (index % 2) * 200, y: index * 4 }));
    expect(resample(long).length).toBeLessThanOrEqual(POWDER.maxPoints);
    expect(POWDER.maxPoints).toBe(160);
  });

  it("un seul point, ou un doigt immobile : un seul point", () => {
    expect(resample([{ x: 1, y: 2 }])).toEqual([{ x: 1, y: 2 }]);
    expect(resample([{ x: 1, y: 2 }, { x: 1, y: 2 }])).toEqual([{ x: 1, y: 2 }]);
  });
});

describe("largeur, opacité et couleur le long du tracé", () => {
  it("opacité : nulle au départ (refusé : une queue visible dès le départ), un souffle dans la queue, pleine à la tête", () => {
    expect(powderAlpha(0)).toBe(0);
    expect(powderAlpha(0.05)).toBeLessThan(0.1);
    expect(powderAlpha(0.13)).toBeGreaterThan(0.1);
    expect(powderAlpha(0.13)).toBeLessThanOrEqual(0.15);
    expect(powderAlpha(1)).toBe(1);
    // Croissante d'un bout à l'autre : les tranches se découpent selon elle.
    for (let t = 0.01; t <= 1; t += 0.01) expect(powderAlpha(t)).toBeGreaterThanOrEqual(powderAlpha(t - 0.01));
  });

  /** La queue (jusqu'au début de la montée) ne dépasse jamais 15 % de l'éclat de la tête. */
  const faintTail = (alpha: (t: number) => number) => Array.from({ length: 46 }, (_, k) => alpha(k / 100)).every((value) => value <= 0.15 * alpha(1));

  it("la queue n'est qu'un souffle : jamais plus de 15 % de la tête (refusé : l'ancienne queue à 30 %)", () => {
    expect(POWDER.tailShare).toBeGreaterThanOrEqual(0.1);
    expect(POWDER.tailShare).toBeLessThanOrEqual(0.15);
    expect(faintTail(powderAlpha)).toBe(true);
    const former = (t: number) => (0.3 + 0.7 * Math.pow(t, 1.6)) * (t < 0.12 ? t / 0.12 : 1);
    expect(faintTail(former)).toBe(false);
  });

  it("la partie vive couvre le dernier tiers : encore faible aux deux tiers, presque pleine à 90 % (refusé : vive dès le milieu)", () => {
    expect(powderAlpha(0.5)).toBeLessThan(0.2);
    expect(powderAlpha(0.67)).toBeLessThan(0.5);
    expect(powderAlpha(0.9)).toBeGreaterThan(0.8);
  });

  it("largeur : fine à la queue, large à la tête, croissante", () => {
    expect(powderWidth(0, 6, 32)).toBe(6);
    expect(powderWidth(1, 6, 32)).toBe(32);
    let previous = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      const width = powderWidth(t, 6, 32);
      expect(width).toBeGreaterThanOrEqual(previous);
      previous = width;
    }
  });

  it("couleur : nacre à la queue, ivoire à 0,7, or pâle à la tête", () => {
    expect(powderColor(0)).toBe(hex(POWDER_COLORS.nacre));
    expect(powderColor(0.7)).toBe(hex(POWDER_COLORS.ivoire));
    expect(powderColor(1)).toBe(hex(POWDER_COLORS.or));
  });
});

describe("le ruban en tranches", () => {
  const trail = resample(ring());

  it("au plus layer.bands chemins par copie, le bout arrondi dans la dernière tranche", () => {
    for (const layer of powderLayers()) {
      const paths = powderBands(trail, layer);
      expect(paths.length).toBeLessThanOrEqual(layer.bands);
      expect(paths.at(-1)!.t).toBeGreaterThan(0.9);
      expect(paths.at(-1)!.d).toMatch(/a/);
      for (const path of paths.slice(0, -1)) expect(path.d).not.toMatch(/a/);
    }
  });

  it("le cœur ne s'allume que dans la seconde moitié (refusé : un cœur dans la queue)", () => {
    const core = powderBands(trail, POWDER.core);
    expect(powderLayers().at(-1)).toBe(POWDER.core);
    for (const path of core) expect(path.t).toBeGreaterThanOrEqual(POWDER.core.from);
    expect(core.length).toBeGreaterThan(1);
  });

  it("opacités croissantes de la queue vers la tête, couleurs de la nacre vers l'or", () => {
    for (const layer of powderLayers()) {
      const paths = powderBands(trail, layer);
      for (let index = 1; index < paths.length; index += 1) {
        expect(paths[index].opacity).toBeGreaterThan(paths[index - 1].opacity);
        expect(paths[index].t).toBeGreaterThan(paths[index - 1].t);
      }
      expect(paths.at(-1)!.opacity).toBeGreaterThan(layer.alpha * 0.85);
    }
  });

  it("presque transparent : jamais plus de 30 % d'opacité pour une copie", () => {
    for (const layer of powderLayers()) for (const path of powderBands(trail, layer)) expect(path.opacity).toBeLessThanOrEqual(0.3);
  });

  it("dans la queue, chaque copie reste sous 15 % de son éclat à la tête (refusé : une tranche de queue vive)", () => {
    const faint = (paths: readonly { t: number; opacity: number }[], layer: PowderLayer) =>
      paths.filter((path) => path.t <= POWDER.rampFrom).every((path) => path.opacity <= 0.15 * layer.alpha + 1e-9);
    for (const layer of powderLayers()) {
      const paths = powderBands(trail, layer);
      expect(paths.some((path) => path.t <= POWDER.rampFrom) || layer.from !== undefined).toBe(true);
      expect(faint(paths, layer)).toBe(true);
      // Refusé : la même copie, à l'éclat de sa tête d'un bout à l'autre.
      if (layer.from === undefined) expect(faint(paths.map((path) => ({ ...path, opacity: layer.alpha })), layer)).toBe(false);
    }
  });

  it("tranches à pas égal d'opacité : d'une tranche à la suivante, jamais un saut de plus de deux pas", () => {
    for (const layer of powderLayers()) {
      const paths = powderBands(trail, layer);
      for (let index = 1; index < paths.length; index += 1) expect(paths[index].opacity - paths[index - 1].opacity).toBeLessThanOrEqual((2 * layer.alpha) / layer.bands + 1e-9);
    }
  });

  it("rien à dessiner pour un seul point", () => {
    expect(powderBands([{ x: 0, y: 0 }], POWDER.core)).toEqual([]);
    expect(powderGrains([{ x: 0, y: 0 }])).toEqual([]);
  });
});

describe("la douceur sur la largeur : des copies à marches fines", () => {
  /** Marches fines : au moins 5 copies, largeurs à la tête décroissantes par pas de 8 pt au plus, opacités croissantes. */
  const fineSteps = (layers: readonly PowderLayer[]) =>
    layers.length >= 5 &&
    layers.every((layer, index) => index === 0 || (layer.head < layers[index - 1].head && layers[index - 1].head - layer.head <= 8 && layer.alpha >= layers[index - 1].alpha));

  it("permis : les copies de POWDER.soft, de la plus large et pâle à la plus fine et vive, puis le cœur", () => {
    const layers = powderLayers();
    expect(layers).toHaveLength(POWDER.soft.copies + 1);
    expect(fineSteps(layers)).toBe(true);
    expect(layers[0].head).toBe(POWDER.soft.outer.head);
    expect(layers[0].bands).toBeLessThan(layers[POWDER.soft.copies - 1].bands);
  });

  it("refusé : les anciennes marches (halo et corps en deux copies, des sauts de 16 pt)", () => {
    const former = [
      { tail: 9, head: 48, alpha: 0.07, bands: 12 },
      { tail: 6, head: 32, alpha: 0.2, bands: 12 },
      { tail: 4.6, head: 24.7, alpha: 0.14, bands: 12 },
      { tail: 3.5, head: 19, alpha: 0.36, bands: 12 },
      { tail: 1, head: 6, alpha: 0.34, bands: 12 },
    ];
    expect(fineSteps(former)).toBe(false);
  });
});

describe("les grains de poudre", () => {
  const trail = resample(ring());

  it("déterministes : le même tracé donne les mêmes grains (le dessin ne grésille pas)", () => {
    expect(powderGrains(trail)).toEqual(powderGrains(resample(ring())));
    expect(powderGrains(trail, 7)).not.toEqual(powderGrains(trail, 8));
  });

  it("stables pendant le geste : un point de plus ne redistribue pas les grains (plus de « grésille »)", () => {
    /** Les centres des grains, groupe par groupe (un disque = « M x y a… »). */
    const centres = (points: { x: number; y: number }[]) =>
      powderGrains(resample(points)).map((grain) => [...grain.d.matchAll(/M(-?[\d.]+) (-?[\d.]+)a/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) })));
    // Un tour qui s'allonge de 4 pt par point (TRACE_STEP), comme sous le doigt.
    const growing = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ x: 200 + 80 * Math.cos(index * 0.05), y: 250 + 80 * Math.sin(index * 0.05) }));
    for (const count of [40, 41, 80, 100]) {
      const before = centres(growing(count));
      const after = centres(growing(count + 1));
      // Les mêmes groupes, le même nombre de grains, chacun à quelques points de sa place.
      expect(after.map((group) => group.length)).toEqual(before.map((group) => group.length));
      before.forEach((group, g) =>
        group.forEach((point, k) => expect(Math.hypot(point.x - after[g][k].x, point.y - after[g][k].y)).toBeLessThan(6))
      );
    }
  });

  it("refusé : une graine qui change avec le nombre de points (graine fixe par défaut)", () => {
    expect(powderGrains(trail)).toEqual(powderGrains(trail, 1));
    expect(powderGrains(trail)).not.toEqual(powderGrains(trail, trail.length));
  });

  it("seulement dans le dernier tiers, derrière la tête : aucun grain à l'autre bout", () => {
    // Un trait droit de 300 pt, de gauche (queue) à droite (tête).
    const line = resample([{ x: 0, y: 100 }, { x: 300, y: 100 }]);
    const xs = powderGrains(line).flatMap((grain) => [...grain.d.matchAll(/M(-?[\d.]+) (-?[\d.]+)a([\d.]+)/g)].map((match) => Number(match[1]) + Number(match[3])));
    expect(xs.length).toBeGreaterThan(5);
    // Permis : tous à partir de POWDER.grainsFrom (moins le léger recul de la poudre).
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(POWDER.grainsFrom * 300 - 4);
    // Refusé : un grain dans la première moitié du trait.
    expect(xs.some((x) => x < 150)).toBe(false);
    expect(POWDER.grainsFrom).toBeGreaterThanOrEqual(0.6);
  });

  it("au plus 4 chemins, au plus POWDER.grains grains, rayons de 0,5 à 1 pt", () => {
    const grains = powderGrains(trail);
    expect(grains.length).toBeGreaterThan(0);
    expect(grains.length).toBeLessThanOrEqual(4);
    const radii = grains.flatMap((grain) => [...grain.d.matchAll(/a([\d.]+) /g)].map((match) => Number(match[1])));
    expect(radii.length / 2).toBeLessThanOrEqual(POWDER.grains);
    for (const radius of radii) {
      expect(radius).toBeGreaterThanOrEqual(0.5);
      expect(radius).toBeLessThanOrEqual(1);
    }
  });
});

describe("toute la traînée d'un tracé", () => {
  /** Chemins redessinés à chaque mouvement du doigt : toutes les tranches, 4 groupes de grains, la lueur. */
  const pathBudget = (layers: readonly PowderLayer[]) => layers.reduce((sum, layer) => sum + layer.bands, 0) + 4 + 1;

  it("les copies, les grains, la tête sous le doigt : au plus POWDER.maxPaths (100) chemins, même pour une traînée de 160 points", () => {
    const points = ring();
    const trail = powderTrail(points);
    expect(trail.head).toEqual(points.at(-1));
    expect(POWDER.maxPaths).toBeLessThanOrEqual(100);
    expect(pathBudget(powderLayers())).toBeLessThanOrEqual(POWDER.maxPaths);
    // Une traînée de 160 points (le plafond du rééchantillonnage).
    const long = ring(400, 150, 220, 200, 300);
    expect(resample(long)).toHaveLength(POWDER.maxPoints);
    const full = powderTrail(long);
    expect(full.layers.length + full.grains.length + 1).toBeLessThanOrEqual(POWDER.maxPaths);
    // La copie la plus large est plus pâle que le cœur.
    expect(full.layers[0].opacity).toBeLessThan(full.layers.at(-1)!.opacity);
  });

  it("refusé : des tranches fines pour toutes les copies (plus de 100 chemins à chaque mouvement)", () => {
    expect(pathBudget(powderLayers().map((layer) => ({ ...layer, bands: 16 })))).toBeGreaterThan(100);
  });

  it("après le lâcher, la poudre retombe en souvenir (refusé : aussi lourde que pendant le geste)", () => {
    const points = ring();
    const live = powderTrail(points);
    const settled = powderTrail(points, POWDER.settledShare);
    expect(POWDER.settledShare).toBeGreaterThan(0);
    expect(POWDER.settledShare).toBeLessThanOrEqual(0.5);
    expect(settled.layers.map((path) => path.d)).toEqual(live.layers.map((path) => path.d));
    settled.layers.forEach((path, index) => expect(path.opacity).toBeCloseTo(live.layers[index].opacity * POWDER.settledShare, 9));
    settled.grains.forEach((path, index) => expect(path.opacity).toBeLessThan(live.grains[index].opacity));
    expect(powderTrail(points, 1)).toEqual(live);
  });
});

describe("la lumière qui reste après le lâcher", () => {
  it("le dedans éclairé : entre 8 et 12 % (refusé : l'ancien voile à 4,5 %, à peine visible, ou 20 %)", () => {
    const lit = (opacity: number) => opacity >= 0.08 && opacity <= 0.12;
    expect(lit(INSIDE_VEIL.opacity)).toBe(true);
    expect(lit(0.045)).toBe(false);
    // Refusé aussi : un voile qui délaverait un vêtement blanc.
    expect(lit(0.2)).toBe(false);
  });

  it("gris du masque : 0 → noir (clair), 1 → blanc (voilé), bornés", () => {
    expect(maskGray(0)).toBe(MASK.clear);
    expect(maskGray(1)).toBe(MASK.veiled);
    expect(maskGray(0.5)).toBe("#808080");
    expect(maskGray(-1)).toBe("#000000");
    expect(maskGray(2)).toBe("#FFFFFF");
  });

  /** Bord sans marche visible : au moins 6 anneaux, du plus large au plus fin, et jamais plus de 12 % de voile d'un anneau à l'autre (ni depuis le voile plein). */
  const feathered = (rings: readonly { width: number; level: number }[]) =>
    rings.length >= 6 &&
    rings.every((ring, index) => {
      const previous = index === 0 ? { width: Infinity, level: 1 } : rings[index - 1];
      return ring.width < previous.width && ring.level < previous.level && previous.level - ring.level <= 0.12 && ring.level > 0;
    });

  it("permis : le bord du voile adouci par des anneaux à pas fin", () => {
    expect(feathered(MASK.rings)).toBe(true);
  });

  it("refusé : les deux anneaux d'avant (marches de 30 % de voile)", () => {
    expect(feathered([{ width: 14, level: 0.7 }, { width: 7, level: 0.4 }])).toBe(false);
  });

  /** Un bord lumineux doux et fin : des filets du plus large et pâle au plus fin, aucun au-delà de 20 % ni plus large que 16 pt. */
  const softEdge = (lines: readonly { width: number; opacity: number }[]) =>
    lines.length >= 3 &&
    lines.every((line, index) => line.opacity <= 0.2 && line.width <= 16 && (index === 0 || (line.width < lines[index - 1].width && line.opacity > lines[index - 1].opacity)));

  it("permis : le bord lumineux de la forme, quelques filets ivoire empilés", () => {
    expect(softEdge(SHAPE_EDGE.lines)).toBe(true);
    expect(SHAPE_EDGE.color).toBe(POWDER_COLORS.ivoire);
  });

  it("refusé : un trait plein et net autour de la forme", () => {
    expect(softEdge([{ width: 3, opacity: 0.9 }])).toBe(false);
  });
});
