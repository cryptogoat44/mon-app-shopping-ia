import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Lot « mesure du parcours » : « journey_started », où commence un parcours —
// lien collé ou partagé, vidéo, photo —, une fois, dès que l'app accepte
// l'entrée et avant toute analyse ; rien pour une entrée refusée. Jamais le
// lien ni le fichier. Doubles : stockage, serveur, routeur, sélecteurs.
const { storage, push, track, openVideo, discardLocalFile } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  push: vi.fn(),
  track: vi.fn(),
  openVideo: vi.fn(),
  discardLocalFile: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => void storage.set(key, value)),
    removeItem: vi.fn(async (key: string) => void storage.delete(key)),
  },
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync: vi.fn(), UIImagePickerPreferredAssetRepresentationMode: { Current: "current" }, VideoExportPreset: { Passthrough: 0 } }));
// Serveur SIMULÉ : aucune recherche réelle.
vi.mock("../src/lib/api", async () => ({ ApiError: (await import("../src/lib/api-error")).ApiError, recordVideoSpot: vi.fn(), prepareSearch: vi.fn(), runSearch: vi.fn(), fetchSearch: vi.fn() }));
vi.mock("../src/lib/analytics", () => ({ track }));
vi.mock("../src/lib/error-tracking", () => ({ reportUnexpectedError: vi.fn() }));
vi.mock("../src/lib/video-frames", () => ({ openVideo, discardLocalFile }));
vi.mock("../src/lib/image-import", () => ({ SPOTTER_IMAGE_MAX_EDGE: 1600 }));

import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";
import { JOURNEY_ENTRIES, photoPickerEntry } from "../src/lib/journey-entries";
import { adoptSpotVideo, releaseSpotVideo } from "../src/lib/spot-video";
import { useLinkEntry } from "../src/lib/use-link-entry";
import { beginPhotoSearch, pendingVideoLinks } from "../src/lib/video-context";

const TIKTOK = "https://www.tiktok.com/@lea.style/video/7312345678901234567";
const INSTAGRAM = "https://www.instagram.com/reel/Cxyz123/";
const journeys = () => track.mock.calls.filter(([event]) => event === "journey_started").map(([, props]) => props);
const events = () => track.mock.calls.map(([event]) => event);
const openedVideo = (durationMs: number) => ({ durationMs, filmstrip: vi.fn(), preview: vi.fn(), frameFile: vi.fn(), release: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
  storage.clear();
  releaseSpotVideo();
});

describe("catalogue fermé : l'entrée et la plateforme du lien, rien d'autre", () => {
  it("valeurs admises seulement ; jamais le lien, le nom du fichier ni l'image", () => {
    expect(sanitizeProps("journey_started", { entry: "link_share", link_platform: "instagram", url: INSTAGRAM, file: "IMG_0042.MOV" })).toEqual({ entry: "link_share", link_platform: "instagram" });
    expect(sanitizeProps("journey_started", { entry: "photo_camera", link_platform: "none", uri: "file:///cache/photo.jpg" })).toEqual({ entry: "photo_camera", link_platform: "none" });
    expect(sanitizeProps("journey_started", { entry: TIKTOK, link_platform: "youtube" })).toEqual({});
    // « platform » serait remplacée par celle de l'appareil (analytics.ts) : la plateforme du lien a son propre nom.
    expect(Object.keys(ANALYTICS_EVENTS.journey_started)).toEqual(["entry", "link_platform"]);
  });

  it("les entrées réelles du Spotter, préfixées « link », « video » ou « photo »", () => {
    expect(JOURNEY_ENTRIES.every((entry) => /^(link|video|photo)_[a-z_]+$/.test(entry))).toBe(true);
    // Mêmes sources que les événements d'avant : lien collé ou partagé, vidéo de la photothèque, du site, de l'accueil ou partagée.
    expect(JOURNEY_ENTRIES.filter((entry) => entry.startsWith("link_")).map((entry) => entry.slice(5))).toEqual(["paste", "share"]);
    expect(ANALYTICS_EVENTS.player_opened.source).toEqual({ kind: "enum", values: ["paste", "share"] });
    const videoSources = JOURNEY_ENTRIES.filter((entry) => entry.startsWith("video_")).map((entry) => entry.slice(6));
    expect(ANALYTICS_EVENTS.video_imported.source).toEqual({ kind: "enum", values: videoSources });
    expect(JOURNEY_ENTRIES.filter((entry) => entry.startsWith("photo_"))).toEqual(["photo_library", "photo_file", "photo_drop", "photo_camera", "photo_share", "photo_visual_search"]);
    expect([photoPickerEntry("ios"), photoPickerEntry("web")]).toEqual(["photo_library", "photo_file"]);
  });
});

describe("lien collé ou partagé", () => {
  it("lien de vidéo reconnu : le parcours commence (une fois), avant l'écran « vidéo partagée »", async () => {
    const openLink = useLinkEntry();
    expect(await openLink(TIKTOK, "paste")).toEqual({ kind: "opened" });
    expect(await openLink(`Regarde ! ${INSTAGRAM}`, "share")).toEqual({ kind: "opened" });
    expect(journeys()).toEqual([
      { entry: "link_paste", link_platform: "tiktok" },
      { entry: "link_share", link_platform: "instagram" },
    ]);
    // L'événement d'avant ne change pas, juste après.
    expect(events()).toEqual(["journey_started", "player_opened", "journey_started", "player_opened"]);
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/tiktok\.com|instagram\.com|lea\.style|Regarde/);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("lien refusé (profil, autre site, pas un lien) ou sans vidéo lisible (Pinterest) : aucun parcours", async () => {
    const openLink = useLinkEntry();
    expect(await openLink("https://www.tiktok.com/@mayelasjourney", "paste")).toMatchObject({ kind: "refused" });
    expect(await openLink("https://www.zara.com/fr/veste", "share")).toMatchObject({ kind: "refused" });
    expect(await openLink("bonjour", "paste")).toMatchObject({ kind: "refused" });
    expect(await openLink("https://pin.it/4xYz", "share")).toEqual({ kind: "help" });
    expect(track).not.toHaveBeenCalled();
  });
});

describe("vidéo importée", () => {
  it.each([["library"], ["file"], ["latest"], ["share"]] as const)("vidéo acceptée (%s) : un parcours, avant toute analyse", async (source) => {
    openVideo.mockResolvedValue(openedVideo(12_000));
    expect(await adoptSpotVideo("file:///cache/video.mov", 20_000_000, source)).toEqual({ kind: "ready" });
    expect(journeys()).toEqual([{ entry: `video_${source}`, link_platform: "none" }]);
    expect(events()).toEqual(["journey_started", "video_imported"]);
  });

  it("vidéo refusée (trop lourde, illisible, trop longue) : seulement video_rejected, aucun parcours", async () => {
    expect(await adoptSpotVideo("file:///cache/a.mov", 101_000_000, "library")).toMatchObject({ kind: "rejected", reason: "too_large" });
    openVideo.mockRejectedValueOnce(new Error("video_unreadable"));
    expect(await adoptSpotVideo("file:///cache/b.mov", null, "share")).toMatchObject({ kind: "rejected", reason: "unreadable" });
    openVideo.mockResolvedValueOnce(openedVideo(65_000));
    expect(await adoptSpotVideo("file:///cache/c.mov", 20_000_000, "latest")).toMatchObject({ kind: "rejected", reason: "too_long" });
    expect(events()).toEqual(["video_rejected", "video_rejected", "video_rejected"]);
  });
});

describe("photo ou capture", () => {
  const picked = { uri: "file:///cache/capture.jpg", width: 1170, height: 2532 };

  it("image prête : un parcours, d'où vient l'image ; sans lien à cette entrée, même associée à un lien en attente", async () => {
    await beginPhotoSearch(picked, "app", { entry: "photo_camera" });
    await pendingVideoLinks.hold({ url: TIKTOK, platform: "tiktok" });
    await beginPhotoSearch(picked, "visual_intelligence", { entry: "photo_visual_search", discardImageAfterSearch: true });
    expect(journeys()).toEqual([
      { entry: "photo_camera", link_platform: "none" },
      { entry: "photo_visual_search", link_platform: "none" },
    ]);
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/capture\.jpg|tiktok\.com/);
  });

  it("chaque écran qui ouvre une image dit d'où elle vient ; refusée ou annulée, elle n'arrive pas jusque-là", () => {
    const code = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
    const spotter = code("app/(app)/(tabs)/index.tsx");
    // Une image illisible ou un choix annulé s'arrête avant beginPhotoSearch.
    const open = spotter.slice(spotter.indexOf("async function openPhoto("), spotter.indexOf("const photoOrigin"));
    expect(open.indexOf('if (picked.kind !== "picked") return;')).toBeLessThan(open.indexOf("await beginPhotoSearch(picked, origin, options);"));
    expect(open).toContain("options: { entry: PhotoJourneyEntry; discardImageAfterSearch?: boolean }");
    expect(spotter).toContain("photoOrigin, { entry: photoPickerEntry(Platform.OS) });");
    expect(spotter).toContain('void openPhoto(picked, t.common.photoUnavailable, "web", { entry: "photo_drop" });');
    expect(spotter).toContain('"app", { entry: "photo_camera" });');
    expect(spotter).toContain('entry: visual ? "photo_visual_search" : "photo_share",');
    const player = code("app/(app)/spot/lecteur.tsx");
    expect(player).toContain('await beginPhotoSearch(picked, Platform.OS === "web" ? "web" : "app", { entry });');
    expect(player).toContain("await openPicked(await importPhotoForSpotter(), photoPickerEntry(Platform.OS));");
    expect(player).toContain('void openPicked(picked, "photo_drop")');
    // Aucun autre appel : chaque image ouverte par un écran commence un parcours.
    const SRC = join(__dirname, "../src");
    const callers = (readdirSync(SRC, { recursive: true }) as string[])
      .map((file) => file.split("\\").join("/"))
      .filter((file) => /\.tsx?$/.test(file) && file !== "lib/video-context.ts" && /beginPhotoSearch\(/.test(readFileSync(join(SRC, file), "utf8")))
      .sort();
    expect(callers).toEqual(["app/(app)/(tabs)/index.tsx", "app/(app)/spot/lecteur.tsx"]);
    expect([spotter, player].flatMap((source) => source.match(/beginPhotoSearch\(/g) ?? [])).toHaveLength(2);
  });
});
