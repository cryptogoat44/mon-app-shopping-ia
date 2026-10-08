import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsentStatus, ProductMatch, ProductSearch } from "@monapp/shared-types";

// Lot 4 ter : parcours unique — une vidéo ou une photo, quelques mots,
// « Lancer », puis tout s'enchaîne. IA et SerpApi SIMULÉS (aucun appel réel).
const { findVideoMoments, runSearch, prepareSearch, fetchConsentStatus, fetchVideoAiEnabled, track, reportUnexpectedError, ApiError } = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      public status: number,
      public body: { error: string; message: string }
    ) {
      super(body.message);
    }
  }
  return {
    findVideoMoments: vi.fn(),
    runSearch: vi.fn(),
    prepareSearch: vi.fn(),
    fetchConsentStatus: vi.fn(),
    fetchVideoAiEnabled: vi.fn(),
    track: vi.fn(),
    reportUnexpectedError: vi.fn(),
    ApiError,
  };
});
vi.mock("../src/lib/api", () => ({ ApiError, findVideoMoments, runSearch, prepareSearch, fetchConsentStatus, fetchVideoAiEnabled }));
vi.mock("../src/lib/analytics", () => ({ track }));
vi.mock("../src/lib/error-tracking", () => ({ reportUnexpectedError }));
vi.mock("../src/lib/video-frames", () => ({ discardLocalFile: vi.fn() }));
vi.mock("../src/lib/image-import", () => ({ SPOTTER_IMAGE_MAX_EDGE: 1600 }));

import { getLastSpotResult } from "../src/api/spotSession";
import { DEFAULT_CROP } from "../src/lib/crop-geometry";
import { getDraft, updateDraft } from "../src/lib/spot-draft";
import { beginFromPhoto } from "../src/lib/spot-flow";
import { identifyDraft } from "../src/lib/spot-identify";
import { checkVideoAi, identifyNextMoment, launchPhoto, launchVideo, videoAiChoice } from "../src/lib/spot-launch";
import { remainingMoments } from "../src/lib/video-auto";
import { fakeVideo } from "./fake-video";

const BOX = { x: 0.2, y: 0.3, width: 0.5, height: 0.4 };

function consent(partial: Partial<ConsentStatus>): ConsentStatus {
  return { type: "analyse_video_ia", grantedAt: null, decidedAt: null, version: null, isCurrent: false, ...partial };
}

function search(id: string, matches: number): ProductSearch {
  const match: ProductMatch = {
    id: "m1",
    rank: 1,
    productName: "Veste en daim",
    brand: null,
    imageUrl: "https://example.com/v.jpg",
    priceMin: 120,
    priceMax: 120,
    currency: "EUR",
    merchantName: "Example",
    merchantUrl: "https://example.com/v",
    imageHdUrl: null,
    affiliateUrl: "https://example.com/v",
  };
  return {
    id,
    sourceUrl: null,
    sourcePlatform: "photo",
    method: "manual_screenshot",
    thumbnailUrl: null,
    status: "completed",
    errorMessage: null,
    query: "veste en daim",
    createdAt: "2026-10-07T08:00:00Z",
    matches: Array.from({ length: matches }, (_, index) => ({ ...match, id: `m${index + 1}`, rank: index + 1 })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prepareSearch.mockResolvedValue({ id: "recherche-1", thumbnailUrl: null });
  runSearch.mockResolvedValue(search("recherche-1", 3));
});

describe("accord pour l'analyse par IA : demandé une fois, puis plus jamais", () => {
  it("jamais demandé, ou donné sur un texte qui a changé : à demander", () => {
    expect(videoAiChoice([])).toBe("ask");
    expect(videoAiChoice([consent({ grantedAt: "2026-10-01T00:00:00Z", decidedAt: "2026-10-01T00:00:00Z", version: "analyse-video-ia-2026-10-05" })])).toBe("ask");
  });

  it("donné sur le texte en vigueur : accordé", () => {
    expect(videoAiChoice([consent({ grantedAt: "2026-10-07T00:00:00Z", decidedAt: "2026-10-07T00:00:00Z", isCurrent: true })])).toBe("granted");
  });

  it("refusé (lien « Choisir l'image moi-même ») ou retiré dans Réglages : on ne redemande pas", () => {
    expect(videoAiChoice([consent({ decidedAt: "2026-10-07T00:00:00Z" })])).toBe("declined");
  });

  it("les autres accords ne comptent pas", () => {
    expect(videoAiChoice([consent({ type: "analytics", grantedAt: "x", decidedAt: "x", isCurrent: true })])).toBe("ask");
  });

  it("disponibilité de l'IA et accord lus ensemble, en arrière-plan", async () => {
    fetchVideoAiEnabled.mockResolvedValue(true);
    fetchConsentStatus.mockResolvedValue([consent({ grantedAt: "x", decidedAt: "x", isCurrent: true })]);
    expect(await checkVideoAi()).toEqual({ enabled: true, choice: "granted" });
  });
});

describe("vidéo : « Lancer » enchaîne analyse, cadrage et identification", () => {
  it("meilleur moment recadré par l'IA puis identifié (1 crédit) ; le résultat attend l'écran Résultat", async () => {
    const video = fakeVideo();
    findVideoMoments.mockResolvedValue([
      { frame: 1, box: BOX },
      { frame: 0, box: BOX },
    ]);
    const shown = vi.fn();
    const outcome = await launchVideo(video, " veste en daim ", new AbortController().signal, shown);
    expect(outcome).toEqual({ kind: "result", searchId: "recherche-1" });
    expect(prepareSearch).toHaveBeenCalledTimes(1);
    expect(runSearch).toHaveBeenCalledTimes(1);
    const [, params] = runSearch.mock.calls[0]!;
    expect(params).toMatchObject({ crop: BOX, query: "veste en daim" });
    expect(params.imageUri).toMatch(/-1600\.jpg$/);
    expect(shown).toHaveBeenCalledWith(expect.objectContaining({ crop: BOX }));
    expect(getLastSpotResult()).toMatchObject({ searchId: "recherche-1", status: "success" });
    // Le deuxième moment reste proposé dans les corrections.
    expect(remainingMoments(video)).toEqual([1]);
  });

  it("« aucun moment » : un résultat, pas une panne ; aucune identification, donc aucun crédit SerpApi", async () => {
    findVideoMoments.mockResolvedValue([]);
    expect(await launchVideo(fakeVideo(), "veste", new AbortController().signal)).toEqual({ kind: "not_found" });
    expect(prepareSearch).not.toHaveBeenCalled();
    expect(runSearch).not.toHaveBeenCalled();
  });

  it("accord retiré entre-temps : l'écran d'accord revient, rien n'est identifié", async () => {
    findVideoMoments.mockRejectedValue(new ApiError(403, { error: "video_ai_consent_required", message: "…" }));
    expect(await launchVideo(fakeVideo(), "veste", new AbortController().signal)).toEqual({ kind: "consent_required" });
    expect(runSearch).not.toHaveBeenCalled();
  });

  it("plafond des recherches atteint avant l'analyse (lot 4 quater) : annoncé sur l'écran Résultat, rien n'est identifié", async () => {
    findVideoMoments.mockRejectedValue(new ApiError(429, { error: "search_capacity_month", message: "…" }));
    expect(await launchVideo(fakeVideo(), " veste ", new AbortController().signal)).toEqual({ kind: "result", searchId: null });
    expect(prepareSearch).not.toHaveBeenCalled();
    expect(runSearch).not.toHaveBeenCalled();
    expect(getLastSpotResult()).toMatchObject({ searchId: null, status: "failed", failReason: "capacity_month", query: "veste" });
  });

  it("limite quotidienne : repli avec son motif", async () => {
    findVideoMoments.mockRejectedValue(new ApiError(429, { error: "video_ai_user_limit", message: "…" }));
    expect(await launchVideo(fakeVideo(), "veste", new AbortController().signal)).toEqual({ kind: "failed", reason: "user_limit" });
  });

  it("image du moment impossible à extraire : repli ; réessayer ne rappelle pas l'IA", async () => {
    const video = fakeVideo();
    findVideoMoments.mockResolvedValue([{ frame: 0, box: BOX }]);
    video.frameFile.mockImplementation(async (timeMs: number, maxEdge: number) => {
      if (maxEdge === 1600) throw new Error("video_frame_missing");
      return { uri: `file:///cache/image-${timeMs}.jpg`, width: 288, height: 512 };
    });
    expect(await launchVideo(video, "veste", new AbortController().signal)).toEqual({ kind: "prepare_failed" });
    expect(runSearch).not.toHaveBeenCalled();
    video.frameFile.mockResolvedValue({ uri: "file:///cache/image-ok.jpg", width: 900, height: 1600 });
    expect(await identifyNextMoment(video, new AbortController().signal)).toEqual({ kind: "result", searchId: "recherche-1" });
    expect(findVideoMoments).toHaveBeenCalledTimes(1);
  });

  it("« Annuler » pendant l'identification : abandon silencieux, aucun résultat affiché", async () => {
    findVideoMoments.mockResolvedValue([{ frame: 0, box: BOX }]);
    const abort = new AbortController();
    runSearch.mockImplementation(async () => {
      abort.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    expect(await launchVideo(fakeVideo(), "veste", abort.signal)).toEqual({ kind: "cancelled" });
    expect(reportUnexpectedError).not.toHaveBeenCalled();
  });
});

describe("photo : même parcours, sans attendre le serveur avant « Lancer »", () => {
  it("le choix d'une photo ne prépare rien sur le serveur ; « Lancer » analyse la zone centrale avec les mots tapés", async () => {
    const draft = beginFromPhoto("file:///cache/photo.jpg", { width: 1200, height: 1600 });
    expect(prepareSearch).not.toHaveBeenCalled();
    expect(draft.searchId).toBeNull();
    expect(await launchPhoto(draft, "  t-shirt noir ", new AbortController().signal)).toEqual({ kind: "result", searchId: "recherche-1" });
    expect(prepareSearch).toHaveBeenCalledTimes(1);
    expect(runSearch).toHaveBeenCalledWith("recherche-1", { crop: DEFAULT_CROP, query: "t-shirt noir", imageUri: "file:///cache/photo.jpg" }, expect.anything());
  });

  it("option B : la zone entourée sur l'écran (cadre « Entourez la pièce ») est celle envoyée", async () => {
    const draft = beginFromPhoto("file:///cache/photo.jpg", { width: 1200, height: 1600 });
    await launchPhoto(draft, "maillot", new AbortController().signal, BOX);
    expect(runSearch.mock.calls[0]![1]).toMatchObject({ crop: BOX, query: "maillot" });
    expect(getDraft()?.crop).toEqual(BOX);
  });

  it("une zone déjà recadrée est gardée", async () => {
    beginFromPhoto("file:///cache/photo.jpg", { width: 1200, height: 1600 });
    const draft = updateDraft({ crop: BOX })!;
    await launchPhoto(draft, "", new AbortController().signal);
    expect(runSearch.mock.calls[0]![1]).toMatchObject({ crop: BOX, query: "" });
  });
});

describe("identification : une panne n'est jamais présentée comme « pièce introuvable »", () => {
  function photoDraft() {
    return beginFromPhoto("file:///cache/photo.jpg", { width: 1200, height: 1600 });
  }

  it("chaque lancement consomme sa recherche : un nouvel essai en prépare une autre", async () => {
    await identifyDraft(photoDraft(), new AbortController().signal);
    expect(getDraft()?.searchId).toBeNull();
  });

  it.each([
    [new ApiError(429, { error: "rate_limited", message: "…" }), "rate_limited", false],
    [new ApiError(422, { error: "preview_unavailable", message: "…" }), "needs_photo", false],
    [new ApiError(500, { error: "internal", message: "…" }), "technical", false],
    [new TypeError("Network request failed"), "technical", true],
  ])("échec %#: « %s », signalé à Sentry seulement s'il vient de l'app", async (error, failReason, reported) => {
    runSearch.mockRejectedValue(error);
    expect(await identifyDraft(photoDraft(), new AbortController().signal)).toEqual({ kind: "done", searchId: null });
    expect(getLastSpotResult()).toMatchObject({ status: "failed", failReason });
    expect(reportUnexpectedError).toHaveBeenCalledTimes(reported ? 1 : 0);
  });

  it.each([
    ["search_capacity_day", "capacity_day"],
    ["search_capacity_month", "capacity_month"],
    ["search_capacity_user", "capacity_user"],
  ])("plafond des recherches atteint (lot 4 quater, %s) : son propre motif, jamais « trop de recherches d'un coup »", async (error, failReason) => {
    runSearch.mockRejectedValue(new ApiError(429, { error, message: "…" }));
    await identifyDraft(photoDraft(), new AbortController().signal);
    expect(getLastSpotResult()).toMatchObject({ status: "failed", failReason });
    expect(reportUnexpectedError).not.toHaveBeenCalled();
  });

  it("aucune correspondance : « aucune pièce trouvée », un vrai résultat", async () => {
    runSearch.mockResolvedValue(search("recherche-1", 0));
    await identifyDraft(photoDraft(), new AbortController().signal);
    expect(getLastSpotResult()).toMatchObject({ status: "failed", failReason: "no_match" });
  });
});
