import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductSearch } from "@monapp/shared-types";

// Lot « vidéo auto » : la demande d'analyse d'un lien (délai, « Annuler »,
// statistiques sans le lien) et le passage du moment choisi à la recherche
// habituelle, jusqu'au spot noté pour la vidéo. Serveur SIMULÉ : aucun appel
// à TikTok, Instagram, l'IA ni la recherche d'image.
const { storage, analyzeVideoLink, recordVideoSpot, prepareSearch, runSearch, track, discardLocalFile } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  analyzeVideoLink: vi.fn(),
  recordVideoSpot: vi.fn(async (_request: unknown) => undefined),
  prepareSearch: vi.fn(),
  runSearch: vi.fn(),
  track: vi.fn(),
  discardLocalFile: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => void storage.set(key, value)),
    removeItem: vi.fn(async (key: string) => void storage.delete(key)),
  },
}));
vi.mock("../src/lib/api", async () => ({
  ApiError: (await import("../src/lib/api-error")).ApiError,
  analyzeVideoLink,
  recordVideoSpot,
  prepareSearch,
  runSearch,
  fetchSearch: vi.fn(),
  fetchConsentStatus: vi.fn(),
  fetchVideoAiEnabled: vi.fn(),
  findVideoMoments: vi.fn(),
}));
vi.mock("../src/lib/analytics", () => ({ track }));
vi.mock("../src/lib/error-tracking", () => ({ reportUnexpectedError: vi.fn() }));
vi.mock("../src/lib/video-frames", () => ({ discardLocalFile }));
vi.mock("../src/lib/image-import", () => ({ SPOTTER_IMAGE_MAX_EDGE: 1600 }));

import { ApiError } from "../src/lib/api-error";
import { clearDraft, getDraft, leaveLaunchScreen } from "../src/lib/spot-draft";
import { launchPhoto, photoCrop } from "../src/lib/spot-launch";
import "../src/lib/video-context";
import { parseLinkAnalysis, type LinkAnalysis } from "../src/lib/video-link-analysis";
import { momentVideoContext, runLinkAnalysis, startMomentSearch } from "../src/lib/video-link-run";
import { jpegDataUri } from "./fake-jpeg";

const TIKTOK = "https://www.tiktok.com/@lea.style/video/7312345678901234567";
const QUERY = "la veste en cuir beige de la fille à gauche";
const BEST = { x: 0.1, y: 0.2, width: 0.4, height: 0.5 };
const OTHER = { x: 0.5, y: 0.3, width: 0.3, height: 0.4 };
const IMAGE_BEST = jpegDataUri(720, 1280);
const IMAGE_OTHER = jpegDataUri(720, 1281);

function analysis(): LinkAnalysis {
  return parseLinkAnalysis({
    video: { platform: "tiktok", videoKey: "7312345678901234567", canonicalUrl: TIKTOK, creatorHandle: "lea.style" },
    moments: [
      { timeSeconds: 4.2, image: IMAGE_BEST, box: BEST },
      { timeSeconds: 12.8, image: IMAGE_OTHER, box: OTHER },
    ],
  })!;
}

const search = (id: string): ProductSearch =>
  ({ id, sourceUrl: null, sourcePlatform: "photo", method: "manual_screenshot", status: "completed", errorMessage: null, query: null, createdAt: "", matches: [{ id: "m" }] }) as unknown as ProductSearch;

/** Tout ce qui est parti dans les statistiques, en texte. */
const tracked = () => JSON.stringify(track.mock.calls);

beforeEach(() => {
  vi.clearAllMocks();
  storage.clear();
  clearDraft();
});

describe("la demande d'analyse", () => {
  it("moments trouvés : renvoyés tels quels ; les statistiques ne disent ni le lien ni les mots", async () => {
    analyzeVideoLink.mockResolvedValue(analysis());
    const outcome = await runLinkAnalysis({ url: TIKTOK, query: QUERY }, "tiktok", new AbortController().signal);
    expect(outcome).toEqual({ kind: "found", analysis: analysis() });
    expect(analyzeVideoLink).toHaveBeenCalledWith({ url: TIKTOK, query: QUERY }, expect.any(AbortSignal));
    expect(track).toHaveBeenCalledWith("video_link_ai_started", { platform: "tiktok" });
    expect(track).toHaveBeenCalledWith("video_link_ai_result", { platform: "tiktok", outcome: "found", moments_count: 2 });
    expect(tracked()).not.toContain("tiktok.com");
    expect(tracked()).not.toContain("veste");
  });

  it("aucun moment : « pièce non repérée », un résultat et pas une panne", async () => {
    analyzeVideoLink.mockResolvedValue({ ...analysis(), moments: [] });
    const outcome = await runLinkAnalysis({ url: TIKTOK, query: QUERY }, "tiktok", new AbortController().signal);
    expect(outcome).toEqual({ kind: "failed", info: { failure: "no_moment", capacity: null } });
    expect(track).toHaveBeenCalledWith("video_link_ai_result", { platform: "tiktok", outcome: "not_found", reason: "no_moment", moments_count: 0 });
  });

  it("vidéo privée, service vidéo occupé, accord manquant : l'échec du serveur est traduit", async () => {
    analyzeVideoLink.mockRejectedValueOnce(new ApiError(451, { error: "video_private", message: "x" }));
    expect(await runLinkAnalysis({ url: TIKTOK, query: QUERY }, "instagram", new AbortController().signal)).toEqual({ kind: "failed", info: { failure: "private", capacity: null } });
    analyzeVideoLink.mockRejectedValueOnce(new ApiError(503, { error: "video_busy", message: "x" }));
    expect(await runLinkAnalysis({ url: TIKTOK, query: QUERY }, "tiktok", new AbortController().signal)).toMatchObject({ info: { failure: "busy" } });
    analyzeVideoLink.mockRejectedValueOnce(new ApiError(403, { error: "video_ai_consent_required", message: "x" }));
    expect(await runLinkAnalysis({ url: TIKTOK, query: QUERY }, "tiktok", new AbortController().signal)).toMatchObject({ info: { failure: "consent" } });
    expect(track).toHaveBeenCalledWith("video_link_ai_result", { platform: "instagram", outcome: "failed", reason: "private", moments_count: 0 });
  });

  it("« Annuler » : la demande est abandonnée, rien n'est affiché ensuite", async () => {
    analyzeVideoLink.mockImplementation((_request, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const controller = new AbortController();
    const pending = runLinkAnalysis({ url: TIKTOK, query: QUERY }, "tiktok", controller.signal);
    controller.abort();
    expect(await pending).toEqual({ kind: "cancelled" });
    expect(track).toHaveBeenCalledWith("video_link_ai_result", { platform: "tiktok", outcome: "cancelled", moments_count: 0 });
    expect(await runLinkAnalysis({ url: TIKTOK, query: QUERY }, "tiktok", controller.signal)).toEqual({ kind: "cancelled" });
  });

  it("serveur muet au-delà du délai de l'app : l'attente s'arrête sur « délai dépassé »", async () => {
    let aborted = false;
    analyzeVideoLink.mockImplementation(
      (_request, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          })
        )
    );
    const outcome = await runLinkAnalysis({ url: TIKTOK, query: QUERY }, "tiktok", new AbortController().signal, 20);
    expect(aborted).toBe(true);
    expect(outcome).toEqual({ kind: "failed", info: { failure: "timeout", capacity: null } });
  });
});

describe("« Choisir ce moment » : comme un moment d'une vidéo du téléphone", () => {
  it("l'image du moment choisi (en mémoire) et le cadre de l'IA deviennent la recherche habituelle, vidéo associée", () => {
    const draft = startMomentSearch(analysis(), 1, "web")!;
    expect(draft.localImageUri).toBe(IMAGE_OTHER);
    expect(draft.imageSize).toEqual({ width: 720, height: 1281 });
    expect(draft.crop).toEqual(OTHER);
    expect(draft.zoneByAi).toBe(true);
    expect(draft.words).toBeNull();
    expect(draft.video).toEqual({ url: TIKTOK, platform: "tiktok", creatorHandle: "lea.style", source: "web", momentSeconds: 12 });
    // Rien à effacer de l'appareil : l'image n'y a jamais été écrite.
    expect(draft.discardImageAfterSearch).toBe(false);
    expect(track).toHaveBeenCalledWith("video_link_ai_moment_chosen", { platform: "tiktok", rank: 2, moments_count: 2 });
    expect(tracked()).not.toContain("data:");
  });

  it("app iPhone : source « app » ; moment absent : rien ne part", () => {
    expect(momentVideoContext(analysis(), analysis().moments[0]!, "app")).toMatchObject({ source: "app", momentSeconds: 4 });
    expect(startMomentSearch(analysis(), 5, "app")).toBeNull();
    expect(getDraft()).toBeNull();
  });

  it("lancée depuis « Entourez la pièce » avec le cadre de l'IA : l'image et ce cadre partent, sans les mots ; le spot est noté pour la vidéo", async () => {
    startMomentSearch(analysis(), 0, "app");
    prepareSearch.mockResolvedValueOnce({ id: "s-42" });
    runSearch.mockResolvedValueOnce(search("s-42"));
    const draft = getDraft()!;
    expect(await launchPhoto(draft, new AbortController().signal, photoCrop(draft))).toEqual({ kind: "result", searchId: "s-42" });
    expect(runSearch).toHaveBeenCalledWith("s-42", { crop: BEST, imageUri: IMAGE_BEST, words: null, zoneByAi: true }, expect.any(AbortSignal));
    expect(recordVideoSpot).toHaveBeenCalledWith({ url: TIKTOK, searchId: "s-42", source: "app", momentSeconds: 4 });
    expect(discardLocalFile).not.toHaveBeenCalled();
    // Image toujours en mémoire pour « Recadrer » ; oubliée avec le parcours.
    expect(getDraft()?.localImageUri).toBe(IMAGE_BEST);
    leaveLaunchScreen();
    clearDraft();
    expect(getDraft()).toBeNull();
  });
});
