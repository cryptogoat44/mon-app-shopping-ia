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
import { wasTimedOut } from "../src/lib/app-timeout";
import { clearDraft, getDraft, leaveLaunchScreen } from "../src/lib/spot-draft";
import { launchPhoto, photoCrop } from "../src/lib/spot-launch";
import { beginFromPhoto } from "../src/lib/spot-flow";
import { beginPhotoSearch, pendingVideoLinks } from "../src/lib/video-context";
import { parseLinkAnalysis, type LinkAnalysis } from "../src/lib/video-link-analysis";
import { keepDescriptionInDraft, momentVideoContext, runLinkAnalysis, startMomentSearch } from "../src/lib/video-link-run";
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
    // Mesure du parcours : la plateforme aussi en link_platform (« platform » devient l'appareil chez PostHog).
    expect(track).toHaveBeenCalledWith("video_link_ai_started", { platform: "tiktok", link_platform: "tiktok" });
    expect(track).toHaveBeenCalledWith("video_link_ai_result", { platform: "tiktok", outcome: "found", moments_count: 2, wait_ms: expect.any(Number), link_platform: "tiktok" });
    expect(tracked()).not.toContain("tiktok.com");
    expect(tracked()).not.toContain("veste");
  });

  it("aucun moment : « pièce non repérée », un résultat et pas une panne", async () => {
    analyzeVideoLink.mockResolvedValue({ ...analysis(), moments: [] });
    const outcome = await runLinkAnalysis({ url: TIKTOK, query: QUERY }, "tiktok", new AbortController().signal);
    expect(outcome).toEqual({ kind: "failed", info: { failure: "no_moment", capacity: null } });
    expect(track).toHaveBeenCalledWith("video_link_ai_result", { platform: "tiktok", outcome: "not_found", reason: "no_moment", moments_count: 0, wait_ms: expect.any(Number), link_platform: "tiktok" });
  });

  it("vidéo privée, service vidéo occupé, accord manquant : l'échec du serveur est traduit", async () => {
    analyzeVideoLink.mockRejectedValueOnce(new ApiError(451, { error: "video_private", message: "x" }));
    expect(await runLinkAnalysis({ url: TIKTOK, query: QUERY }, "instagram", new AbortController().signal)).toEqual({ kind: "failed", info: { failure: "private", capacity: null } });
    analyzeVideoLink.mockRejectedValueOnce(new ApiError(503, { error: "video_busy", message: "x" }));
    expect(await runLinkAnalysis({ url: TIKTOK, query: QUERY }, "tiktok", new AbortController().signal)).toMatchObject({ info: { failure: "busy" } });
    analyzeVideoLink.mockRejectedValueOnce(new ApiError(403, { error: "video_ai_consent_required", message: "x" }));
    expect(await runLinkAnalysis({ url: TIKTOK, query: QUERY }, "tiktok", new AbortController().signal)).toMatchObject({ info: { failure: "consent" } });
    expect(track).toHaveBeenCalledWith("video_link_ai_result", { platform: "instagram", outcome: "failed", reason: "private", moments_count: 0, wait_ms: expect.any(Number), link_platform: "instagram" });
  });

  it("« Annuler » : la demande est abandonnée, rien n'est affiché ensuite", async () => {
    let sentSignal: AbortSignal | null = null;
    analyzeVideoLink.mockImplementation((_request, signal: AbortSignal) => {
      sentSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    });
    const controller = new AbortController();
    const pending = runLinkAnalysis({ url: TIKTOK, query: QUERY }, "tiktok", controller.signal);
    controller.abort();
    expect(await pending).toEqual({ kind: "cancelled" });
    expect(track).toHaveBeenCalledWith("video_link_ai_result", { platform: "tiktok", outcome: "cancelled", moments_count: 0, wait_ms: expect.any(Number), link_platform: "tiktok" });
    // Abandon par la personne : pas un délai de l'app (server_first_response n'en compte rien).
    expect(wasTimedOut(sentSignal!)).toBe(false);
    expect(await runLinkAnalysis({ url: TIKTOK, query: QUERY }, "tiktok", controller.signal)).toEqual({ kind: "cancelled" });
  });

  it("serveur muet au-delà du délai de l'app : l'attente s'arrête sur « délai dépassé »", async () => {
    let aborted = false;
    let sentSignal: AbortSignal | null = null;
    analyzeVideoLink.mockImplementation((_request, signal: AbortSignal) => {
      sentSignal = signal;
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        })
      );
    });
    const outcome = await runLinkAnalysis({ url: TIKTOK, query: QUERY }, "tiktok", new AbortController().signal, 20);
    expect(aborted).toBe(true);
    expect(outcome).toEqual({ kind: "failed", info: { failure: "timeout", capacity: null } });
    // Délai de l'app : la requête est un échec pour server_first_response, pas une annulation.
    expect(wasTimedOut(sentSignal!)).toBe(true);
  });
});

describe("plan B en un geste (lot « recherche confiance ») : la capture d'écran après un échec de l'analyse", () => {
  it("la capture choisie est associée au lien en attente et reprend la description (pour trier), sans aucune recherche de plus", async () => {
    await pendingVideoLinks.hold({ url: TIKTOK, platform: "tiktok", creatorHandle: "lea.style" });
    await beginPhotoSearch({ uri: "file:///capture.jpg", width: 1170, height: 2532 }, "app");
    const draft = keepDescriptionInDraft(`  ${QUERY.replace(" en ", "   en ")}  `)!;
    expect(draft.words).toBe(QUERY);
    expect(draft.video).toMatchObject({ url: TIKTOK, platform: "tiktok", creatorHandle: "lea.style", source: "app" });
    // Jamais la recherche automatique « Que cherchez-vous ? » (un appel payant de plus) pour une capture.
    expect(draft.textSearchIfNoPrice).toBeUndefined();
    // Rien à reprendre : le brouillon reste tel quel ; aucun brouillon : rien.
    expect(keepDescriptionInDraft("   ")).toBeNull();
    expect(getDraft()?.words).toBe(QUERY);
    clearDraft();
    expect(keepDescriptionInDraft(QUERY)).toBeNull();
    expect(tracked()).not.toContain("veste");
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
    expect(track).toHaveBeenCalledWith("video_link_ai_moment_chosen", { platform: "tiktok", rank: 2, moments_count: 2, link_platform: "tiktok" });
    expect(tracked()).not.toContain("data:");
  });

  it("pièce entourée sur l'écran des moments : c'est sa zone qui part, plus le cadre de l'IA", () => {
    const mine = { x: 0.3, y: 0.35, width: 0.2, height: 0.25 };
    const draft = startMomentSearch(analysis(), 0, "web", { crop: mine, byAi: false })!;
    expect(draft.crop).toEqual(mine);
    expect(draft.zoneByAi).toBe(false);
    // Cadre de l'IA gardé tel quel : marqué comme celui de l'IA.
    expect(startMomentSearch(analysis(), 0, "web", { crop: BEST, byAi: true })).toMatchObject({ crop: BEST, zoneByAi: true });
  });

  it("lien vidéo sans prix (17 novembre 2026) : la description reste dans le brouillon (espaces retirés), marqué pour la recherche automatique", () => {
    const draft = startMomentSearch(analysis(), 0, "web", { crop: BEST, byAi: true }, `  ${QUERY.replace(" en ", "   en ")}  `)!;
    expect(draft.words).toBe(QUERY);
    expect(draft.textSearchIfNoPrice).toBe(true);
    // Rien ne part dans les statistiques.
    expect(tracked()).not.toContain("veste");
    // Description vide (espaces seulement) : aucun mot ; trop longue (jamais après une analyse) : bornée.
    expect(startMomentSearch(analysis(), 0, "web", undefined, "   ")!.words).toBeNull();
    expect(startMomentSearch(analysis(), 0, "web", undefined, "x".repeat(80))!.words).toBe("x".repeat(60));
    // Sans description : aucun mot, toujours un moment de lien.
    expect(startMomentSearch(analysis(), 1, "app")).toMatchObject({ words: null, textSearchIfNoPrice: true });
  });

  it("la marque ne vaut que pour ce brouillon : une photo ensuite (beginFromPhoto) ou l'abandon du parcours l'efface", () => {
    startMomentSearch(analysis(), 0, "web", undefined, QUERY);
    const photo = beginFromPhoto("file:///photo.jpg", { width: 800, height: 600 });
    expect(photo.textSearchIfNoPrice).toBeUndefined();
    expect(photo.words).toBeNull();
    startMomentSearch(analysis(), 0, "web", undefined, QUERY);
    clearDraft();
    expect(getDraft()).toBeNull();
  });

  it("lancée avec la description reprise par l'écran de lancement : elle part à part, pour trier, jamais avec l'image vers la recherche visuelle", async () => {
    startMomentSearch(analysis(), 0, "app", undefined, QUERY);
    prepareSearch.mockResolvedValueOnce({ id: "s-43" });
    runSearch.mockResolvedValueOnce(search("s-43"));
    const draft = getDraft()!;
    expect(await launchPhoto(draft, new AbortController().signal, photoCrop(draft), draft.words ?? "")).toEqual({ kind: "result", searchId: "s-43" });
    expect(runSearch).toHaveBeenCalledWith("s-43", { crop: BEST, imageUri: IMAGE_BEST, words: QUERY, zoneByAi: true }, expect.any(AbortSignal));
    // Toujours dans le brouillon après le lancement, marque comprise (écran Résultat).
    expect(getDraft()).toMatchObject({ words: QUERY, textSearchIfNoPrice: true });
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
