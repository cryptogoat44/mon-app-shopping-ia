import { beforeEach, describe, expect, it, vi } from "vitest";

// Lot « partager vers Spotto » : réception sur l'app iPhone, avec des doubles
// du module de partage, des liens d'ouverture et des fichiers. Chaque partage
// est lu une fois, avec l'adresse qui vient d'ouvrir l'app (jamais une
// ancienne : le module natif s'arrête net si le type ne correspond pas).
const { linking, share, disk, discardLocalFile } = vi.hoisted(() => {
  const handlers = new Map<string, (payload: { value: string }) => void>();
  const share = {
    getShareIntent: vi.fn(),
    clearShareIntent: vi.fn(),
    addListener: vi.fn((event: string, handler: (payload: { value: string }) => void) => {
      handlers.set(event, handler);
      return { remove: () => handlers.delete(event) };
    }),
    emit: (event: string, value: string) => handlers.get(event)?.({ value }),
  };
  let onUrl: ((event: { url: string }) => void) | null = null;
  const linking = {
    getLinkingURL: vi.fn((): string | null => null),
    addEventListener: vi.fn((_type: string, handler: (event: { url: string }) => void) => {
      onUrl = handler;
      return { remove: () => (onUrl = null) };
    }),
    open: (url: string) => onUrl?.({ url }),
  };
  // Disque simulé : le groupe d'apps (copies de l'extension) et le cache de Spotto.
  const GROUP = "file:///private/var/mobile/Containers/Shared/AppGroup/0D1E2F/";
  const CACHE = "file:///var/mobile/Containers/Data/Application/ABC/Library/Caches/";
  const disk = { GROUP, CACHE, files: new Map<string, number>(), deleted: [] as string[] };
  class File {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get name() {
      return this.uri.split("/").pop() ?? "";
    }
    get size() {
      return disk.files.get(this.uri) ?? 0;
    }
    async move(directory: { uri: string }) {
      const size = disk.files.get(this.uri);
      if (size === undefined) throw new Error("introuvable");
      disk.files.delete(this.uri);
      this.uri = `${directory.uri}${this.name}`;
      disk.files.set(this.uri, size);
    }
    delete() {
      disk.files.delete(this.uri);
      disk.deleted.push(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    list() {
      const entries: (File | Directory)[] = [...disk.files.keys()].filter((uri) => uri.startsWith(this.uri)).map((uri) => new File(uri));
      return [...entries, new Directory(`${this.uri}Library/`)];
    }
  }
  return { linking, share, disk: { ...disk, File, Directory }, discardLocalFile: vi.fn() };
});

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-linking", () => ({ getLinkingURL: linking.getLinkingURL, addEventListener: linking.addEventListener }));
// Le module rend une chaîne JSON ; sa mise en forme (parseShareIntent) est simulée.
vi.mock("expo-share-intent", () => ({ ShareIntentModule: share, parseShareIntent: (value: string) => JSON.parse(value) }));
vi.mock("expo-file-system", () => ({
  File: disk.File,
  Paths: { cache: new disk.Directory(disk.CACHE), appleSharedContainers: { "group.com.spottoapp.ios": new disk.Directory(disk.GROUP) } },
}));
vi.mock("../src/lib/video-frames", () => ({ discardLocalFile }));

import { startShareIntake } from "../src/lib/share-intake";
import { peekSharedItem, takeSharedItem } from "../src/lib/shared-item";

const opening = (nonce: number, type: string) => `spotto://dataUrl=spottoShareKey?nonce=${nonce}#${type}`;

beforeEach(() => {
  vi.clearAllMocks();
  takeSharedItem();
  disk.files.clear();
  disk.deleted.length = 0;
  linking.getLinkingURL.mockReturnValue(null);
});

describe("réception d'un partage (app iPhone)", () => {
  it("app ouverte : lu une fois, avec l'adresse qui vient de l'ouvrir, puis le module est vidé", async () => {
    const stop = startShareIntake();
    linking.open("spotto://nouveau-mot-de-passe");
    linking.open(opening(1, "weburl"));
    linking.open(opening(1, "weburl"));
    expect(share.getShareIntent).toHaveBeenCalledTimes(1);
    expect(share.getShareIntent).toHaveBeenCalledWith(opening(1, "weburl"));
    share.emit("onChange", JSON.stringify({ files: null, webUrl: "https://vm.tiktok.com/ZMabc123/", text: "https://vm.tiktok.com/ZMabc123/" }));
    expect(share.clearShareIntent).toHaveBeenCalledWith("spottoShareKey");
    await vi.waitFor(() => expect(peekSharedItem()).toEqual({ kind: "link", text: "https://vm.tiktok.com/ZMabc123/" }));
    stop();
  });

  it("app fermée : lu au démarrage, depuis l'adresse de lancement", () => {
    linking.getLinkingURL.mockReturnValue(opening(2, "media"));
    const stop = startShareIntake();
    expect(share.getShareIntent).toHaveBeenCalledWith(opening(2, "media"));
    stop();
  });

  it("image ou vidéo : copie rangée dans le cache de Spotto ; le groupe d'apps ne garde rien", async () => {
    const copy = `${disk.GROUP}4F1C.MOV`;
    disk.files.set(copy, 24_000_000);
    disk.files.set(`${disk.GROUP}vignette.jpg`, 9_000);
    const stop = startShareIntake();
    linking.open(opening(3, "media"));
    share.emit("onChange", JSON.stringify({ files: [{ path: copy, mimeType: "video/quicktime", fileName: "4F1C.MOV", size: null }] }));
    await vi.waitFor(() => expect(peekSharedItem()).toEqual({ kind: "video", uri: `${disk.CACHE}4F1C.MOV`, sizeBytes: 24_000_000 }));
    expect(disk.deleted).toEqual([`${disk.GROUP}vignette.jpg`]);
    expect([...disk.files.keys()]).toEqual([`${disk.CACHE}4F1C.MOV`]);
    stop();
  });

  it("pas encore connecté, nouveau partage : il remplace l'ancien, dont la copie est effacée", async () => {
    disk.files.set(`${disk.GROUP}A.PNG`, 800_000);
    const stop = startShareIntake();
    linking.open(opening(4, "media"));
    share.emit("onChange", JSON.stringify({ files: [{ path: `${disk.GROUP}A.PNG`, mimeType: "image/png", width: 10, height: 20 }] }));
    await vi.waitFor(() => expect(peekSharedItem()).toMatchObject({ kind: "image", uri: `${disk.CACHE}A.PNG` }));
    disk.files.set(`${disk.GROUP}B.PNG`, 900_000);
    linking.open(opening(5, "media"));
    share.emit("onChange", JSON.stringify({ files: [{ path: `${disk.GROUP}B.PNG`, mimeType: "image/png" }] }));
    await vi.waitFor(() => expect(peekSharedItem()).toMatchObject({ kind: "image", uri: `${disk.CACHE}B.PNG` }));
    expect(discardLocalFile).toHaveBeenCalledWith(`${disk.CACHE}A.PNG`);
    stop();
  });

  it("copie introuvable, contenu ou erreur du module : illisible ; erreur hors lecture ignorée", async () => {
    const stop = startShareIntake();
    share.emit("onError", "appGroupIdentifier is nil");
    expect(peekSharedItem()).toBeNull();
    linking.open(opening(6, "media"));
    share.emit("onChange", JSON.stringify({ files: [{ path: `${disk.GROUP}absent.PNG`, mimeType: "image/png" }] }));
    await vi.waitFor(() => expect(peekSharedItem()).toEqual({ kind: "refused", reason: "unreadable" }));
    takeSharedItem();
    linking.open(opening(7, "weburl"));
    share.emit("onChange", "pas du JSON");
    await vi.waitFor(() => expect(peekSharedItem()).toEqual({ kind: "refused", reason: "unreadable" }));
    takeSharedItem();
    linking.open(opening(8, "weburl"));
    share.emit("onError", "file type is Invalid");
    await vi.waitFor(() => expect(peekSharedItem()).toEqual({ kind: "refused", reason: "unreadable" }));
    stop();
  });
});
