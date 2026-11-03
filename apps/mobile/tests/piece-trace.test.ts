import { describe, expect, it } from "vitest";
import { MIN_CROP, WHOLE_IMAGE, isAdjustedCrop, isDefaultCrop, type Size } from "../src/lib/crop-geometry";
import {
  MAX_TRACE_POINTS,
  TRACE_START_MARGIN,
  TRACE_STEP,
  WHOLE_IMAGE_ZONE,
  extendTrace,
  outsidePath,
  toTracePoint,
  tracePath,
  traceSurface,
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

// Tailles réelles de l'image à l'écran, en points : capture verticale sur
// « Lancer » (iPhone 15, iPhone SE), image d'une vidéo 9:16 sur Ciblage.
const CAPTURE: Size = { width: 165, height: 358 };
const CAPTURE_SE: Size = { width: 157, height: 280 };
const CIBLAGE: Size = { width: 230, height: 409 };
const IMAGES = [CAPTURE, CAPTURE_SE, CIBLAGE];

type Finger = { x: number; y: number };

/** Rejoue un geste comme le composant : chaque position du doigt (en points,
 * depuis le coin de l'image) passe par toTracePoint puis extendTrace. */
function replay(fingers: readonly Finger[], image: Size): readonly TracePoint[] {
  const box = { left: 0, top: 0, ...image };
  return fingers.reduce<readonly TracePoint[]>((trace, finger) => extendTrace(trace, toTracePoint(finger.x, finger.y, box), image), []);
}

/** Positions du doigt sur un arc d'ellipse (centre et rayons en points, angles
 * en degrés), avec un tremblement de `wobble` points. */
function arc(cx: number, cy: number, rx: number, ry: number, fromDeg: number, sweepDeg: number, count = 60, wobble = 0): Finger[] {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = ((fromDeg + (sweepDeg * index) / count) * Math.PI) / 180;
    const shake = wobble * Math.sin(index * 1.7);
    return { x: cx + (rx + shake) * Math.cos(angle), y: cy + (ry + shake) * Math.sin(angle) };
  });
}

/** Balayage du pouce : arc de cercle de corde `chord` et de rayon `radius` (le
 * pouce pivote), parti de `start` dans la direction `angleDeg`, bombé d'un côté. */
function thumbSwipe(start: Finger, chord: number, radius: number, angleDeg: number, side: 1 | -1, count = 20): Finger[] {
  const angle = (angleDeg * Math.PI) / 180;
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -along.y * side, y: along.x * side };
  const half = Math.asin(chord / 2 / radius);
  const center = {
    x: start.x + (along.x * chord) / 2 + normal.x * radius * Math.cos(half),
    y: start.y + (along.y * chord) / 2 + normal.y * radius * Math.cos(half),
  };
  return Array.from({ length: count + 1 }, (_, index) => {
    const phi = -half + (2 * half * index) / count;
    return {
      x: center.x + radius * (Math.sin(phi) * along.x - Math.cos(phi) * normal.x),
      y: center.y + radius * (Math.sin(phi) * along.y - Math.cos(phi) * normal.y),
    };
  });
}

const kept = (fingers: readonly Finger[], image: Size) => zoneFromTrace(replay(fingers, image), image);

describe("du doigt à l'image", () => {
  const box = { left: 20, top: 0, width: 200, height: 400 };

  it("un point touché devient une position dans l'image (proportions)", () => {
    expect(toTracePoint(120, 100, box)).toEqual({ x: 0.5, y: 0.25 });
  });

  it("le doigt sorti de l'image est ramené à son bord", () => {
    expect(toTracePoint(0, 450, box)).toEqual({ x: 0, y: 1 });
  });
});

describe("ce qui prend le doigt : l'image et une petite marge", () => {
  it("capture verticale : l'image et 16 points de chaque côté ; les bandes vides au-delà font défiler la page", () => {
    // Cadre de 345 × 358 points, image de 165 points de large au milieu (iPhone 15).
    const image = { left: 90, top: 0, width: 165, height: 358 };
    expect(traceSurface(image, { width: 345, height: 358 })).toEqual({ left: 90 - TRACE_START_MARGIN, top: 0, width: 165 + 2 * TRACE_START_MARGIN, height: 358 });
  });

  it("photo en largeur : jamais hors du cadre", () => {
    const image = { left: 0, top: 50, width: 345, height: 258 };
    expect(traceSurface(image, { width: 345, height: 358 })).toEqual({ left: 0, top: 34, width: 345, height: 290 });
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

  it("jamais plus petite que MIN_CROP : une boucle très plate est élargie autour de son milieu", () => {
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
        { x: 0.01, y: 0.03 },
      ],
      display
    );
    expect(zone).toEqual(WHOLE_IMAGE);
    expect(isAdjustedCrop(zone)).toBe(false);
  });
});

describe("un tour, même imparfait, est retenu", () => {
  it("boucles de 360°, 330° et 300° (un « C », même allongé et commencé sur le côté)", () => {
    for (const image of IMAGES) {
      const cx = image.width / 2;
      const cy = image.height / 2;
      expect(kept(arc(cx, cy, 40, 55, -90, 360), image)).not.toBeNull();
      expect(kept(arc(cx, cy, 40, 55, 20, -330), image)).not.toBeNull();
      // Ovale deux fois plus haut que large, commencé sur le côté : la fin
      // revient à 0,69 de la plus grande distance au départ.
      expect(kept(arc(cx, cy, 30, 60, 0, 300), image)).not.toBeNull();
    }
  });

  it("un tour qui dépasse son départ (420° à 540°), fait deux fois, tremblé, ou rapide (8 points)", () => {
    for (const image of IMAGES) {
      const cx = image.width / 2;
      const cy = image.height / 2;
      for (const sweep of [420, 480, 540, 720]) expect(kept(arc(cx, cy, 40, 55, 0, sweep, 90), image)).not.toBeNull();
      expect(kept(arc(cx, cy, 45, 60, 30, 365, 80, 4), image)).not.toBeNull();
      expect(kept(arc(cx, cy, 35, 50, 0, 360, 8), image)).not.toBeNull();
    }
  });

  it("une boucle qui déborde de l'image, ou qui fait le tour de presque toute l'image", () => {
    for (const image of IMAGES) {
      const zone = kept(arc(10, image.height / 2, 45, 50, 0, 360), image)!;
      expect(zone.x).toBe(0);
      expect(kept(arc(image.width / 2, image.height / 2, image.width * 0.5, image.height * 0.5, 200, 360, 80), image)).toEqual(WHOLE_IMAGE);
    }
  });
});

describe("taille minimale : 24 points de large ou de haut (décision), pas d'aire", () => {
  it("petites pièces retenues : rond de 24 et 26 points, lunettes (40 × 14), ovale de 60 × 12, ceinture (160 × 20)", () => {
    for (const image of IMAGES) {
      const cx = image.width / 2;
      const cy = image.height / 2;
      expect(kept(arc(cx, cy, 12, 12, 0, 360, 30), image)).not.toBeNull();
      expect(kept(arc(cx, cy, 13, 13, 0, 360, 30), image)).not.toBeNull();
      expect(kept(arc(cx, cy * 0.6, 20, 7, 0, 360, 30), image)).not.toBeNull();
      expect(kept(arc(cx, cy, 30, 6, 0, 360, 36), image)).not.toBeNull();
      expect(kept(arc(cx, cy, 80, 10, 90, 360, 60), image)).not.toBeNull();
    }
  });

  it("refusé : un rond de 20 points, ou une toute petite boucle", () => {
    for (const image of IMAGES) expect(kept(arc(image.width / 2, image.height / 2, 10, 10, 0, 360, 24), image)).toBeNull();
    expect(zoneFromTrace(loop(0.5, 0.5, 5 / display.width, 5 / display.height), display)).toBeNull();
  });
});

describe("tracé non retenu : il n'entoure rien", () => {
  it("un simple toucher (un ou deux points)", () => {
    expect(zoneFromTrace([{ x: 0.5, y: 0.5 }], display)).toBeNull();
    expect(zoneFromTrace([{ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.5 }], display)).toBeNull();
  });

  it("un trait, même long et en diagonale, ou un aller-retour, même tremblé", () => {
    const line = Array.from({ length: 30 }, (_, index) => ({ x: 0.1 + index * 0.02, y: 0.1 + index * 0.025 }));
    expect(zoneFromTrace(line, display)).toBeNull();
    expect(zoneFromTrace([...line, ...[...line].reverse()], display)).toBeNull();
    // Aller de 150 points vers le haut, retour décalé de 2 points au plus.
    const go = Array.from({ length: 31 }, (_, index) => ({ x: 80, y: 250 - index * 5 }));
    const back = go.map((finger, index) => ({ x: finger.x + 2 * Math.sin((index / 30) * Math.PI), y: finger.y })).reverse();
    expect(kept([...go, ...back], CAPTURE)).toBeNull();
  });

  it("un demi-tour « ( » : la personne doit refaire un tour complet (avant : la moitié de la pièce)", () => {
    for (const image of IMAGES) expect(kept(arc(image.width / 2, image.height / 2, 30, 40, 90, 180, 30), image)).toBeNull();
  });

  it("taille d'affichage encore inconnue : rien n'est retenu", () => {
    expect(zoneFromTrace(loop(0.5, 0.5, 0.2, 0.1), { width: 0, height: 0 })).toBeNull();
  });
});

describe("un balayage pour faire défiler la page n'entoure rien", () => {
  it("le cas relevé : arc de 150 points de corde et 300 de rayon sur une capture verticale (avant : zone de 13 % × 45 %)", () => {
    expect(kept(thumbSwipe({ x: 90, y: 300 }, 150, 300, -90, 1), CAPTURE)).toBeNull();
  });

  it("arcs du pouce de 100 à 260 points, rayons de 200 à 650, dans toutes les directions, sur les trois tailles d'image", () => {
    for (const image of IMAGES)
      for (const chord of [100, 150, 200, 260])
        for (const radius of [200, 300, 450, 650])
          for (let angle = 0; angle < 360; angle += 30)
            for (const side of [1, -1] as const) expect(kept(thumbSwipe({ x: image.width / 2, y: image.height / 2 }, chord, radius, angle, side), image)).toBeNull();
  });

  it("tirés au hasard, partis de n'importe où sur l'image : moins de 1 % retenus (restent quelques balayages très courbés, partis d'un bord, qui ont la forme d'un quart d'arc)", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const image of IMAGES) {
      let retained = 0;
      for (let draw = 0; draw < 2000; draw += 1) {
        const start = { x: random() * image.width, y: random() * image.height };
        if (kept(thumbSwipe(start, 100 + random() * 160, 200 + random() * 450, random() * 360, random() < 0.5 ? 1 : -1), image)) retained += 1;
      }
      expect(retained / 2000).toBeLessThan(0.01);
    }
  });
});

describe("pièce coupée par le bord : le bord referme le tour", () => {
  it("une arche posée sur le bord bas, partie du bord et arrêtée juste au-dessus", () => {
    for (const image of IMAGES) {
      const fingers = arc(image.width / 2, image.height, 50, 60, 180, 180, 40);
      fingers[fingers.length - 1] = { x: fingers.at(-1)!.x, y: image.height - 8 };
      const zone = kept(fingers, image)!;
      expect(zone.y + zone.height).toBeCloseTo(1);
    }
  });

  it("un quart d'arc autour d'une pièce dans un coin", () => {
    for (const image of IMAGES) {
      const zone = kept(arc(image.width, 0, 60, 70, 180, -90, 30), image)!;
      expect(zone.x + zone.width).toBeCloseTo(1);
      expect(zone.y).toBe(0);
    }
  });

  it("pas retenus : un balayage qui longe un bord, qui coupe un coin presque droit, ou qui traverse l'image d'un bord à l'autre", () => {
    for (const image of IMAGES) {
      // Le long du bord droit, parti dans la marge (ramené au bord), bombé vers l'intérieur.
      expect(kept(thumbSwipe({ x: image.width + 6, y: image.height - 20 }, 220, 500, -90, 1), image)).toBeNull();
      // Du bas vers le bord droit, presque en ligne droite.
      expect(kept(thumbSwipe({ x: image.width - 90, y: image.height - 6 }, 150, 600, -45, 1), image)).toBeNull();
      // D'un bord à l'autre (côtés opposés).
      expect(kept(thumbSwipe({ x: 2, y: image.height / 2 }, image.width + 40, 400, 0, 1), image)).toBeNull();
    }
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

  it("le tracé en points du cadre ; une fois retenu, refermé s'il s'arrête en revenant vers son départ (un « C »)", () => {
    const c = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0, y: 0.3 },
    ];
    expect(tracePath(c, box, false)).toBe("M10 20L110 20L110 220L10 220L10 80");
    expect(tracePath(c, box, true)).toBe("M10 20L110 20L110 220L10 220L10 80Z");
    expect(tracePath([{ x: 1 / 3, y: 0 }], box, true)).toBe("M43.3 20");
  });

  it("laissé ouvert s'il a déjà dépassé son départ, ou s'il s'appuie sur le bord (pas de trait en travers de la pièce)", () => {
    const beyond = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
    ];
    expect(tracePath(beyond, box, true)).not.toMatch(/Z$/);
    // Quart d'arc autour d'une pièce dans le coin en haut à gauche.
    const corner = [
      { x: 0.5, y: 0 },
      { x: 0.433, y: 0.125 },
      { x: 0.25, y: 0.2165 },
      { x: 0, y: 0.25 },
    ];
    expect(tracePath(corner, box, true)).toBe("M60 20L53.3 45L35 63.3L10 70");
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
    // Juste dans tous les cas de refus : toucher, trait, balayage, boucle trop petite ou pas refermée.
    expect(fr.targeting.tooSmall).toBe("Faites un tour complet, un peu plus large que la pièce.");
    expect(en.targeting.tooSmall).toBe("Draw a full loop, a little wider than the piece.");
    expect(en.targeting.instruction.finger).toBe("Circle the piece with your finger");
    expect(en.targeting.wholeImage).toBe("Use the whole image");
  });

  it("VoiceOver : la consigne, puis le bouton à toucher (espaces insécables dans « »)", () => {
    expect(fr.crop.hint(fr.targeting.instruction.finger, fr.targeting.wholeImage)).toBe(
      "Entourez la pièce avec votre doigt, ou touchez « Utiliser toute l'image »."
    );
    expect(en.crop.hint(en.targeting.instruction.finger, en.targeting.wholeImage)).toBe("Circle the piece with your finger, or tap “Use the whole image”.");
  });

  it("plus aucun texte ne parle de faire glisser le cadre ou ses coins, ni d'essayer un autre cadre", () => {
    for (const text of [fr.targeting.caption, fr.crop.hint("x", "y"), fr.launch.frameHint, fr.result.noPriceText]) expect(text).not.toMatch(/cadre|coins/);
    for (const text of [en.targeting.caption, en.crop.hint("x", "y"), en.launch.frameHint, en.result.noPriceText, en.preview.target]) expect(text).not.toMatch(/frame|corners/i);
    expect(en.preview.target).toBe("Circle the piece");
  });
});
