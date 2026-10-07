import { beforeEach, describe, expect, it, vi } from "vitest";

const { launchImageLibraryAsync, openVideo, discardLocalFile, track } = vi.hoisted(() => ({
  launchImageLibraryAsync: vi.fn(),
  openVideo: vi.fn(),
  discardLocalFile: vi.fn(),
  track: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-image-picker", () => ({
  launchImageLibraryAsync,
  UIImagePickerPreferredAssetRepresentationMode: { Current: "current" },
  VideoExportPreset: { Passthrough: 0 },
}));
vi.mock("../src/lib/video-frames", () => ({ openVideo, discardLocalFile }));
vi.mock("../src/lib/analytics", () => ({ track }));
vi.mock("../src/lib/image-import", () => ({ SPOTTER_IMAGE_MAX_EDGE: 1600 }));
vi.mock("../src/lib/spot-flow", () => ({ beginFromPhoto: vi.fn() }));

import { adoptSpotVideo, importSpotVideo, releaseSpotVideo, videoImportMessage } from "../src/lib/spot-video";

function openedVideo(durationMs: number) {
  return { durationMs, filmstrip: vi.fn(), preview: vi.fn(), frameFile: vi.fn(), release: vi.fn() };
}

function picked(fileSize: number) {
  return { canceled: false, assets: [{ uri: "file:///cache/video.mov", fileSize }] };
}

describe("vidéo importée dans le Spotter (lot 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    releaseSpotVideo();
  });

  it("vidéo indisponible (iPhone : restée sur iCloud, sans connexion) : message clair, jamais d'erreur muette", async () => {
    launchImageLibraryAsync.mockRejectedValue(new Error("Failed to read the video"));
    const result = await importSpotVideo();
    expect(result).toEqual({ kind: "unavailable" });
    expect(videoImportMessage(result)).toMatch(/iCloud/);
    expect(track).not.toHaveBeenCalled();
  });

  it("choix annulé : rien à dire", async () => {
    launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
    const result = await importSpotVideo();
    expect(result).toEqual({ kind: "cancelled" });
    expect(videoImportMessage(result)).toBeNull();
  });

  it("trop lourde : refusée avant toute lecture, copie effacée, statistique sans contenu", async () => {
    launchImageLibraryAsync.mockResolvedValue(picked(101_000_000));
    const result = await importSpotVideo();
    expect(result).toMatchObject({ kind: "rejected", reason: "too_large" });
    expect(openVideo).not.toHaveBeenCalled();
    expect(discardLocalFile).toHaveBeenCalledWith("file:///cache/video.mov");
    expect(videoImportMessage(result)).toContain("101 Mo");
    expect(track).toHaveBeenCalledWith("video_rejected", { reason: "too_large", source: "library", duration_s: undefined });
  });

  it("trop longue : vidéo libérée, durée affichée", async () => {
    const video = openedVideo(65_000);
    launchImageLibraryAsync.mockResolvedValue(picked(20_000_000));
    openVideo.mockResolvedValue(video);
    const result = await importSpotVideo();
    expect(result).toMatchObject({ kind: "rejected", reason: "too_long" });
    expect(video.release).toHaveBeenCalled();
    expect(videoImportMessage(result)).toContain("1:05");
  });

  it("vidéo valable : prête, statistique limitée à la durée et à la source", async () => {
    launchImageLibraryAsync.mockResolvedValue(picked(20_000_000));
    openVideo.mockResolvedValue(openedVideo(12_000));
    const result = await importSpotVideo();
    expect(result).toEqual({ kind: "ready" });
    expect(videoImportMessage(result)).toBeNull();
    expect(track).toHaveBeenCalledWith("video_imported", { duration_s: 12, source: "library" });
  });
});

describe("dernière vidéo de la galerie (lot 4 ter, app iPhone)", () => {
  const GALERIE = "file:///var/mobile/Media/DCIM/100APPLE/IMG_0001.MOV";

  beforeEach(() => {
    vi.clearAllMocks();
    releaseSpotVideo();
  });

  it("ouverte sans être copiée ni jamais effacée ; statistique « latest »", async () => {
    openVideo.mockResolvedValue(openedVideo(12_000));
    expect(await adoptSpotVideo(GALERIE, null, "latest")).toEqual({ kind: "ready" });
    expect(openVideo).toHaveBeenCalledWith(GALERIE, { keepFile: true });
    expect(track).toHaveBeenCalledWith("video_imported", { duration_s: 12, source: "latest" });
    releaseSpotVideo();
    expect(discardLocalFile).not.toHaveBeenCalled();
  });

  it("illisible ou trop lourde : refusée, mais le fichier de la galerie n'est pas touché", async () => {
    openVideo.mockRejectedValue(new Error("video_unreadable"));
    expect(await adoptSpotVideo(GALERIE, null, "latest")).toMatchObject({ kind: "rejected", reason: "unreadable" });
    expect(await adoptSpotVideo(GALERIE, 150_000_000, "latest")).toMatchObject({ kind: "rejected", reason: "too_large" });
    expect(discardLocalFile).not.toHaveBeenCalled();
  });

  it("copie faite par le sélecteur : effacée quand elle est refusée", async () => {
    openVideo.mockRejectedValue(new Error("video_unreadable"));
    await adoptSpotVideo("file:///cache/video.mov", null, "library");
    expect(openVideo).toHaveBeenCalledWith("file:///cache/video.mov", { keepFile: false });
    expect(discardLocalFile).toHaveBeenCalledWith("file:///cache/video.mov");
  });
});
