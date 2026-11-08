import { beforeEach, describe, expect, it, vi } from "vitest";

// Lot « partager vers Spotto » : réception sur l'app iPhone, avec des doubles
// du module de partage, des liens d'ouverture et des fichiers. Chaque partage
// est lu une fois, avec l'adresse qui vient d'ouvrir l'app (jamais une
// ancienne : le module natif s'arrête net si le type ne correspond pas).
const { linking, share, disk, discardLocalFile, appState } = vi.hoisted(() => {
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
  // Le groupe contient toujours le fichier caché du système, listé en premier,
  // dont iOS refuse l'effacement ; `stuck` : autres fichiers qui résistent.
  const GROUP = "file:///private/var/mobile/Containers/Shared/AppGroup/0D1E2F/";
  const CACHE = "file:///var/mobile/Containers/Data/Application/ABC/Library/Caches/";
  const META = `${GROUP}.com.apple.mobile_container_manager.metadata.plist`;
  // `texts` : contenu et date des fichiers texte (repli du partage, lot « app iPhone prête »).
  const disk = {
    GROUP,
    CACHE,
    META,
    files: new Map<string, number>(),
    texts: new Map<string, { content: string; at: number | null }>(),
    deleted: [] as string[],
    stuck: new Set<string>(),
    folders: new Set<string>(),
  };
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).reduce((base, part) => `${base.replace(/\/?$/, "/")}${part}`);
    }
    get exists() {
      return disk.files.has(this.uri);
    }
    get lastModified() {
      return disk.texts.get(this.uri)?.at ?? null;
    }
    textSync() {
      const text = disk.texts.get(this.uri);
      if (!text) throw new Error("introuvable");
      return text.content;
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
      if (this.uri === META || disk.stuck.has(this.uri)) throw new Error("couldn’t be removed because you don’t have permission to access it");
      disk.files.delete(this.uri);
      disk.texts.delete(this.uri);
      disk.deleted.push(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      const joined = parts.map((part) => (typeof part === "string" ? part : part.uri)).reduce((base, part) => `${base.replace(/\/?$/, "/")}${part}`);
      this.uri = joined.replace(/\/?$/, "/");
    }
    get exists() {
      return disk.folders.has(this.uri) || [...disk.files.keys()].some((uri) => uri.startsWith(this.uri));
    }
    create() {
      disk.folders.add(this.uri);
    }
    list() {
      const entries: (File | Directory)[] = [...disk.files.keys()].filter((uri) => uri.startsWith(this.uri)).map((uri) => new File(uri));
      return this.uri === GROUP ? [new File(META), ...entries, new Directory(`${this.uri}Library/`)] : entries;
    }
  }
  // Retour au premier plan (AppState de React Native).
  let onState: ((state: string) => void) | null = null;
  const appState = {
    addEventListener: vi.fn((_type: string, handler: (state: string) => void) => {
      onState = handler;
      return { remove: () => (onState = null) };
    }),
    change: (state: string) => onState?.(state),
  };
  return { linking, share, disk: { ...disk, File, Directory }, discardLocalFile: vi.fn(), appState };
});

vi.mock("react-native", () => ({ Platform: { OS: "ios" }, AppState: appState }));
vi.mock("expo-linking", () => ({ getLinkingURL: linking.getLinkingURL, addEventListener: linking.addEventListener }));
// Le module rend une chaîne JSON ; sa mise en forme (parseShareIntent) est simulée.
vi.mock("expo-share-intent", () => ({ ShareIntentModule: share, parseShareIntent: (value: string) => JSON.parse(value) }));
vi.mock("expo-file-system", () => ({
  File: disk.File,
  Directory: disk.Directory,
  Paths: { cache: new disk.Directory(disk.CACHE), appleSharedContainers: { "group.com.spottoapp.ios": new disk.Directory(disk.GROUP) } },
}));
vi.mock("../src/lib/video-frames", () => ({ discardLocalFile }));

import { startShareIntake } from "../src/lib/share-intake";
import { peekSharedItem, takeSharedItem } from "../src/lib/shared-item";

const opening = (nonce: number, type: string) => `spotto://dataUrl=spottoShareKey?nonce=${nonce}#${type}`;
// Dossier des copies des partages, dans le cache de Spotto.
const SHARES = `${disk.CACHE}partages/`;

beforeEach(() => {
  vi.clearAllMocks();
  takeSharedItem();
  disk.files.clear();
  disk.texts.clear();
  disk.deleted.length = 0;
  disk.stuck.clear();
  disk.folders.clear();
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

  it("image ou vidéo : copie rangée dans le cache de Spotto ; le groupe d'apps ne garde rien, sauf le fichier du système", async () => {
    const copy = `${disk.GROUP}4F1C.MOV`;
    disk.files.set(disk.META, 300);
    disk.files.set(copy, 24_000_000);
    disk.files.set(`${disk.GROUP}vignette.jpg`, 9_000);
    const stop = startShareIntake();
    linking.open(opening(3, "media"));
    share.emit("onChange", JSON.stringify({ files: [{ path: copy, mimeType: "video/quicktime", fileName: "4F1C.MOV", size: null }] }));
    await vi.waitFor(() => expect(peekSharedItem()).toEqual({ kind: "video", uri: `${SHARES}4F1C.MOV`, sizeBytes: 24_000_000 }));
    // Le fichier caché, listé en premier et protégé par iOS, n'arrête pas le nettoyage, et n'est jamais touché.
    expect(disk.deleted).toEqual([`${disk.GROUP}vignette.jpg`]);
    expect([...disk.files.keys()].sort()).toEqual([disk.META, `${SHARES}4F1C.MOV`].sort());
    stop();
  });

  it("un fichier du groupe qui résiste n'empêche pas d'effacer les suivants", async () => {
    disk.files.set(`${disk.GROUP}A.PNG`, 800_000);
    disk.files.set(`${disk.GROUP}verrou.jpg`, 9_000);
    disk.files.set(`${disk.GROUP}screenshot_9C3E.png`, 4_000_000);
    disk.stuck.add(`${disk.GROUP}verrou.jpg`);
    const stop = startShareIntake();
    linking.open(opening(9, "media"));
    share.emit("onChange", JSON.stringify({ files: [{ path: `${disk.GROUP}A.PNG`, mimeType: "image/png", width: 10, height: 20 }] }));
    await vi.waitFor(() => expect(peekSharedItem()).toMatchObject({ kind: "image", uri: `${SHARES}A.PNG` }));
    expect(disk.deleted).toEqual([`${disk.GROUP}screenshot_9C3E.png`]);
    expect(disk.files.has(`${disk.GROUP}verrou.jpg`)).toBe(true);
    stop();
  });

  it("pas encore connecté, nouveau partage : il remplace l'ancien, dont la copie est effacée", async () => {
    disk.files.set(`${disk.GROUP}A.PNG`, 800_000);
    const stop = startShareIntake();
    linking.open(opening(4, "media"));
    share.emit("onChange", JSON.stringify({ files: [{ path: `${disk.GROUP}A.PNG`, mimeType: "image/png", width: 10, height: 20 }] }));
    await vi.waitFor(() => expect(peekSharedItem()).toMatchObject({ kind: "image", uri: `${SHARES}A.PNG` }));
    disk.files.set(`${disk.GROUP}B.PNG`, 900_000);
    linking.open(opening(5, "media"));
    share.emit("onChange", JSON.stringify({ files: [{ path: `${disk.GROUP}B.PNG`, mimeType: "image/png" }] }));
    await vi.waitFor(() => expect(peekSharedItem()).toMatchObject({ kind: "image", uri: `${SHARES}B.PNG` }));
    expect(discardLocalFile).toHaveBeenCalledWith(`${SHARES}A.PNG`);
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

describe("copies de partages jamais ouverts (app fermée par iOS avant la connexion)", () => {
  it("effacées au lancement suivant, une seule fois ; l'élément en attente n'est jamais touché", async () => {
    // Nouveau lancement : modules neufs, rien en attente (l'attente vit en mémoire).
    vi.resetModules();
    const intake = await import("../src/lib/share-intake");
    const shared = await import("../src/lib/shared-item");
    disk.files.set(`${SHARES}ANCIEN.MOV`, 400_000_000);
    disk.files.set(`${SHARES}ANCIEN.PNG`, 800_000);
    disk.files.set(`${disk.CACHE}export-spotto.json`, 2_000);
    const stop = intake.startShareIntake();
    expect(disk.deleted.sort()).toEqual([`${SHARES}ANCIEN.MOV`, `${SHARES}ANCIEN.PNG`]);
    // Le reste du cache n'est pas concerné.
    expect(disk.files.has(`${disk.CACHE}export-spotto.json`)).toBe(true);
    // Un partage arrive et attend la connexion…
    disk.files.set(`${disk.GROUP}C.PNG`, 700_000);
    linking.open(opening(10, "media"));
    share.emit("onChange", JSON.stringify({ files: [{ path: `${disk.GROUP}C.PNG`, mimeType: "image/png", width: 10, height: 20 }] }));
    await vi.waitFor(() => expect(shared.peekSharedItem()).toMatchObject({ kind: "image", uri: `${SHARES}C.PNG` }));
    stop();
    // … l'écran racine se remonte : rien n'est effacé une seconde fois.
    disk.deleted.length = 0;
    const again = intake.startShareIntake();
    expect(disk.deleted).toEqual([]);
    expect(disk.files.has(`${SHARES}C.PNG`)).toBe(true);
    again();
    shared.takeSharedItem();
  });

  it("par prudence, si un élément attendait déjà, rien n'est effacé", async () => {
    vi.resetModules();
    const intake = await import("../src/lib/share-intake");
    const shared = await import("../src/lib/shared-item");
    disk.files.set(`${SHARES}D.MOV`, 9_000_000);
    shared.receiveSharedItem({ kind: "video", uri: `${SHARES}D.MOV`, sizeBytes: 9_000_000 });
    const stop = intake.startShareIntake();
    expect(disk.deleted).toEqual([]);
    stop();
    shared.takeSharedItem();
  });
});

describe("repli : la réouverture par l'extension a échoué (lot « app iPhone prête »)", () => {
  const PENDING = `${disk.GROUP}partage-en-attente.txt`;
  function pending(content: string, at: number | null = Date.now()) {
    disk.files.set(PENDING, content.length);
    disk.texts.set(PENDING, { content, at });
  }

  it("Spotto ouvert à la main : le partage resté en attente est lu, une fois, et le fichier effacé", () => {
    pending(`${opening(10, "media")}\n`);
    const stop = startShareIntake();
    expect(share.getShareIntent).toHaveBeenCalledTimes(1);
    expect(share.getShareIntent).toHaveBeenCalledWith(opening(10, "media"));
    expect(disk.deleted).toContain(PENDING);
    appState.change("active");
    expect(share.getShareIntent).toHaveBeenCalledTimes(1);
    stop();
  });

  it("retour dans Spotto déjà ouvert : lu au passage au premier plan", () => {
    const stop = startShareIntake();
    expect(share.getShareIntent).not.toHaveBeenCalled();
    pending(opening(11, "weburl"));
    appState.change("background");
    expect(share.getShareIntent).not.toHaveBeenCalled();
    appState.change("active");
    expect(share.getShareIntent).toHaveBeenCalledWith(opening(11, "weburl"));
    stop();
  });

  it("ouverture réussie par l'extension : la même adresse n'est jamais lue deux fois, quel que soit l'ordre", () => {
    const stop = startShareIntake();
    pending(opening(12, "media"));
    appState.change("active");
    linking.open(opening(12, "media"));
    expect(share.getShareIntent).toHaveBeenCalledTimes(1);
    linking.getLinkingURL.mockReturnValue(opening(13, "text"));
    stop();
    pending(opening(13, "text"));
    const again = startShareIntake();
    expect(share.getShareIntent).toHaveBeenCalledTimes(2);
    expect(share.getShareIntent).toHaveBeenLastCalledWith(opening(13, "text"));
    again();
  });

  it("contenu inattendu ou partage de plus de 24 heures : jamais lu, fichier effacé quand même", () => {
    pending("spotto://dataUrl=spottoShareKey#inconnu");
    const stop = startShareIntake();
    pending(opening(14, "media"), Date.now() - 25 * 60 * 60_000);
    appState.change("active");
    expect(share.getShareIntent).not.toHaveBeenCalled();
    expect(disk.files.has(PENDING)).toBe(false);
    stop();
  });
});
