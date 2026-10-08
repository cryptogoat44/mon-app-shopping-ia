import { beforeEach, describe, expect, it, vi } from "vitest";

// Lot 4, temps 1 bis : enchaînement de l'analyse automatique dans l'app.
// Vidéo factice de 12 s en trois plans ; IA SIMULÉE (aucun appel réel).
const { findVideoMoments, track, beginFromPhoto, discardLocalFile, ApiError } = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      public status: number,
      public body: { error: string; message: string }
    ) {
      super(body.message);
    }
  }
  return { findVideoMoments: vi.fn(), track: vi.fn(), beginFromPhoto: vi.fn(), discardLocalFile: vi.fn(), ApiError };
});
vi.mock("../src/lib/api", () => ({ ApiError, findVideoMoments }));
vi.mock("../src/lib/analytics", () => ({ track }));
vi.mock("../src/lib/spot-flow", () => ({ beginFromPhoto }));
vi.mock("../src/lib/video-frames", () => ({ discardLocalFile }));
vi.mock("../src/lib/image-import", () => ({ SPOTTER_IMAGE_MAX_EDGE: 1600 }));

import { getDraft, startDraft } from "../src/lib/spot-draft";
import { analyzeVideo, lastTriedMoment, prepareMoment, remainingMoments } from "../src/lib/video-auto";
import { fakeVideo } from "./fake-video";

const BOX = { x: 0.2, y: 0.3, width: 0.5, height: 0.4 };
const onStep = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // Brouillon local, sans appel au serveur (lot 4 ter) : la recherche se prépare au lancement.
  beginFromPhoto.mockImplementation((uri: string, size: { width: number; height: number }) =>
    startDraft({ searchId: null, sourceUrl: null, platform: "photo", previewUrl: null, localImageUri: uri, imageSize: size })
  );
});

describe("analyse automatique — étages 1 et 2", () => {
  it("une image nette par plan, réduite à 512 px, envoyée avec la description puis effacée ; moments rattachés à leur instant", async () => {
    const video = fakeVideo();
    findVideoMoments.mockResolvedValue([
      { frame: 1, box: BOX },
      { frame: 2, box: BOX },
    ]);
    const outcome = await analyzeVideo(video, " veste en daim ", onStep);
    expect(outcome).toEqual({ kind: "found" });
    expect(onStep.mock.calls.map(([step]) => step)).toEqual(["frames", "ai"]);
    const [uris, query] = findVideoMoments.mock.calls[0]!;
    expect(uris).toHaveLength(3);
    expect(query).toBe(" veste en daim ");
    expect(video.frameFile.mock.calls.every(([, maxEdge]) => maxEdge === 512)).toBe(true);
    expect(discardLocalFile.mock.calls.map(([uri]) => uri)).toEqual(uris);
    expect(track).toHaveBeenCalledWith("video_ai_frames_sent", { frames_count: 3, duration_s: 12 });
    expect(track).toHaveBeenCalledWith("video_ai_result", { outcome: "found", moments_count: 2 });
    expect(remainingMoments(video)).toEqual([0, 1]);
  });

  it("pièce non repérée (« aucun moment ») : un résultat, pas une panne ; aucune recherche lancée, donc aucun crédit SerpApi ; rien n'est gardé", async () => {
    const video = fakeVideo();
    findVideoMoments.mockResolvedValue([]);
    expect(await analyzeVideo(video, "veste", onStep)).toEqual({ kind: "not_found" });
    expect(remainingMoments(video)).toEqual([]);
    expect(lastTriedMoment(video)).toBeNull();
    expect(beginFromPhoto).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("video_ai_result", { outcome: "not_found", moments_count: 0 });
    expect(discardLocalFile).toHaveBeenCalledTimes(3);
  });

  it.each([
    [new ApiError(403, { error: "video_ai_consent_required", message: "…" }), "consent"],
    [new ApiError(503, { error: "video_ai_disabled", message: "…" }), "disabled"],
    [new ApiError(429, { error: "video_ai_user_limit", message: "…" }), "user_limit"],
    [new ApiError(429, { error: "video_ai_global_limit", message: "…" }), "global_limit"],
    [new ApiError(503, { error: "video_ai_unavailable", message: "…" }), "unavailable"],
    [new TypeError("Network request failed"), "network"],
  ])("échec %#: motif « %s », images tout de même effacées", async (error, reason) => {
    findVideoMoments.mockRejectedValue(error);
    expect(await analyzeVideo(fakeVideo(), "veste", onStep)).toEqual({ kind: "failed", reason });
    expect(discardLocalFile).toHaveBeenCalledTimes(3);
  });

  it("plafond des recherches atteint (lot 4 quater) : ni moment ni repli, le plafond en cause ; images tout de même effacées", async () => {
    findVideoMoments.mockRejectedValue(new ApiError(429, { error: "search_capacity_user", message: "…" }));
    expect(await analyzeVideo(fakeVideo(), "veste", onStep)).toEqual({ kind: "capacity", reason: "capacity_user" });
    expect(track).toHaveBeenCalledWith("video_ai_result", { outcome: "limit", moments_count: 0 });
    expect(discardLocalFile).toHaveBeenCalledTimes(3);
  });

  it("vidéo illisible sur l'appareil : rien n'est envoyé", async () => {
    const video = fakeVideo();
    video.sampleFrame = vi.fn(async () => {
      throw new Error("video_frame_missing");
    });
    expect(await analyzeVideo(video, "veste", onStep)).toEqual({ kind: "failed", reason: "video" });
    expect(findVideoMoments).not.toHaveBeenCalled();
  });

  it("« Annuler » : abandon silencieux, sans statistique de résultat", async () => {
    const abort = new AbortController();
    findVideoMoments.mockImplementation(async () => {
      abort.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    expect(await analyzeVideo(fakeVideo(), "veste", onStep, abort.signal)).toEqual({ kind: "cancelled" });
    expect(track).not.toHaveBeenCalledWith("video_ai_result", expect.anything());
  });
});

describe("analyse automatique — identification d'un moment", () => {
  it("image en pleine taille, cadre de l'IA et description : même chemin qu'une photo ; chaque essai est compté", async () => {
    const video = fakeVideo();
    findVideoMoments.mockResolvedValue([
      { frame: 1, box: BOX },
      { frame: 0, box: { x: 0, y: 0, width: 1, height: 1 } },
    ]);
    await analyzeVideo(video, "veste en daim", onStep);
    await prepareMoment(video, 0);
    expect(video.frameFile).toHaveBeenLastCalledWith(expect.any(Number), 1600);
    expect(beginFromPhoto).toHaveBeenCalledTimes(1);
    expect(getDraft()).toMatchObject({ crop: BOX, query: "veste en daim", imageSize: { width: 900, height: 1600 } });
    expect(track).toHaveBeenCalledWith("video_ai_moment_tried", { rank: 1 });
    expect(remainingMoments(video)).toEqual([1]);
    // Image n° 2 de l'envoi = deuxième plan (« Veste ») : le curseur y repartira.
    expect(lastTriedMoment(video)).toBeGreaterThanOrEqual(4000);
    expect(lastTriedMoment(video)).toBeLessThan(8000);
    await prepareMoment(video, 1);
    expect(lastTriedMoment(video)).toBeLessThan(4000);
    expect(track).toHaveBeenCalledWith("video_ai_moment_tried", { rank: 2 });
    expect(remainingMoments(video)).toEqual([]);
  });

  it("une autre vidéo (ou la vidéo libérée) : plus aucun moment proposé", async () => {
    const video = fakeVideo();
    findVideoMoments.mockResolvedValue([{ frame: 0, box: BOX }]);
    await analyzeVideo(video, "veste", onStep);
    const other = fakeVideo();
    expect(remainingMoments(other)).toEqual([]);
    expect(remainingMoments(null)).toEqual([]);
    expect(lastTriedMoment(other)).toBeNull();
    await expect(prepareMoment(other, 0)).rejects.toThrow("video_moment_missing");
  });
});
