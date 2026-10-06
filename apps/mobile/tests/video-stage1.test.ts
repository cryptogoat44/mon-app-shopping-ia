import { describe, expect, it } from "vitest";
import { candidateTimes, colorDifference, differenceHash, hammingDistance, selectFrames, sharpness, type FrameCandidate, type FrameSample } from "../src/lib/video-stage1";
import { toFrameSample } from "../src/lib/frame-sample";

// Étage 1 (lot 4, temps 1 bis) : netteté, quasi-doublons, choix de 8 à 12 images.
function image(width: number, height: number, pixel: (x: number, y: number) => number): FrameSample {
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) gray[y * width + x] = Math.max(0, Math.min(255, Math.round(pixel(x, y))));
  return toFrameSample(gray, width, height, 1);
}

/** Flou « en boîte » (3 × 3, répété) : ce que fait un flou de bougé. */
function blur(source: FrameSample, passes: number): FrameSample {
  let current = source;
  for (let pass = 0; pass < passes; pass += 1) {
    const previous = current;
    current = image(previous.width, previous.height, (x, y) => {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = Math.min(previous.width - 1, Math.max(0, x + dx));
          const ny = Math.min(previous.height - 1, Math.max(0, y + dy));
          sum += previous.gray[ny * previous.width + nx]!;
          count += 1;
        }
      return sum / count;
    });
  }
  return current;
}

const SHARP_SCENE = image(54, 96, (x, y) => ((Math.floor(x / 6) + Math.floor(y / 6)) % 2 ? 220 : 30));
const OTHER_SCENE = image(54, 96, (x, y) => (y < 48 ? 40 + x * 3 : 230 - x * 3));

/** Couleurs des 9 zones : une teinte unie. */
function teinte(red: number, green: number, blue: number): number[] {
  return Array.from({ length: 9 }, () => [red, green, blue]).flat();
}
const GRIS = teinte(120, 120, 120);

function candidate(timeMs: number, sharpnessValue: number, hash: string, colors: number[] = GRIS): FrameCandidate {
  return { timeMs, sharpness: sharpnessValue, hash, colors };
}
/** Empreinte qui diffère de `base` sur les `count` premiers bits. */
function flip(base: string, count: number): string {
  return [...base].map((bit, index) => (index < count ? (bit === "1" ? "0" : "1") : bit)).join("");
}
const BASE_HASH = "0101".repeat(16);
/** Empreintes pseudo-aléatoires (≈ 32 bits d'écart entre deux) : des plans tous différents. */
function randomHashes(count: number): string[] {
  let seed = 12345;
  return Array.from({ length: count }, () =>
    Array.from({ length: 64 }, () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed > 1073741824 ? "1" : "0";
    }).join("")
  );
}

describe("étage 1 : netteté et quasi-doublons", () => {
  it("une image nette mesure plus qu'une image floue, une image unie rien", () => {
    const sharp = sharpness(SHARP_SCENE);
    const blurred = sharpness(blur(SHARP_SCENE, 3));
    expect(sharp).toBeGreaterThan(blurred * 4);
    expect(sharpness(image(54, 96, () => 128))).toBe(0);
  });

  it("empreinte : image légèrement bruitée → presque la même ; autre scène → très différente", () => {
    const noise = (x: number, y: number) => ((x * 7 + y * 13) % 5) - 2;
    for (const scene of [SHARP_SCENE, OTHER_SCENE]) {
      const base = differenceHash(scene);
      expect(base).toMatch(/^[01]{64}$/);
      const noisy = image(54, 96, (x, y) => scene.gray[y * 54 + x]! + noise(x, y));
      expect(hammingDistance(base, differenceHash(noisy))).toBeLessThanOrEqual(6);
    }
    expect(hammingDistance(differenceHash(SHARP_SCENE), differenceHash(OTHER_SCENE))).toBeGreaterThan(20);
  });
});

describe("étage 1 : choix des images envoyées", () => {
  it("vidéo de trois plans fixes : une image par plan, dans l'ordre de la vidéo", () => {
    const hashes = [BASE_HASH, flip(BASE_HASH, 20), flip(BASE_HASH, 40)];
    const candidates = Array.from({ length: 24 }, (_, index) => candidate(index * 500, 100 + (index % 3), hashes[Math.floor(index / 8)]!));
    const kept = selectFrames(candidates);
    expect(kept).toHaveLength(3);
    expect(kept.map((frame) => frame.timeMs)).toEqual([...kept.map((frame) => frame.timeMs)].sort((a, b) => a - b));
    expect(new Set(kept.map((frame) => frame.hash)).size).toBe(3);
  });

  it("écarte les images floues (comparées aux meilleures de la vidéo)", () => {
    const candidates = [
      candidate(0, 100, BASE_HASH),
      candidate(500, 95, flip(BASE_HASH, 30)),
      candidate(1000, 20, flip(BASE_HASH, 50)),
      candidate(1500, 110, flip(BASE_HASH, 12)),
    ];
    expect(selectFrames(candidates).map((frame) => frame.timeMs)).toEqual([0, 500, 1500]);
  });

  it("12 images au plus, les plus nettes ; quasi-doublon = 6 bits d'écart ou moins", () => {
    const hashes = randomHashes(24);
    const many = Array.from({ length: 24 }, (_, index) => candidate(index * 500, 100 + index, hashes[index]!));
    const kept = selectFrames(many);
    expect(kept).toHaveLength(12);
    expect(Math.min(...kept.map((frame) => frame.sharpness))).toBe(112);
    for (const a of kept) for (const b of kept) if (a !== b) expect(hammingDistance(a.hash, b.hash)).toBeGreaterThan(6);
    expect(selectFrames([candidate(0, 50, BASE_HASH), candidate(500, 40, flip(BASE_HASH, 6))])).toHaveLength(1);
    expect(selectFrames([candidate(0, 50, BASE_HASH), candidate(500, 40, flip(BASE_HASH, 7))])).toHaveLength(2);
  });

  it("même forme, autres couleurs (la même pose, une autre veste) : deux plans ; couleurs à peine différentes : un seul", () => {
    const veste = teinte(90, 70, 50);
    const autreVeste = teinte(47, 62, 78);
    expect(colorDifference(veste, autreVeste)).toBeGreaterThan(20);
    // Marron et vert olive (vidéo d'essai : « Veste », « Chaussures ») : bien distincts.
    expect(selectFrames([candidate(0, 50, BASE_HASH, veste), candidate(500, 40, BASE_HASH, teinte(74, 90, 58))])).toHaveLength(2);
    expect(selectFrames([candidate(0, 50, BASE_HASH, veste), candidate(500, 40, BASE_HASH, autreVeste)])).toHaveLength(2);
    expect(selectFrames([candidate(0, 50, BASE_HASH, veste), candidate(500, 40, flip(BASE_HASH, 3), teinte(94, 72, 49))])).toHaveLength(1);
    // Une seule zone change (la veste occupe une partie de l'image) : deux plans.
    const unePiece = [...veste.slice(0, 12), 200, 40, 40, ...veste.slice(15)];
    expect(selectFrames([candidate(0, 50, BASE_HASH, veste), candidate(500, 40, BASE_HASH, unePiece)])).toHaveLength(2);
  });

  it("couleurs des 9 zones : moyenne de chaque tiers de l'image", () => {
    const rgba = new Uint8Array(6 * 6 * 4);
    for (let pixel = 0; pixel < 36; pixel += 1) {
      const column = Math.floor((pixel % 6) / 2);
      rgba.set(column === 0 ? [255, 0, 0, 255] : column === 1 ? [0, 255, 0, 255] : [0, 0, 255, 255], pixel * 4);
    }
    const sample = toFrameSample(rgba, 6, 6, 4);
    expect(sample.colors.slice(0, 9)).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    expect(sample.colors.slice(18, 27)).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255]);
  });

  it("vidéo entièrement unie ou floue : la plus nette est gardée ; aucune image : aucune", () => {
    const kept = selectFrames([candidate(0, 0.5, BASE_HASH), candidate(500, 1.5, flip(BASE_HASH, 30))]);
    expect(kept.map((frame) => frame.timeMs)).toEqual([500]);
    expect(selectFrames([])).toEqual([]);
  });

  it("moments examinés : une image toutes les 0,5 s, entre 12 et 24, dans la vidéo", () => {
    expect(candidateTimes(12_000)).toHaveLength(24);
    expect(candidateTimes(3_000)).toHaveLength(12);
    expect(candidateTimes(60_000)).toHaveLength(24);
    for (const time of candidateTimes(12_000)) {
      expect(time).toBeGreaterThanOrEqual(0);
      expect(time).toBeLessThan(12_000);
    }
  });
});
