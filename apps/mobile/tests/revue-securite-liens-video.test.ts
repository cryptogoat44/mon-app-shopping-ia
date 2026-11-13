import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Revue de sécurité des liens vidéo, côté app : instantanés du lecteur rangés
// dans « lecteur-instantane/ » du cache et effacés au lancement, instantané
// illisible effacé, image à ne pas garder effacée quand on quitte « Entourez
// la pièce », lien en attente oublié à la déconnexion, et l'étiquette qui dit
// que les pièces trouvées seront ajoutées, sans le nom de la personne, à la
// vidéo. Doubles : fichiers, module natif, taille d'image.
const { disk, native, getSize, discardLocalFile } = vi.hoisted(() => {
  const CACHE = "file:///var/mobile/Containers/Data/Application/ABC/Library/Caches/";
  const disk = { CACHE, files: new Set<string>(), deleted: [] as string[] };
  const join = (parts: (string | { uri: string })[]) => parts.map((part) => (typeof part === "string" ? part : part.uri)).reduce((base, part) => `${base.replace(/\/?$/, "/")}${part}`);
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }
    delete() {
      disk.files.delete(this.uri);
      disk.deleted.push(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts).replace(/\/?$/, "/");
    }
    get exists() {
      return [...disk.files].some((uri) => uri.startsWith(this.uri));
    }
    list() {
      return [...disk.files].filter((uri) => uri.startsWith(this.uri)).map((uri) => new File(uri));
    }
  }
  return {
    disk: { ...disk, File, Directory },
    native: { snapshot: vi.fn(async (_tag: number) => `${CACHE}lecteur-instantane/lecteur-instantane-1.jpg`) },
    getSize: vi.fn((_uri: string, ok: (width: number, height: number) => void, _fail: (error: Error) => void) => ok(1600, 900)),
    discardLocalFile: vi.fn(),
  };
});

vi.mock("react-native", () => ({ Platform: { OS: "ios" }, Image: { getSize } }));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => native }));
vi.mock("expo-file-system", () => ({ File: disk.File, Directory: disk.Directory, Paths: { cache: new disk.Directory(disk.CACHE) } }));
vi.mock("../src/lib/video-frames", () => ({ discardLocalFile }));

import { PLAYER_SNAPSHOT_FOLDER, clearPlayerSnapshots } from "../src/lib/player-snapshot-files";
import { snapshotPlayer } from "../src/lib/player-snapshot";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";

const MOBILE = join(__dirname, "..");
const read = (path: string) => readFileSync(join(MOBILE, path), "utf8");
/** Code sans ses commentaires (« // … »). */
const code = (path: string) => read(path).replace(/^\s*\/\/.*$/gm, "");

beforeEach(() => {
  vi.clearAllMocks();
  disk.files.clear();
  disk.deleted.length = 0;
});

describe("lecteur-01 / reception-03 : instantanés du lecteur", () => {
  it("le module natif écrit dans le sous-dossier « lecteur-instantane/ » du cache, créé au besoin", () => {
    const swift = code("modules/spotto-player-snapshot/ios/SpottoPlayerSnapshotModule.swift");
    expect(swift).toContain(`static let folder = "${PLAYER_SNAPSHOT_FOLDER}"`);
    expect(swift).toContain("cache.appendingPathComponent(Self.folder, isDirectory: true)");
    expect(swift).toContain("FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)");
  });

  it("au lancement : tout le dossier des instantanés est vidé, rien d'autre du cache n'est touché", () => {
    disk.files.add(`${disk.CACHE}lecteur-instantane/lecteur-instantane-1.jpg`);
    disk.files.add(`${disk.CACHE}lecteur-instantane/lecteur-instantane-2.jpg`);
    disk.files.add(`${disk.CACHE}ImageManipulator/photo.jpg`);
    clearPlayerSnapshots();
    expect([...disk.files]).toEqual([`${disk.CACHE}ImageManipulator/photo.jpg`]);
    expect(disk.deleted).toHaveLength(2);
    expect(code("src/app/_layout.tsx")).toContain("useEffect(clearPlayerSnapshots, [])");
  });

  it("taille de l'instantané illisible : le fichier est effacé avant l'erreur (son adresse serait perdue)", async () => {
    getSize.mockImplementationOnce((_uri, _ok, fail) => fail(new Error("illisible")));
    await expect(snapshotPlayer(7)).rejects.toThrow("illisible");
    expect(discardLocalFile).toHaveBeenCalledWith(`${disk.CACHE}lecteur-instantane/lecteur-instantane-1.jpg`);
    // Taille lue : rien n'est effacé, l'adresse est rendue.
    await expect(snapshotPlayer(7)).resolves.toEqual({ uri: `${disk.CACHE}lecteur-instantane/lecteur-instantane-1.jpg`, width: 1600, height: 900 });
    expect(discardLocalFile).toHaveBeenCalledTimes(1);
  });

  it("« Entourez la pièce » quitté : le brouillon dont l'image n'est pas à garder est abandonné (effet de démontage)", () => {
    expect(code("src/app/(app)/spot/lancer.tsx")).toContain("useEffect(() => leaveLaunchScreen, []);");
  });

  it("capture de la recherche d'image : l'image préparée est rangée dans « recherche-image/ » du cache", () => {
    expect(code("src/app/(app)/(tabs)/index.tsx")).toContain("await moveIntoCaptureCache(prepared.uri)");
  });
});

describe("reception-05 : lien de vidéo en attente oublié à la déconnexion et au changement de compte", () => {
  it("signOut l'efface avant de fermer la session ; un changement de compte aussi", () => {
    const auth = code("src/lib/auth-context.tsx");
    const signOut = auth.slice(auth.indexOf("const signOut = useCallback"));
    expect(signOut.indexOf("await pendingVideoLinks.clear()")).toBeGreaterThan(-1);
    expect(signOut.indexOf("await pendingVideoLinks.clear()")).toBeLessThan(signOut.indexOf("supabase.auth.signOut()"));
    expect(auth).toContain("if (sessionUserChanged(previousUserRef.current, current)) void pendingVideoLinks.clear();");
  });
});

describe("reception-02 : l'étiquette dit ce que devient la recherche", () => {
  it("les pièces trouvées seront ajoutées, sans votre nom, aux pièces repérées de cette vidéo (français et anglais)", () => {
    expect(fr.videoLink.sharedAnonymously).toBe("Les pièces trouvées seront ajoutées, sans votre nom, aux pièces repérées de cette vidéo.");
    expect(en.videoLink.sharedAnonymously).toBe("The pieces found will be added, without your name, to the pieces spotted in this video.");
    expect(code("src/components/video-context-label.tsx")).toContain("{t.videoLink.sharedAnonymously}");
  });
});
