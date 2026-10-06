import { describe, expect, it } from "vitest";
import {
  VIDEO_MAX_BYTES,
  clampTime,
  durationSeconds,
  filmstripTimes,
  formatClock,
  formatClockTenths,
  megabytes,
  ratioOfTime,
  timeAtRatio,
  videoRejection,
} from "../src/lib/video-timeline";

describe("vidéo importée dans le Spotter (lot 4)", () => {
  it("refuse au-delà de 100 Mo, avant même de lire la vidéo", () => {
    expect(videoRejection({ durationMs: null, sizeBytes: VIDEO_MAX_BYTES + 1 })).toBe("too_large");
    expect(videoRejection({ durationMs: 12_000, sizeBytes: VIDEO_MAX_BYTES })).toBeNull();
  });

  it("refuse au-delà de 60 secondes, mais accepte une vidéo affichée « 1:00 »", () => {
    expect(videoRejection({ durationMs: 60_400, sizeBytes: 5_000_000 })).toBeNull();
    expect(videoRejection({ durationMs: 60_999, sizeBytes: null })).toBeNull();
    expect(videoRejection({ durationMs: 61_000, sizeBytes: null })).toBe("too_long");
    expect(videoRejection({ durationMs: 72_000, sizeBytes: 5_000_000 })).toBe("too_long");
  });

  it("une durée inconnue ou nulle signale une vidéo illisible", () => {
    expect(videoRejection({ durationMs: null, sizeBytes: 1_000 })).toBe("unreadable");
    expect(videoRejection({ durationMs: 0, sizeBytes: 1_000 })).toBe("unreadable");
    expect(videoRejection({ durationMs: Number.NaN, sizeBytes: null })).toBe("unreadable");
  });

  it("le curseur donne un moment entre le début et juste avant la fin", () => {
    expect(timeAtRatio(0, 12_000)).toBe(0);
    expect(timeAtRatio(0.5, 12_000)).toBe(6_000);
    expect(timeAtRatio(1, 12_000)).toBe(11_950);
    expect(timeAtRatio(-0.2, 12_000)).toBe(0);
    expect(clampTime(20_000, 12_000)).toBe(11_950);
    expect(ratioOfTime(6_000, 12_000)).toBe(0.5);
    expect(ratioOfTime(6_000, 0)).toBe(0);
  });

  it("frise : une vignette au milieu de chaque tranche, dans l'ordre", () => {
    expect(filmstripTimes(12_000, 4)).toEqual([1_500, 4_500, 7_500, 10_500]);
    const times = filmstripTimes(60_000, 8);
    expect(times).toHaveLength(8);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(Math.max(...times)).toBeLessThan(60_000);
  });

  it("affiche les durées comme une horloge, les tailles en mégaoctets", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(7_400)).toBe("0:07");
    expect(formatClock(60_000)).toBe("1:00");
    expect(formatClock(72_900)).toBe("1:12");
    expect(megabytes(142_400_000)).toBe(142);
    expect(durationSeconds(12_600)).toBe(13);
  });

  it("curseur fin (pas de 0,1 s) : position au dixième, séparateur de la langue", () => {
    expect(formatClockTenths(6_000, ",")).toBe("0:06,0");
    expect(formatClockTenths(6_249, ",")).toBe("0:06,2");
    expect(formatClockTenths(72_950, ".")).toBe("1:12.9");
    expect(formatClockTenths(-5, ",")).toBe("0:00,0");
  });
});
