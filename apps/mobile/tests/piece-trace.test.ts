import { describe, expect, it } from "vitest";
import { MIN_CROP, WHOLE_IMAGE, isAdjustedCrop, isDefaultCrop, type Size } from "../src/lib/crop-geometry";
import {
  MAX_TRACE_POINTS,
  TRACE_STEP,
  WHOLE_IMAGE_ZONE,
  extendTrace,
  outsidePath,
  toTracePoint,
  tracePath,
  zoneFromTrace,
  zoneReady,
  type TracePoint,
} from "../src/lib/piece-trace";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";

// Lot entourer la pièce : la personne entoure la pièce au doigt ; la zone
// envoyée reste un rectangle (celui qui englobe le tracé, avec une marge).

/** Une boucle (ellipse) de `count` points autour d'un centre, en proportions de l'image. */
function loop(cx: number, cy: number, rx: number, ry: number, count = 24): TracePoint[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  });
}

// Image affichée sur 200 × 400 points : marge de 6 points = 0,03 de la largeur, 0,015 de la hauteur.
const display: Size = { width: 200, height: 400 };

describe("du doigt à l'image", () => {
  const box = { left: 20, top: 0, width: 200, height: 400 };

  it("un point touché devient une position dans l'image (proportions)", () => {
    expect(toTracePoint(120, 100, box)).toEqual({ x: 0.5, y: 0.25 });
  });

  it("le doigt sorti de l'image est ramené à son bord", () => {
    expect(toTracePoint(0, 450, box)).toEqual({ x: 0, y: 1 });
  });
});

describe("tracé simplifié : jamais des milliers de points", () => {
  it("un point trop proche du précédent est ignoré, sans nouvel objet ; un point plus loin est gardé", () => {
    const start: readonly TracePoint[] = [{ x: 0.5, y: 0.5 }];
    // 1 point écran : ignoré.
    expect(extendTrace(start, { x: 0.505, y: 0.5 }, display)).toBe(start);
    // TRACE_STEP points écran ou plus : gardé.
    expect(extendTrace(start, { x: 0.5 + TRACE_STEP / display.width, y: 0.5 }, display)).toHaveLength(2);
  });

  it("des milliers de mouvements (25 tours de doigt) : au plus MAX_TRACE_POINTS points, le premier gardé", () => {
    let trace: readonly TracePoint[] = [];
    for (let move = 0; move < 5000; move += 1) {
      const angle = (move / 200) * Math.PI * 2;
      trace = extendTrace(trace, { x: 0.5 + 0.3 * Math.cos(angle), y: 0.5 + 0.3 * Math.sin(angle) }, display);
    }
    expect(trace.length).toBeLessThanOrEqual(MAX_TRACE_POINTS);
    expect(trace.length).toBeGreaterThan(MAX_TRACE_POINTS / 3);
    expect(trace[0]).toEqual({ x: 0.8, y: 0.5 });
  });

  it("réduit de moitié quand il déborde, en gardant le dernier point", () => {
    const full = Array.from({ length: MAX_TRACE_POINTS }, (_, index) => ({ x: (index % 2) * 0.5, y: index / MAX_TRACE_POINTS }));
    const reduced = extendTrace(full, { x: 0.9, y: 0.9 }, display);
    expect(reduced.length).toBe(MAX_TRACE_POINTS / 2 + 1);
    expect(reduced[0]).toEqual(full[0]);
    expect(reduced.at(-1)).toEqual({ x: 0.9, y: 0.9 });
  });
});

describe("zone envoyée : le rectangle qui englobe le tracé", () => {
  it("avec une petite marge, la même en points sur chaque côté", () => {
    // Boucle de 40 points de rayon : x de 0,3 à 0,7, y de 0,4 à 0,6.
    const zone = zoneFromTrace(loop(0.5, 0.5, 0.2, 0.1), display)!;
    expect(zone.x).toBeCloseTo(0.27);
    expect(zone.width).toBeCloseTo(0.46);
    expect(zone.y).toBeCloseTo(0.385);
    expect(zone.height).toBeCloseTo(0.23);
  });

  it("bornée à l'image quand la pièce touche un bord", () => {
    const zone = zoneFromTrace(loop(0.12, 0.93, 0.1, 0.06), display)!;
    expect(zone.x).toBe(0);
    expect(zone.width).toBeCloseTo(0.25);
    expect(zone.y).toBeCloseTo(0.855);
    expect(zone.y + zone.height).toBe(1);
  });

  it("jamais plus petite que MIN_CROP : une boucle très plate (une ceinture) est élargie autour de son milieu", () => {
    const square: Size = { width: 400, height: 400 };
    const zone = zoneFromTrace(loop(0.5, 0.5, 0.3, 0.005), square)!;
    expect(zone.height).toBeCloseTo(MIN_CROP);
    expect(zone.y + zone.height / 2).toBeCloseTo(0.5);
    expect(zone.width).toBeCloseTo(0.63);
  });

  it("élargie sans sortir de l'image, contre un bord", () => {
    const zone = zoneFromTrace(loop(0.5, 0.99, 0.3, 0.005), { width: 400, height: 400 })!;
    expect(zone.height).toBeCloseTo(MIN_CROP);
    expect(zone.y + zone.height).toBeCloseTo(1);
  });

  it("une boucle autour de toute l'image : l'image entière, comptée comme non ajustée", () => {
    const zone = zoneFromTrace(
      [
        { x: 0.01, y: 0.01 },
        { x: 0.99, y: 0.01 },
        { x: 0.99, y: 0.99 },
        { x: 0.01, y: 0.99 },
      ],
      display
    );
    expect(zone).toEqual(WHOLE_IMAGE);
    expect(isAdjustedCrop(zone)).toBe(false);
  });
});

describe("tracé non retenu : un toucher, un trait, un griffonnage", () => {
  it("un simple toucher (un ou deux points)", () => {
    expect(zoneFromTrace([{ x: 0.5, y: 0.5 }], display)).toBeNull();
    expect(zoneFromTrace([{ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.5 }], display)).toBeNull();
  });

  it("une toute petite boucle (5 points écran de rayon)", () => {
    expect(zoneFromTrace(loop(0.5, 0.5, 5 / display.width, 5 / display.height), display)).toBeNull();
  });

  it("un trait, même long et en diagonale, ou un aller-retour : il n'entoure rien", () => {
    const line = Array.from({ length: 30 }, (_, index) => ({ x: 0.1 + index * 0.02, y: 0.1 + index * 0.025 }));
    expect(zoneFromTrace(line, display)).toBeNull();
    expect(zoneFromTrace([...line, ...[...line].reverse()], display)).toBeNull();
  });

  it("taille d'affichage encore inconnue : rien n'est retenu", () => {
    expect(zoneFromTrace(loop(0.5, 0.5, 0.2, 0.1), { width: 0, height: 0 })).toBeNull();
  });
});

describe("« Lancer » et « zone ajustée »", () => {
  it("« Lancer » attend une zone : entourée, ou l'image entière", () => {
    expect(zoneReady(null)).toBe(false);
    expect(zoneReady(WHOLE_IMAGE_ZONE)).toBe(true);
    const crop = zoneFromTrace(loop(0.5, 0.5, 0.2, 0.1), display)!;
    expect(zoneReady({ crop, trace: loop(0.5, 0.5, 0.2, 0.1) })).toBe(true);
  });

  it("« zone ajustée » = la pièce entourée ; l'image entière ou l'ancienne zone par défaut : non", () => {
    expect(isAdjustedCrop(zoneFromTrace(loop(0.5, 0.5, 0.2, 0.1), display))).toBe(true);
    expect(isDefaultCrop(WHOLE_IMAGE_ZONE.crop)).toBe(true);
    expect(isAdjustedCrop(WHOLE_IMAGE_ZONE.crop)).toBe(false);
    expect(isAdjustedCrop({ x: 0.15, y: 0.15, width: 0.7, height: 0.7 })).toBe(false);
    expect(isAdjustedCrop(null)).toBe(false);
  });
});

describe("dessin du tracé et de l'extérieur assombri", () => {
  const box = { left: 10, top: 20, width: 100, height: 200 };

  it("le tracé en points du cadre ; refermé une fois retenu", () => {
    const trace = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 0 },
    ];
    expect(tracePath(trace, box, false)).toBe("M10 20L60 120L110 20");
    expect(tracePath(trace, box, true)).toBe("M10 20L60 120L110 20Z");
    expect(tracePath([{ x: 1 / 3, y: 0 }], box, true)).toBe("M43.3 20");
  });

  it("tout le cadre moins la zone (deux rectangles, règle « evenodd »)", () => {
    expect(outsidePath({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, box, { width: 120, height: 240 })).toBe("M0 0h120v240h-120ZM35 70h50v100h-50Z");
  });
});

describe("textes du tracé", () => {
  it("consigne au doigt ou à la souris, message d'un tracé non retenu, bouton « Utiliser toute l'image »", () => {
    expect(fr.targeting.instruction.finger).toBe("Entourez la pièce avec votre doigt");
    expect(fr.targeting.instruction.mouse).toBe("Entourez la pièce avec la souris ou le doigt");
    expect(fr.targeting.wholeImage).toBe("Utiliser toute l'image");
    expect(fr.targeting.tooSmall).toMatch(/^Entourez toute la pièce/);
    expect(en.targeting.instruction.finger).toBe("Circle the piece with your finger");
    expect(en.targeting.wholeImage).toBe("Use the whole image");
  });

  it("VoiceOver : la consigne, puis le bouton à toucher (espaces insécables dans « »)", () => {
    expect(fr.crop.hint(fr.targeting.instruction.finger, fr.targeting.wholeImage)).toBe(
      "Entourez la pièce avec votre doigt, ou touchez « Utiliser toute l'image »."
    );
    expect(en.crop.hint(en.targeting.instruction.finger, en.targeting.wholeImage)).toBe("Circle the piece with your finger, or tap “Use the whole image”.");
  });

  it("plus aucun texte ne parle de faire glisser le cadre ou ses coins", () => {
    for (const text of [fr.targeting.caption, fr.crop.hint("x", "y"), fr.launch.frameHint]) expect(text).not.toMatch(/cadre|coins/);
    for (const text of [en.targeting.caption, en.crop.hint("x", "y"), en.launch.frameHint]) expect(text).not.toMatch(/frame|corners/);
  });
});
