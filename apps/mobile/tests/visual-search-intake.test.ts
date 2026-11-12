import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission « liens vidéo » : réception d'une capture de la recherche d'image
// d'iOS. Identifiant strict (un UUID, jamais un chemin), capture copiée dans
// le cache, fichier du groupe d'apps effacé, capture mise en attente pour le
// Spotter (source « visual_intelligence »). Doubles : liens d'ouverture,
// fichiers, retour au premier plan.
const { linking, disk, appState } = vi.hoisted(() => {
  let onUrl: ((event: { url: string }) => void) | null = null;
  const linking = {
    getLinkingURL: vi.fn((): string | null => null),
    addEventListener: vi.fn((_type: string, handler: (event: { url: string }) => void) => {
      onUrl = handler;
      return { remove: () => (onUrl = null) };
    }),
    open: (url: string) => onUrl?.({ url }),
  };
  const GROUP = "file:///private/var/mobile/Containers/Shared/AppGroup/0D1E2F/";
  const CACHE = "file:///var/mobile/Containers/Data/Application/ABC/Library/Caches/";
  const disk = {
    GROUP,
    CACHE,
    files: new Map<string, number>(),
    texts: new Map<string, { content: string; at: number | null }>(),
    deleted: [] as string[],
    copied: [] as [string, string][],
    // Objet partagé (pas une copie) : le test peut le changer après coup.
    faults: { copy: false },
  };
  const join = (parts: (string | { uri: string })[]) => parts.map((part) => (typeof part === "string" ? part : part.uri)).reduce((base, part) => `${base.replace(/\/?$/, "/")}${part}`);
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }
    get exists() {
      return disk.files.has(this.uri) || disk.texts.has(this.uri);
    }
    get lastModified() {
      return disk.texts.get(this.uri)?.at ?? null;
    }
    textSync() {
      const text = disk.texts.get(this.uri);
      if (!text) throw new Error("introuvable");
      return text.content;
    }
    async copy(target: { uri: string }) {
      if (disk.faults.copy) throw new Error("copie impossible");
      const size = disk.files.get(this.uri);
      if (size === undefined) throw new Error("introuvable");
      disk.files.set(target.uri, size);
      disk.copied.push([this.uri, target.uri]);
    }
    delete() {
      disk.files.delete(this.uri);
      disk.texts.delete(this.uri);
      disk.deleted.push(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts).replace(/\/?$/, "/");
    }
    get exists() {
      return [...disk.files.keys()].some((uri) => uri.startsWith(this.uri));
    }
    create() {}
    list() {
      return [...disk.files.keys()].filter((uri) => uri.startsWith(this.uri)).map((uri) => new File(uri));
    }
  }
  let onState: ((state: string) => void) | null = null;
  const appState = {
    addEventListener: vi.fn((_type: string, handler: (state: string) => void) => {
      onState = handler;
      return { remove: () => (onState = null) };
    }),
    change: (state: string) => onState?.(state),
  };
  return { linking, disk: { ...disk, File, Directory }, appState };
});

vi.mock("react-native", () => ({ Platform: { OS: "ios" }, AppState: appState }));
vi.mock("expo-linking", () => ({ getLinkingURL: linking.getLinkingURL, addEventListener: linking.addEventListener }));
vi.mock("expo-file-system", () => ({
  File: disk.File,
  Directory: disk.Directory,
  Paths: { cache: new disk.Directory(disk.CACHE), appleSharedContainers: { "group.com.spottoapp.ios": new disk.Directory(disk.GROUP) } },
}));

import { redirectSystemPath } from "../src/app/+native-intent";
import { peekSharedItem, takeSharedItem } from "../src/lib/shared-item";
import {
  PENDING_VISUAL_SEARCH_FILE,
  VISUAL_SEARCH_FOLDER,
  isCaptureId,
  pendingVisualSearchOpening,
  startVisualSearchIntake,
  supportsVisualSearch,
  takeVisualSearchCapture,
  visualSearchCaptureId,
} from "../src/lib/visual-search-intake";

const ID = "3f2c8a1e-9b7d-4c21-a5e0-1d2b3c4d5e6f";
const opening = (id: string) => `spotto://recherche-image?fichier=${id}`;
const inGroup = (id: string) => `${disk.GROUP}${VISUAL_SEARCH_FOLDER}/${id}.jpg`;
const inCache = (id: string) => `${disk.CACHE}recherche-image/${id}.jpg`;

beforeEach(() => {
  vi.clearAllMocks();
  takeSharedItem();
  disk.files.clear();
  disk.texts.clear();
  disk.deleted.length = 0;
  disk.copied.length = 0;
  disk.faults.copy = false;
  linking.getLinkingURL.mockReturnValue(null);
});

describe("lien d'ouverture de la recherche d'image : vérifié strictement", () => {
  it("l'adresse exacte écrite par le Swift : identifiant rendu", () => {
    expect(visualSearchCaptureId(opening(ID))).toBe(ID);
    expect(isCaptureId(ID)).toBe(true);
  });

  it.each([
    opening(ID.toUpperCase()),
    opening(`${ID}&x=1`),
    opening("../../Library/Preferences/x"),
    opening("..%2F..%2Fx"),
    opening(`${ID}/../x`),
    opening(""),
    opening("3f2c8a1e9b7d4c21a5e01d2b3c4d5e6f"),
    `autre://recherche-image?fichier=${ID}`,
    `spotto://recherche-image/?fichier=${ID}`,
    `spotto://dataUrl=spottoShareKey#media`,
    `https://spotto.example/recherche-image?fichier=${ID}`,
  ])("« %s » : refusé", (url) => {
    expect(visualSearchCaptureId(url)).toBeNull();
  });

  it("identifiant qui n'est pas un UUID : aucun fichier lu ni effacé (pas de chemin « ../ »)", async () => {
    disk.files.set(`${disk.GROUP}secret.jpg`, 10);
    for (const id of ["../secret", "..%2Fsecret", "", ID.toUpperCase(), `${ID}.jpg`]) expect(await takeVisualSearchCapture(id)).toBeNull();
    expect(disk.deleted).toEqual([]);
    expect(disk.copied).toEqual([]);
  });

  it("fichier d'attente : seule une adresse d'ouverture exacte, de moins d'une heure", () => {
    expect(pendingVisualSearchOpening(`  ${opening(ID)}\n`, 1_000, 1_000 + 59 * 60_000)).toBe(opening(ID));
    expect(pendingVisualSearchOpening(opening(ID), 1_000, 1_000 + 61 * 60_000)).toBeNull();
    expect(pendingVisualSearchOpening(opening(ID), null, 0)).toBe(opening(ID));
    expect(pendingVisualSearchOpening("spotto://ailleurs", null, 0)).toBeNull();
  });

  it("l'adresse ne désigne aucun écran : le routeur ne cherche pas de page", () => {
    expect(redirectSystemPath({ path: opening(ID), initial: true })).toBe("/");
    expect(redirectSystemPath({ path: opening(ID), initial: false })).toBeNull();
    expect(redirectSystemPath({ path: opening("../x"), initial: false })).toBe(opening("../x"));
  });

  it("iPhone sous iOS 26 ou suivant seulement", () => {
    expect(supportsVisualSearch("ios", "26.1")).toBe(true);
    expect(supportsVisualSearch("ios", 27)).toBe(true);
    expect(supportsVisualSearch("ios", "18.6")).toBe(false);
    expect(supportsVisualSearch("web", "26")).toBe(false);
  });
});

describe("capture reçue : copiée dans le cache, fichier du groupe d'apps effacé", () => {
  it("copie dans le cache de l'app, puis effacement dans le groupe d'apps", async () => {
    disk.files.set(inGroup(ID), 120_000);
    expect(await takeVisualSearchCapture(ID)).toBe(inCache(ID));
    expect(disk.copied).toEqual([[inGroup(ID), inCache(ID)]]);
    expect(disk.deleted).toEqual([inGroup(ID)]);
    expect(disk.files.has(inGroup(ID))).toBe(false);
  });

  it("copie impossible : le fichier du groupe d'apps est effacé quand même, rien n'est rendu", async () => {
    disk.files.set(inGroup(ID), 120_000);
    disk.faults.copy = true;
    expect(await takeVisualSearchCapture(ID)).toBeNull();
    expect(disk.deleted).toEqual([inGroup(ID)]);
  });

  it("app ouverte par le lien : la capture attend le Spotter, comme une image partagée (source « visual_intelligence »)", async () => {
    disk.files.set(inGroup(ID), 120_000);
    const stop = startVisualSearchIntake();
    linking.open(opening(ID));
    linking.open(opening(ID));
    await vi.waitFor(() => expect(peekSharedItem()).toEqual({ kind: "image", uri: inCache(ID), width: null, height: null, origin: "visual_intelligence" }));
    expect(disk.copied).toHaveLength(1);
    stop();
  });

  it("app lancée par le lien, ou lien noté dans le fichier d'attente : lu une seule fois, fichier d'attente effacé", async () => {
    disk.files.set(inGroup(ID), 120_000);
    disk.texts.set(`${disk.GROUP}${PENDING_VISUAL_SEARCH_FILE}`, { content: opening(ID), at: Date.now() });
    linking.getLinkingURL.mockReturnValue(opening(ID));
    const stop = startVisualSearchIntake();
    await vi.waitFor(() => expect(peekSharedItem()).toMatchObject({ kind: "image", origin: "visual_intelligence" }));
    expect(disk.copied).toHaveLength(1);
    expect(disk.deleted).toContain(`${disk.GROUP}${PENDING_VISUAL_SEARCH_FILE}`);
    stop();
  });

  it("capture introuvable : refus « illisible », dit par le Spotter", async () => {
    const stop = startVisualSearchIntake();
    linking.open(opening(ID));
    await vi.waitFor(() => expect(peekSharedItem()).toEqual({ kind: "refused", reason: "unreadable" }));
    stop();
  });

  it("retour au premier plan : le fichier d'attente est relu", async () => {
    disk.files.set(inGroup(ID), 120_000);
    const stop = startVisualSearchIntake();
    disk.texts.set(`${disk.GROUP}${PENDING_VISUAL_SEARCH_FILE}`, { content: opening(ID), at: null });
    appState.change("active");
    await vi.waitFor(() => expect(peekSharedItem()).toMatchObject({ kind: "image" }));
    stop();
  });
});
