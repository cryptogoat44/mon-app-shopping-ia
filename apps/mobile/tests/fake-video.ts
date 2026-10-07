import { vi } from "vitest";
import type { FrameSample } from "../src/lib/frame-sample";
import type { OpenedVideo } from "../src/lib/video-timeline";

// Vidéo factice de 12 s en trois plans (lot 4, temps 1 bis), commune aux
// tests de l'analyse automatique et du parcours unique (lot 4 ter).

/** Trois plans nets et différents : rayures verticales, horizontales, damier,
 * chacun de sa couleur. */
export function sceneImage(scene: number): FrameSample {
  const width = 54;
  const height = 96;
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const on = scene === 0 ? Math.floor(x / 6) % 2 : scene === 1 ? Math.floor(y / 8) % 2 : (Math.floor(x / 9) + Math.floor(y / 9)) % 2;
      gray[y * width + x] = on ? 210 : 40;
    }
  const color = [[200, 60, 60], [60, 200, 60], [60, 60, 200]][scene] ?? [0, 0, 0];
  return { gray, width, height, colors: Array.from({ length: 9 }, () => color).flat() };
}

export function fakeVideo(): OpenedVideo & { frameFile: ReturnType<typeof vi.fn> } {
  return {
    durationMs: 12_000,
    filmstrip: vi.fn(),
    preview: vi.fn(),
    sampleFrame: vi.fn(async (timeMs: number) => sceneImage(Math.floor(timeMs / 4000))),
    frameFile: vi.fn(async (timeMs: number, maxEdge: number) => ({
      uri: `file:///cache/image-${timeMs}-${maxEdge}.jpg`,
      width: maxEdge === 512 ? 288 : 900,
      height: maxEdge === 512 ? 512 : 1600,
    })),
    release: vi.fn(),
  };
}
