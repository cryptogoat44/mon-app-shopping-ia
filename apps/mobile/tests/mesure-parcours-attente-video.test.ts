import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkAnalysis } from "../src/lib/video-link-analysis";

// Lot « mesure du parcours » : temps d'attente des deux analyses par l'IA —
// celle d'un lien TikTok ou Instagram (video_link_ai_result) et celle d'une
// vidéo du téléphone (video_ai_result), du départ à l'issue. Serveur et IA
// SIMULÉS, horloge simulée : des durées exactes.
const { findVideoMoments, analyzeVideoLink, track } = vi.hoisted(() => ({ findVideoMoments: vi.fn(), analyzeVideoLink: vi.fn(), track: vi.fn() }));
vi.mock("../src/lib/api", async () => ({ ApiError: (await import("../src/lib/api-error")).ApiError, findVideoMoments, analyzeVideoLink }));
vi.mock("../src/lib/analytics", () => ({ track }));
vi.mock("../src/lib/spot-flow", () => ({ beginFromPhoto: vi.fn() }));
vi.mock("../src/lib/video-frames", () => ({ discardLocalFile: vi.fn() }));
vi.mock("../src/lib/image-import", () => ({ SPOTTER_IMAGE_MAX_EDGE: 1600 }));

import { ApiError } from "../src/lib/api-error";
import { analyzeVideo } from "../src/lib/video-auto";
import { runLinkAnalysis } from "../src/lib/video-link-run";
import { __setWaitClock } from "../src/lib/wait-clock";
import { fakeVideo } from "./fake-video";

const REQUEST = { url: "https://www.tiktok.com/@lea.style/video/7312345678901234567", query: "la veste en cuir beige" };
const FOUND = { video: { platform: "tiktok" }, moments: [{}, {}] } as unknown as LinkAnalysis;
const BOX = { x: 0.2, y: 0.3, width: 0.5, height: 0.4 };
const results = (name: string) => track.mock.calls.filter(([event]) => event === name).map(([, props]) => props as Record<string, unknown>);

let now = 0;

beforeEach(() => {
  vi.clearAllMocks();
  now = 50_000;
  __setWaitClock(() => now);
});

afterEach(() => __setWaitClock(null));

describe("analyse d'un lien : video_link_ai_result dit l'attente depuis le départ", () => {
  it("moments trouvés", async () => {
    analyzeVideoLink.mockImplementation(async () => {
      now += 25_400;
      return FOUND;
    });
    await runLinkAnalysis(REQUEST, "tiktok", new AbortController().signal);
    expect(results("video_link_ai_result")).toEqual([{ platform: "tiktok", outcome: "found", moments_count: 2, wait_ms: 25_400 }]);
  });

  it("vidéo privée (plan B) : l'échec et son attente", async () => {
    analyzeVideoLink.mockImplementation(async () => {
      now += 4_000;
      throw new ApiError(422, { error: "video_unavailable", message: "x", cause: "private_or_removed" } as never);
    });
    await runLinkAnalysis(REQUEST, "instagram", new AbortController().signal);
    expect(results("video_link_ai_result")).toEqual([{ platform: "instagram", outcome: "failed", reason: "private", moments_count: 0, wait_ms: 4_000 }]);
  });

  it("« Annuler » : le temps d'attente avant d'abandonner", async () => {
    analyzeVideoLink.mockImplementation((_request, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const controller = new AbortController();
    const pending = runLinkAnalysis(REQUEST, "tiktok", controller.signal);
    now += 9_000;
    controller.abort();
    await pending;
    expect(results("video_link_ai_result")).toEqual([{ platform: "tiktok", outcome: "cancelled", moments_count: 0, wait_ms: 9_000 }]);
  });

  it("délai de l'app dépassé : « timeout », avec toute l'attente", async () => {
    analyzeVideoLink.mockImplementation(
      (_request, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => {
            now += 90_000;
            reject(new Error("aborted"));
          })
        )
    );
    await runLinkAnalysis(REQUEST, "tiktok", new AbortController().signal, 5);
    expect(results("video_link_ai_result")).toEqual([{ platform: "tiktok", outcome: "failed", reason: "timeout", moments_count: 0, wait_ms: 90_000 }]);
  });

  it("refusée avant le départ (déjà annulée) : ni départ ni issue", async () => {
    const controller = new AbortController();
    controller.abort();
    await runLinkAnalysis(REQUEST, "tiktok", controller.signal);
    expect(track).not.toHaveBeenCalled();
  });
});

describe("analyse d'une vidéo du téléphone : video_ai_result dit l'attente depuis le départ", () => {
  // Images tirées sur l'appareil (1,5 s), puis l'IA : l'attente compte les deux.
  const onStep = (step: string) => {
    if (step === "frames") now += 1_500;
  };

  it("moments trouvés", async () => {
    findVideoMoments.mockImplementation(async () => {
      now += 6_000;
      return [{ frame: 1, box: BOX }];
    });
    await analyzeVideo(fakeVideo(), "veste", onStep);
    expect(results("video_ai_result")).toEqual([{ outcome: "found", moments_count: 1, wait_ms: 7_500 }]);
  });

  it("aucun moment, plafond atteint ou panne : l'issue et son attente, une seule fois", async () => {
    findVideoMoments.mockImplementationOnce(async () => {
      now += 2_000;
      return [];
    });
    await analyzeVideo(fakeVideo(), "veste", onStep);
    findVideoMoments.mockImplementationOnce(async () => {
      now += 300;
      throw new ApiError(429, { error: "search_capacity_user", message: "…" });
    });
    await analyzeVideo(fakeVideo(), "veste", onStep);
    findVideoMoments.mockImplementationOnce(async () => {
      now += 40_000;
      throw new TypeError("Network request failed");
    });
    await analyzeVideo(fakeVideo(), "veste", onStep);
    expect(results("video_ai_result")).toEqual([
      { outcome: "not_found", moments_count: 0, wait_ms: 3_500 },
      { outcome: "limit", moments_count: 0, wait_ms: 1_800 },
      { outcome: "unavailable", moments_count: 0, wait_ms: 41_500 },
    ]);
  });
});
