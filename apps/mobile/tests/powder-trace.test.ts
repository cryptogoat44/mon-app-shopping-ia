import { describe, expect, it } from "vitest";
import {
  POWDER,
  POWDER_COLORS,
  powderAlpha,
  powderBands,
  powderColor,
  powderGrains,
  powderTrail,
  powderWidth,
  resample,
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
  it("opacité : nulle au départ (refusé : une queue visible dès le départ), ≈ 30 % juste après 12 %, pleine à la tête", () => {
    expect(powderAlpha(0)).toBe(0);
    expect(powderAlpha(0.05)).toBeLessThan(0.2);
    expect(powderAlpha(0.13)).toBeGreaterThan(0.29);
    expect(powderAlpha(0.13)).toBeLessThan(0.35);
    expect(powderAlpha(1)).toBe(1);
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

  it("au plus POWDER.bands chemins par couche, le bout arrondi dans la dernière tranche", () => {
    for (const layer of [POWDER.halo, POWDER.body, POWDER.core]) {
      const paths = powderBands(trail, layer);
      expect(paths.length).toBeLessThanOrEqual(POWDER.bands);
      expect(paths.at(-1)!.t).toBeGreaterThan(0.9);
      expect(paths.at(-1)!.d).toMatch(/a/);
      for (const path of paths.slice(0, -1)) expect(path.d).not.toMatch(/a/);
    }
  });

  it("le cœur ne s'allume que dans la seconde moitié (refusé : un cœur dans la queue)", () => {
    const core = powderBands(trail, POWDER.core);
    for (const path of core) expect(path.t).toBeGreaterThanOrEqual(POWDER.core.from);
    expect(core.length).toBeGreaterThan(1);
  });

  it("opacités croissantes de la queue vers la tête, couleurs de la nacre vers l'or", () => {
    for (const layer of [POWDER.halo, POWDER.body, POWDER.core]) {
      const paths = powderBands(trail, layer);
      for (let index = 1; index < paths.length; index += 1) expect(paths[index].opacity).toBeGreaterThan(paths[index - 1].opacity);
      expect(paths.at(-1)!.opacity).toBeGreaterThan(layer.alpha * 0.9);
    }
  });

  it("presque transparent : jamais plus de 36 % d'opacité pour une couche", () => {
    for (const layer of [POWDER.halo, POWDER.body, POWDER.core]) for (const path of powderBands(trail, layer)) expect(path.opacity).toBeLessThanOrEqual(0.36);
  });

  it("rien à dessiner pour un seul point", () => {
    expect(powderBands([{ x: 0, y: 0 }], POWDER.halo)).toEqual([]);
    expect(powderGrains([{ x: 0, y: 0 }])).toEqual([]);
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
  it("halo et corps en deux copies, le cœur, les grains, la tête sous le doigt : pas plus de 66 chemins", () => {
    const points = ring();
    const trail = powderTrail(points);
    const total = trail.halo.length + trail.body.length + trail.core.length + trail.grains.length + 1;
    expect(total).toBeLessThanOrEqual(2 * POWDER.bands * 2 + POWDER.bands + 4 + 1);
    expect(trail.head).toEqual(points.at(-1));
    // La copie large du halo est plus pâle que la copie normale.
    expect(trail.halo[0].opacity).toBeLessThan(trail.halo[trail.halo.length / 2].opacity);
  });
});
