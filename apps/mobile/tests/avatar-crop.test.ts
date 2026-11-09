import { describe, expect, it } from "vitest";
import { INITIAL_VIEW, MAX_ZOOM, clampView, cropRect, imageLayout, panView, pinchZoom, touchDistance, zoomView } from "../src/lib/avatar-crop";

// Lot « profil et icône des réglages » : cadrage de la photo de profil en
// carré. La photo couvre toujours le carré ; la zone gardée est un carré à
// l'intérieur de la photo.

const LANDSCAPE = { width: 4000, height: 3000 };
const PORTRAIT = { width: 3024, height: 4032 };
const V = 300; // carré affiché, en points

describe("cadrage : départ", () => {
  it("au départ, la photo couvre juste le carré, centrée : le plus grand carré du milieu est gardé", () => {
    expect(cropRect(INITIAL_VIEW, LANDSCAPE, V)).toEqual({ originX: 500, originY: 0, width: 3000, height: 3000 });
    expect(cropRect(INITIAL_VIEW, PORTRAIT, V)).toEqual({ originX: 0, originY: 504, width: 3024, height: 3024 });
    const square = { width: 800, height: 800 };
    expect(cropRect(INITIAL_VIEW, square, V)).toEqual({ originX: 0, originY: 0, width: 800, height: 800 });
  });

  it("la photo affichée déborde du carré du côté long seulement", () => {
    expect(imageLayout(INITIAL_VIEW, LANDSCAPE, V)).toEqual({ left: -50, top: 0, width: 400, height: 300 });
  });
});

describe("cadrage : déplacer", () => {
  it("glisser vers la droite montre la gauche de la photo, jusqu'au bord, jamais au-delà", () => {
    const moved = panView(INITIAL_VIEW, 30, 0, LANDSCAPE, V);
    expect(moved.offsetX).toBe(30);
    expect(cropRect(moved, LANDSCAPE, V).originX).toBe(200);
    const far = panView(INITIAL_VIEW, 500, 500, LANDSCAPE, V);
    expect(far).toEqual({ zoom: 1, offsetX: 50, offsetY: 0 });
    expect(cropRect(far, LANDSCAPE, V)).toEqual({ originX: 0, originY: 0, width: 3000, height: 3000 });
    const otherSide = panView(INITIAL_VIEW, -500, 0, LANDSCAPE, V);
    expect(cropRect(otherSide, LANDSCAPE, V).originX).toBe(1000);
  });

  it("un déplacement en plusieurs fois donne la même chose qu'en une fois", () => {
    const zoomed = zoomView(INITIAL_VIEW, 2, LANDSCAPE, V);
    const steps = [10, 20, -5, 15].reduce((view, dx) => panView(view, dx, dx / 2, LANDSCAPE, V), zoomed);
    expect(steps).toEqual(panView(zoomed, 40, 20, LANDSCAPE, V));
  });
});

describe("cadrage : zoomer", () => {
  it("zoom 2 : un carré deux fois plus petit, au même centre", () => {
    const view = zoomView(INITIAL_VIEW, 2, LANDSCAPE, V);
    expect(cropRect(view, LANDSCAPE, V)).toEqual({ originX: 1250, originY: 750, width: 1500, height: 1500 });
  });

  it("le zoom reste entre 1 et 4 ; dézoomer ramène la photo dans le carré", () => {
    expect(zoomView(INITIAL_VIEW, 9, LANDSCAPE, V).zoom).toBe(MAX_ZOOM);
    expect(zoomView(INITIAL_VIEW, 0.2, LANDSCAPE, V).zoom).toBe(1);
    const zoomedAndMoved = panView(zoomView(INITIAL_VIEW, 4, LANDSCAPE, V), 600, 600, LANDSCAPE, V);
    const back = zoomView(zoomedAndMoved, 1, LANDSCAPE, V);
    expect(back).toEqual(clampView(back, LANDSCAPE, V));
    expect(Math.abs(back.offsetX)).toBeLessThanOrEqual(50);
    expect(back.offsetY).toBe(0);
  });

  it("le point au centre du carré y reste quand on zoome", () => {
    const moved = panView(zoomView(INITIAL_VIEW, 2, LANDSCAPE, V), 40, -30, LANDSCAPE, V);
    const center = (view: typeof moved) => {
      const rect = cropRect(view, LANDSCAPE, V);
      return [rect.originX + rect.width / 2, rect.originY + rect.height / 2];
    };
    const [x1, y1] = center(moved);
    const [x2, y2] = center(zoomView(moved, 3, LANDSCAPE, V));
    expect(Math.abs(x1! - x2!)).toBeLessThanOrEqual(1);
    expect(Math.abs(y1! - y2!)).toBeLessThanOrEqual(1);
  });

  it("pincement : le zoom suit l'écart des doigts", () => {
    expect(touchDistance({ pageX: 0, pageY: 0 }, { pageX: 30, pageY: 40 })).toBe(50);
    expect(pinchZoom(1, 100, 200)).toBe(2);
    expect(pinchZoom(2, 100, 50)).toBe(1);
    expect(pinchZoom(3, 100, 1000)).toBe(MAX_ZOOM);
    expect(pinchZoom(1.5, 0, 80)).toBe(1.5);
  });
});

describe("cadrage : zone gardée", () => {
  it("toujours un carré entier, à l'intérieur de la photo, quel que soit le réglage", () => {
    for (const image of [LANDSCAPE, PORTRAIT, { width: 641, height: 479 }, { width: 37, height: 1200 }]) {
      for (const zoom of [1, 1.3, 2.7, 4]) {
        for (const [dx, dy] of [[0, 0], [999, -999], [-13.7, 21.2]] as const) {
          const view = panView(zoomView(INITIAL_VIEW, zoom, image, V), dx, dy, image, V);
          const rect = cropRect(view, image, V);
          expect(rect.width).toBe(rect.height);
          expect(Number.isInteger(rect.originX) && Number.isInteger(rect.originY) && Number.isInteger(rect.width)).toBe(true);
          expect(rect.originX).toBeGreaterThanOrEqual(0);
          expect(rect.originY).toBeGreaterThanOrEqual(0);
          expect(rect.originX + rect.width).toBeLessThanOrEqual(image.width);
          expect(rect.originY + rect.height).toBeLessThanOrEqual(image.height);
        }
      }
    }
  });

  it("l'aperçu rond montre la même zone, à plus petite échelle", () => {
    const view = panView(zoomView(INITIAL_VIEW, 2, LANDSCAPE, V), 25, 10, LANDSCAPE, V);
    const big = imageLayout(view, LANDSCAPE, V);
    const small = imageLayout(view, LANDSCAPE, V, 56);
    for (const key of ["left", "top", "width", "height"] as const) expect(small[key]).toBeCloseTo((big[key] * 56) / V, 6);
  });
});
