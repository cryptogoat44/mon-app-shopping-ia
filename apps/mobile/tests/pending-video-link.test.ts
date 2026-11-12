import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductSearch } from "@monapp/shared-types";

// Mission « liens vidéo » : le lien reçu reste en attente 10 minutes ; une
// recherche lancée hors du lecteur pendant ce temps lui est associée (avec
// une croix pour l'en détacher) ; après une recherche réussie, le spot est
// noté et le lien oublié ; l'image à ne pas garder est effacée dès que la
// recherche est partie. Doubles : stockage, appel au serveur, effacement.
const { storage, recordVideoSpot, discardLocalFile, prepareSearch, runSearch } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  recordVideoSpot: vi.fn(async (_request: unknown) => undefined),
  discardLocalFile: vi.fn(),
  prepareSearch: vi.fn(),
  runSearch: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => void storage.set(key, value)),
    removeItem: vi.fn(async (key: string) => void storage.delete(key)),
  },
}));
// Serveur SIMULÉ : aucune recherche réelle, aucun appel payant.
vi.mock("../src/lib/api", async () => ({ ApiError: (await import("../src/lib/api-error")).ApiError, recordVideoSpot, prepareSearch, runSearch, fetchSearch: vi.fn() }));
vi.mock("../src/lib/video-frames", () => ({ discardLocalFile }));
vi.mock("../src/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("../src/lib/error-tracking", () => ({ reportUnexpectedError: vi.fn() }));

import {
  PENDING_VIDEO_LINK_KEY,
  PENDING_VIDEO_LINK_TTL_MS,
  createPendingLinkStore,
  isPendingLinkFresh,
  makePendingLink,
  parsePendingLink,
  type KeyValueStore,
} from "../src/lib/pending-video-link";
import { clearDraft, getDraft, startDraft } from "../src/lib/spot-draft";
import { identifyDraft } from "../src/lib/spot-identify";
import { beginPhotoSearch, detachVideoFromDraft, pendingVideoLinks, spotWorthRecording } from "../src/lib/video-context";

const URL_TIKTOK = "https://vm.tiktok.com/ZMabc123/";
const T0 = 1_800_000_000_000;

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => void map.set(key, value),
    removeItem: async (key) => void map.delete(key),
  };
}

const search = (patch: Partial<ProductSearch>): ProductSearch =>
  ({ id: "s-1", sourceUrl: null, sourcePlatform: "photo", method: "manual_screenshot", status: "completed", errorMessage: null, query: null, createdAt: "", matches: [{ id: "m" }], ...patch }) as unknown as ProductSearch;

/** Lance la recherche du brouillon en cours, le serveur simulé répondant `result`. */
async function launch(result: ProductSearch): Promise<void> {
  const draft = getDraft();
  if (!draft) throw new Error("brouillon attendu");
  prepareSearch.mockResolvedValueOnce({ id: result.id });
  runSearch.mockResolvedValueOnce(result);
  await identifyDraft(draft, new AbortController().signal);
}

beforeEach(() => {
  storage.clear();
  vi.clearAllMocks();
  clearDraft();
  discardLocalFile.mockClear();
});

describe("lien en attente : logique pure", () => {
  it("10 minutes, pas une de plus ; horloge revenue en arrière : oublié", () => {
    const link = makePendingLink({ url: URL_TIKTOK, platform: "tiktok" }, T0)!;
    expect(PENDING_VIDEO_LINK_TTL_MS).toBe(600_000);
    expect(isPendingLinkFresh(link, T0)).toBe(true);
    expect(isPendingLinkFresh(link, T0 + 600_000)).toBe(true);
    expect(isPendingLinkFresh(link, T0 + 600_001)).toBe(false);
    expect(isPendingLinkFresh(link, T0 - 1)).toBe(false);
  });

  it("lien ou pseudo inutilisable : refusé ou ignoré", () => {
    expect(makePendingLink({ url: "javascript:alert(1)", platform: "tiktok" }, T0)).toBeNull();
    expect(makePendingLink({ url: "", platform: "tiktok" }, T0)).toBeNull();
    expect(makePendingLink({ url: `https://x/${"a".repeat(3000)}`, platform: "tiktok" }, T0)).toBeNull();
    expect(makePendingLink({ url: URL_TIKTOK, platform: "pinterest" as "tiktok" }, T0)).toBeNull();
    expect(makePendingLink({ url: URL_TIKTOK, platform: "tiktok", creatorHandle: "Mode.FR" }, T0)?.creatorHandle).toBe("mode.fr");
    expect(makePendingLink({ url: URL_TIKTOK, platform: "tiktok", creatorHandle: "<b>x</b>" }, T0)?.creatorHandle).toBeNull();
  });

  it("lecture du stockage : illisible ou expiré → rien", () => {
    expect(parsePendingLink(null, T0)).toBeNull();
    expect(parsePendingLink("{", T0)).toBeNull();
    expect(parsePendingLink(JSON.stringify({ url: URL_TIKTOK, platform: "tiktok", receivedAt: "hier" }), T0)).toBeNull();
    const raw = JSON.stringify({ url: URL_TIKTOK, platform: "tiktok", creatorHandle: null, receivedAt: T0 });
    expect(parsePendingLink(raw, T0 + 60_000)).toEqual({ url: URL_TIKTOK, platform: "tiktok", creatorHandle: null, receivedAt: T0 });
    expect(parsePendingLink(raw, T0 + 11 * 60_000)).toBeNull();
  });
});

describe("lien en attente : stockage", () => {
  it("gardé, relu, remplacé par un nouveau lien, effacé une fois expiré", async () => {
    let now = T0;
    const kv = memoryStore();
    const store = createPendingLinkStore(kv, () => now);
    await store.hold({ url: URL_TIKTOK, platform: "tiktok" });
    expect(await store.read()).toMatchObject({ url: URL_TIKTOK, receivedAt: T0 });
    now += 5 * 60_000;
    await store.hold({ url: "https://www.instagram.com/reel/CWqAgUZgCku/", platform: "instagram" });
    expect(await store.read()).toMatchObject({ platform: "instagram", receivedAt: now });
    now += 10 * 60_000 + 1;
    expect(await store.read()).toBeNull();
    expect(kv.map.has(PENDING_VIDEO_LINK_KEY)).toBe(false);
  });

  it("ce que le serveur apprend (adresse canonique, pseudo) est gardé, sans relancer les 10 minutes", async () => {
    let now = T0;
    const store = createPendingLinkStore(memoryStore(), () => now);
    await store.hold({ url: URL_TIKTOK, platform: "tiktok" });
    now += 60_000;
    await store.learn(URL_TIKTOK, { url: "https://www.tiktok.com/@mode.fr/video/6718335390845095173", creatorHandle: "mode.fr" });
    expect(await store.read()).toEqual({ url: "https://www.tiktok.com/@mode.fr/video/6718335390845095173", platform: "tiktok", creatorHandle: "mode.fr", receivedAt: T0 });
    // Un autre lien attend entre-temps : rien n'est changé.
    await store.learn("https://autre.example/", { creatorHandle: "x" });
    expect((await store.read())?.creatorHandle).toBe("mode.fr");
  });

  it("stockage indisponible : jamais d'erreur, simplement rien en attente", async () => {
    const broken: KeyValueStore = {
      getItem: async () => {
        throw new Error("indisponible");
      },
      setItem: async () => {
        throw new Error("indisponible");
      },
      removeItem: async () => {
        throw new Error("indisponible");
      },
    };
    const store = createPendingLinkStore(broken, () => T0);
    await expect(store.hold({ url: URL_TIKTOK, platform: "tiktok" })).resolves.toMatchObject({ url: URL_TIKTOK });
    await expect(store.read()).resolves.toBeNull();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});

describe("recherche associée au lien en attente, puis spot noté", () => {
  it("photo choisie pendant l'attente : associée au lien ; sans lien : rien", async () => {
    await beginPhotoSearch({ uri: "file:///cache/a.jpg", width: 10, height: 20 }, "app");
    expect(getDraft()?.video).toBeNull();
    await pendingVideoLinks.hold({ url: URL_TIKTOK, platform: "tiktok", creatorHandle: "mode.fr" });
    await beginPhotoSearch({ uri: "file:///cache/b.jpg", width: 10, height: 20 }, "share");
    expect(getDraft()?.video).toEqual({ url: URL_TIKTOK, platform: "tiktok", creatorHandle: "mode.fr", source: "share", momentSeconds: null });
    await beginPhotoSearch({ uri: "file:///cache/c.jpg", width: 10, height: 20 }, "visual_intelligence", { discardImageAfterSearch: true });
    expect(getDraft()).toMatchObject({ video: { source: "visual_intelligence" }, discardImageAfterSearch: true });
  });

  it("au-delà de 10 minutes : plus associée", async () => {
    storage.set(PENDING_VIDEO_LINK_KEY, JSON.stringify({ url: URL_TIKTOK, platform: "tiktok", creatorHandle: null, receivedAt: Date.now() - 11 * 60_000 }));
    await beginPhotoSearch({ uri: "file:///cache/a.jpg", width: 10, height: 20 }, "app");
    expect(getDraft()?.video).toBeNull();
  });

  it("la croix détache la recherche et oublie le lien", async () => {
    await pendingVideoLinks.hold({ url: URL_TIKTOK, platform: "tiktok" });
    await beginPhotoSearch({ uri: "file:///cache/b.jpg", width: 10, height: 20 }, "web");
    expect(getDraft()?.video?.source).toBe("web");
    await detachVideoFromDraft();
    expect(getDraft()?.video).toBeNull();
    expect(await pendingVideoLinks.read()).toBeNull();
    await launch(search({ id: "s-9" }));
    expect(recordVideoSpot).not.toHaveBeenCalled();
  });

  it("recherche terminée avec des résultats : spot noté, lien oublié", async () => {
    await pendingVideoLinks.hold({ url: URL_TIKTOK, platform: "tiktok" });
    await beginPhotoSearch({ uri: "file:///cache/b.jpg", width: 10, height: 20 }, "app");
    await launch(search({ id: "s-42" }));
    expect(recordVideoSpot).toHaveBeenCalledWith({ url: URL_TIKTOK, searchId: "s-42", source: "app", momentSeconds: null });
    await vi.waitFor(async () => expect(await pendingVideoLinks.read()).toBeNull());
    // Une photo ordinaire n'est pas effacée par la mission.
    expect(discardLocalFile).not.toHaveBeenCalled();
  });

  it("recherche sans résultat ou en échec : aucun spot, le lien reste en attente", async () => {
    await pendingVideoLinks.hold({ url: URL_TIKTOK, platform: "tiktok" });
    await beginPhotoSearch({ uri: "file:///cache/b.jpg", width: 10, height: 20 }, "app");
    await launch(search({ id: "s-1", matches: [] }));
    await beginPhotoSearch({ uri: "file:///cache/c.jpg", width: 10, height: 20 }, "app");
    await launch(search({ id: "s-2", status: "failed", matches: [] }));
    expect(recordVideoSpot).not.toHaveBeenCalled();
    expect(await pendingVideoLinks.read()).not.toBeNull();
    expect(spotWorthRecording(search({}))).toBe(true);
    expect(spotWorthRecording(search({ matches: [] }))).toBe(false);
  });

  it("instantané du lecteur : spot avec la source du lecteur et le moment ; image effacée dès que la recherche est partie", async () => {
    startDraft({
      searchId: null,
      localImageUri: "file:///cache/lecteur-instantane-1.jpg",
      imageSize: { width: 1, height: 1 },
      video: { url: URL_TIKTOK, platform: "tiktok", creatorHandle: null, source: "tiktok_player", momentSeconds: 12 },
      discardImageAfterSearch: true,
    });
    await launch(search({ id: "s-7" }));
    expect(recordVideoSpot).toHaveBeenCalledWith({ url: URL_TIKTOK, searchId: "s-7", source: "tiktok_player", momentSeconds: 12 });
    expect(discardLocalFile).toHaveBeenCalledWith("file:///cache/lecteur-instantane-1.jpg");
    expect(getDraft()?.localImageUri).toBeNull();
  });

  it("instantané effacé même quand la recherche ne trouve rien", async () => {
    startDraft({ searchId: null, localImageUri: "file:///cache/lecteur-instantane-3.jpg", imageSize: null, discardImageAfterSearch: true });
    await launch(search({ id: "s-8", matches: [] }));
    expect(discardLocalFile).toHaveBeenCalledWith("file:///cache/lecteur-instantane-3.jpg");
  });

  it("parcours abandonné avant la recherche : l'instantané est effacé aussi ; une photo ordinaire, jamais", () => {
    startDraft({ searchId: null, localImageUri: "file:///cache/lecteur-instantane-2.jpg", imageSize: null, discardImageAfterSearch: true });
    clearDraft();
    expect(discardLocalFile).toHaveBeenCalledWith("file:///cache/lecteur-instantane-2.jpg");
    discardLocalFile.mockClear();
    startDraft({ searchId: null, localImageUri: "file:///cache/photo.jpg", imageSize: null });
    clearDraft();
    expect(discardLocalFile).not.toHaveBeenCalled();
  });

  it("mémoire absente côté serveur (404) : ignoré sans bruit, le résultat s'affiche", async () => {
    recordVideoSpot.mockRejectedValueOnce(new Error("video_memory_unavailable"));
    await pendingVideoLinks.hold({ url: URL_TIKTOK, platform: "tiktok" });
    await beginPhotoSearch({ uri: "file:///cache/b.jpg", width: 10, height: 20 }, "app");
    await expect(launch(search({ id: "s-3" }))).resolves.toBeUndefined();
  });
});
