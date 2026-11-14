import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import marque from "@monapp/shared-types/marque.json";

// Essayage virtuel photo, app iPhone (branche feature/essayage-virtuel-mobile,
// jamais fusionnée) : ce qui change par rapport au site. La photo
// (photothèque ou appareil photo, convertie sur l'iPhone en JPEG de 1 296 px
// au plus), les fichiers temporaires (chacun effacé, même après un échec ou
// une annulation), « Enregistrer l'image » (ajout à Photos par un fichier
// aussitôt effacé), la saisie de la date de naissance et les quelques textes
// propres à l'iPhone. Les modules d'Expo sont remplacés par des doubles ; un
// faux système de fichiers, en mémoire, montre qu'aucun fichier ne reste.

const { disk, picker, manipulator, media } = vi.hoisted(() => {
  const CACHE = "file:///app/Library/Caches/";
  /** Fichiers du faux système : adresse → taille en octets et contenu écrit. */
  const files = new Map<string, { size: number; content: string }>();
  const directories = new Set<string>([CACHE]);
  const uriOf = (parts: unknown[], directory: boolean) => {
    const joined = parts
      .map((part) => (typeof part === "string" ? part : (part as { uri: string }).uri))
      .reduce((left, right) => `${left.replace(/\/+$/, "")}/${right.replace(/^\/+/, "")}`);
    return directory ? `${joined.replace(/\/+$/, "")}/` : joined.replace(/\/+$/, "");
  };
  const parentOf = (uri: string) => uri.slice(0, uri.lastIndexOf("/") + 1);

  class FakeDirectory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = uriOf(parts, true);
    }
    get exists() {
      return directories.has(this.uri);
    }
    create() {
      directories.add(this.uri);
    }
    delete() {
      if (!directories.has(this.uri)) throw new Error("dossier absent");
      directories.delete(this.uri);
      for (const uri of [...files.keys()]) if (uri.startsWith(this.uri)) files.delete(uri);
    }
  }

  class FakeFile {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = uriOf(parts, false);
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri)?.size ?? 0;
    }
    write(content: string, options?: { encoding?: string }) {
      if (!directories.has(parentOf(this.uri))) throw new Error("dossier absent");
      files.set(this.uri, { size: content.length, content: `${options?.encoding ?? "utf8"}:${content}` });
    }
    delete() {
      if (!files.has(this.uri)) throw new Error("fichier absent");
      files.delete(this.uri);
    }
    moveSync(destination: FakeDirectory) {
      const record = files.get(this.uri);
      if (!record || !directories.has(destination.uri)) throw new Error("déplacement impossible");
      const target = `${destination.uri}${this.uri.slice(this.uri.lastIndexOf("/") + 1)}`;
      files.delete(this.uri);
      files.set(target, record);
      this.uri = target;
    }
  }

  /** Fichier posé par un module d'Expo (sélecteur, conversion), dossier compris. */
  function put(uri: string, size = 1000) {
    directories.add(parentOf(uri));
    files.set(uri, { size, content: "image" });
  }

  return {
    disk: { CACHE, files, directories, FakeDirectory, FakeFile, put },
    picker: { launchImageLibraryAsync: vi.fn(), launchCameraAsync: vi.fn(), requestCameraPermissionsAsync: vi.fn() },
    manipulator: { manipulate: vi.fn() },
    media: { requestPermissionsAsync: vi.fn(), create: vi.fn() },
  };
});

vi.mock("expo-file-system", () => ({
  File: disk.FakeFile,
  Directory: disk.FakeDirectory,
  Paths: {
    get cache() {
      return new disk.FakeDirectory(disk.CACHE);
    },
  },
}));
vi.mock("expo-image-picker", () => ({ ...picker, UIImagePickerPreferredAssetRepresentationMode: { Compatible: "compatible" } }));
vi.mock("expo-image-manipulator", () => ({ ImageManipulator: manipulator, SaveFormat: { JPEG: "jpeg" } }));
vi.mock("expo-media-library", () => ({ requestPermissionsAsync: media.requestPermissionsAsync, Asset: { create: media.create } }));

import { t, setActiveLocale } from "../src/i18n";
import { tryonText } from "../src/i18n/tryon.web";
import { tryonIphoneText } from "../src/i18n/tryon.ios";
import { tryonIphoneFr } from "../src/i18n/tryon-iphone-fr.ios";
import { tryonIphoneEn } from "../src/i18n/tryon-iphone-en.ios";
import { iphonePhotoRefusalMessage, photoBody, pickTryonPhoto, prepareTryonPhoto } from "../src/lib/tryon-photo.ios";
import { discardTryonFile, keepInTryonDirectory, sweepTryonFiles, tryonTempFile } from "../src/lib/tryon-files.ios";
import { saveImageToPhotos, tryonFileName } from "../src/lib/tryon-image.ios";
import { tryonFileName as webFileName } from "../src/lib/tryon-image.web";
import { BIRTH_DATE_INPUT_LENGTH, formatBirthDateInput } from "../src/lib/tryon-age.ios";
import { checkBirthDate } from "../src/lib/tryon-read.web";

const PICKED = `${disk.CACHE}ImagePicker/4F1C.jpg`;
const TRYON_DIR = `${disk.CACHE}tryon/`;
const IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/";

interface FakeImage {
  width: number;
  height: number;
  release: ReturnType<typeof vi.fn>;
  saveAsync: ReturnType<typeof vi.fn>;
}

let saved = 0;

/** Image ouverte par le double d'expo-image-manipulator ; son enregistrement écrit un JPEG dans le cache. */
function fakeImage(width: number, height: number, savedSize = 400_000): FakeImage {
  return {
    width,
    height,
    release: vi.fn(),
    saveAsync: vi.fn(async () => {
      saved += 1;
      const uri = `${disk.CACHE}ImageManipulator/${saved}.jpg`;
      disk.put(uri, savedSize);
      return { uri, width, height };
    }),
  };
}

/** Conversion : la photo ouverte droite (`original`), puis une réduction éventuelle à la taille demandée. */
function conversion(original: FakeImage | Error, savedSize?: number) {
  const contexts: { resize: ReturnType<typeof vi.fn>; result: FakeImage | null }[] = [];
  manipulator.manipulate.mockImplementation((source: unknown) => {
    if (typeof source === "string") {
      return { resize: vi.fn(), renderAsync: vi.fn(async () => (original instanceof Error ? Promise.reject(original) : original)) };
    }
    const context = {
      size: { width: 0, height: 0 },
      result: null as FakeImage | null,
      resize: vi.fn((size: { width: number; height: number }) => {
        context.size = size;
        return context;
      }),
      renderAsync: vi.fn(async () => (context.result = fakeImage(context.size.width, context.size.height, savedSize))),
    };
    contexts.push(context);
    return context;
  });
  return contexts;
}

const remainingFiles = () => [...disk.files.keys()];

beforeEach(() => {
  vi.clearAllMocks();
  disk.files.clear();
  disk.directories.clear();
  disk.directories.add(disk.CACHE);
  saved = 0;
});

afterEach(() => {
  setActiveLocale("fr");
  vi.doUnmock("@monapp/shared-types/marque.json");
});

describe("photo de la personne : photothèque ou appareil photo", () => {
  it("photothèque : aucune autorisation demandée ; JPEG de préférence, photo d'iCloud téléchargée ; la copie rangée dans le dossier de l'essayage", async () => {
    disk.put(PICKED);
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: PICKED, width: 4032, height: 3024 }] });
    expect(await pickTryonPhoto("library")).toEqual({ kind: "picked", picked: { uri: `${TRYON_DIR}4F1C.jpg` } });
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith({ mediaTypes: ["images"], quality: 1, preferredAssetRepresentationMode: "compatible", shouldDownloadFromNetwork: true });
    expect(picker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(remainingFiles()).toEqual([`${TRYON_DIR}4F1C.jpg`]);
  });

  it("choix annulé : rien n'est écrit, rien n'est dit", async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickTryonPhoto("library")).toEqual({ kind: "cancelled" });
    expect(remainingFiles()).toEqual([]);
  });

  it("appareil photo : l'autorisation d'iOS d'abord ; refusée, il ne s'ouvre pas et le message dit où l'autoriser", async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false });
    expect(await pickTryonPhoto("camera")).toEqual({ kind: "refused", reason: "camera_denied" });
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
    expect(iphonePhotoRefusalMessage("camera_denied")).toBe(t.cameraCapture.denied);
    expect(iphonePhotoRefusalMessage("camera_denied")).toContain("Réglages");
    setActiveLocale("en");
    expect(iphonePhotoRefusalMessage("camera_denied")).toContain("Settings");
  });

  it("photo prise : rangée dans le dossier de l'essayage, jamais ajoutée à la photothèque", async () => {
    const taken = `${disk.CACHE}ImagePicker/PRISE.jpg`;
    disk.put(taken);
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: taken, width: 3024, height: 4032 }] });
    expect(await pickTryonPhoto("camera")).toEqual({ kind: "picked", picked: { uri: `${TRYON_DIR}PRISE.jpg` } });
    expect(picker.launchCameraAsync).toHaveBeenCalledWith({ mediaTypes: ["images"], quality: 1 });
    expect(media.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(media.create).not.toHaveBeenCalled();
  });

  it("appareil photo indisponible (simulateur) : le message renvoie à « Choisir dans la galerie »", async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchCameraAsync.mockRejectedValue(new Error("Camera not available on simulator"));
    expect(await pickTryonPhoto("camera")).toEqual({ kind: "refused", reason: "camera_unavailable" });
    expect(iphonePhotoRefusalMessage("camera_unavailable")).toContain(`« ${t.avatarPhoto.chooseFromLibrary} »`);
  });

  it("photo que le sélecteur n'a pas pu remettre (restée sur iCloud) : le message le dit", async () => {
    picker.launchImageLibraryAsync.mockRejectedValue(new Error("Failed to read the image"));
    expect(await pickTryonPhoto("library")).toEqual({ kind: "refused", reason: "unavailable" });
    expect(iphonePhotoRefusalMessage("unavailable")).toBe(t.common.photoUnavailable);
  });

  it("refus repris du site : photo illisible, JPEG trop lourd", () => {
    expect(iphonePhotoRefusalMessage("unreadable")).toBe(tryonText.photo.refusedUnreadable);
    expect(iphonePhotoRefusalMessage("upload_too_large")).toBe(tryonText.photo.refusedTooLarge(10));
  });
});

describe("conversion sur l'iPhone : JPEG de 1 296 px au plus, sans la photo d'origine", () => {
  it("grande photo : grand côté ramené à 1 296 px, JPEG qualité 0,9 ; la copie du sélecteur est effacée et les images libérées", async () => {
    disk.put(`${TRYON_DIR}4F1C.jpg`);
    const original = fakeImage(4032, 3024);
    const contexts = conversion(original);
    const outcome = await prepareTryonPhoto({ uri: `${TRYON_DIR}4F1C.jpg` });
    expect(outcome).toEqual({ kind: "ready", photo: { uri: `${TRYON_DIR}1.jpg`, width: 1296, height: 972 } });
    expect(contexts[0]!.resize).toHaveBeenCalledWith({ width: 1296, height: 972 });
    expect(contexts[0]!.result!.saveAsync).toHaveBeenCalledWith({ format: "jpeg", compress: 0.9 });
    expect(original.release).toHaveBeenCalledTimes(1);
    expect(contexts[0]!.result!.release).toHaveBeenCalledTimes(1);
    // Seul reste le JPEG prêt à partir, dans le dossier de l'essayage.
    expect(remainingFiles()).toEqual([`${TRYON_DIR}1.jpg`]);
  });

  it("photo en hauteur que le sélecteur annonce couchée : la taille est lue sur l'image ouverte droite", async () => {
    disk.put(`${TRYON_DIR}a.heic`);
    const contexts = conversion(fakeImage(3024, 4032));
    const outcome = await prepareTryonPhoto({ uri: `${TRYON_DIR}a.heic` });
    expect(contexts[0]!.resize).toHaveBeenCalledWith({ width: 972, height: 1296 });
    expect(outcome).toMatchObject({ kind: "ready", photo: { width: 972, height: 1296 } });
  });

  it("petite photo : jamais agrandie, enregistrée en JPEG telle quelle, en une seule ouverture", async () => {
    disk.put(`${TRYON_DIR}b.png`);
    const original = fakeImage(800, 600);
    conversion(original);
    expect(await prepareTryonPhoto({ uri: `${TRYON_DIR}b.png` })).toEqual({ kind: "ready", photo: { uri: `${TRYON_DIR}1.jpg`, width: 800, height: 600 } });
    expect(manipulator.manipulate).toHaveBeenCalledTimes(1);
    expect(original.saveAsync).toHaveBeenCalledWith({ format: "jpeg", compress: 0.9 });
    expect(remainingFiles()).toEqual([`${TRYON_DIR}1.jpg`]);
  });

  it("photo illisible : refus, et la copie du sélecteur est quand même effacée", async () => {
    disk.put(`${TRYON_DIR}c.heic`);
    conversion(new Error("decode"));
    expect(await prepareTryonPhoto({ uri: `${TRYON_DIR}c.heic` })).toEqual({ kind: "refused", reason: "unreadable" });
    expect(remainingFiles()).toEqual([]);
  });

  it("image vide : refus, rien ne reste", async () => {
    disk.put(`${TRYON_DIR}d.jpg`);
    const original = fakeImage(0, 0);
    conversion(original);
    expect(await prepareTryonPhoto({ uri: `${TRYON_DIR}d.jpg` })).toEqual({ kind: "refused", reason: "unreadable" });
    expect(original.saveAsync).not.toHaveBeenCalled();
    expect(original.release).toHaveBeenCalledTimes(1);
    expect(remainingFiles()).toEqual([]);
  });

  it("JPEG plus lourd que la limite du serveur (cas extrême) : refus, rien ne reste", async () => {
    disk.put(`${TRYON_DIR}e.jpg`);
    conversion(fakeImage(4000, 3000), 11 * 1024 * 1024);
    expect(await prepareTryonPhoto({ uri: `${TRYON_DIR}e.jpg` })).toEqual({ kind: "refused", reason: "upload_too_large" });
    expect(remainingFiles()).toEqual([]);
  });

  it("enregistrement du JPEG impossible : refus, rien ne reste", async () => {
    disk.put(`${TRYON_DIR}f.jpg`);
    const original = fakeImage(900, 1200);
    original.saveAsync.mockRejectedValue(new Error("disk full"));
    conversion(original);
    expect(await prepareTryonPhoto({ uri: `${TRYON_DIR}f.jpg` })).toEqual({ kind: "refused", reason: "unreadable" });
    expect(original.release).toHaveBeenCalledTimes(1);
    expect(remainingFiles()).toEqual([]);
  });

  it("le corps de l'envoi est le fichier lui-même (File d'expo-file-system, un vrai Blob)", () => {
    const body = photoBody({ uri: `${TRYON_DIR}1.jpg`, width: 1296, height: 972 });
    expect(body).toBeInstanceOf(disk.FakeFile);
    expect((body as unknown as { uri: string }).uri).toBe(`${TRYON_DIR}1.jpg`);
  });
});

describe("fichiers temporaires : un seul dossier, chacun effacé", () => {
  it("effacement : seulement dans le cache de l'app, silencieux si le fichier n'existe plus", () => {
    const document = "file:///app/Documents/garder.jpg";
    disk.put(document);
    disk.put(`${TRYON_DIR}x.jpg`);
    discardTryonFile(document);
    discardTryonFile(`${disk.CACHE}tryon/../../Documents/garder.jpg`);
    discardTryonFile(`${TRYON_DIR}absent.jpg`);
    discardTryonFile(null);
    discardTryonFile(`${TRYON_DIR}x.jpg`);
    expect(remainingFiles()).toEqual([document]);
  });

  it("vidage du dossier de l'essayage (ouverture et fermeture de la fenêtre) : le reste du cache est intact", () => {
    const spotter = `${disk.CACHE}ImageManipulator/spotter.jpg`;
    disk.put(spotter);
    disk.put(`${TRYON_DIR}photo.jpg`);
    disk.put(`${TRYON_DIR}spotto-essayage-2026-11-14.jpg`);
    sweepTryonFiles();
    expect(remainingFiles()).toEqual([spotter]);
    expect(() => sweepTryonFiles()).not.toThrow();
  });

  it("rangement : un fichier hors du cache n'est jamais déplacé ; un échec laisse le fichier où il est, toujours effaçable", () => {
    expect(keepInTryonDirectory("file:///app/Documents/a.jpg")).toBe("file:///app/Documents/a.jpg");
    // Fichier déjà disparu : le déplacement échoue, l'adresse d'origine est rendue.
    expect(keepInTryonDirectory(`${disk.CACHE}ImagePicker/disparu.jpg`)).toBe(`${disk.CACHE}ImagePicker/disparu.jpg`);
  });

  it("nouveau fichier : dans le dossier de l'essayage, créé au besoin", () => {
    const file = tryonTempFile("image.jpg");
    expect(file.uri).toBe(`${TRYON_DIR}image.jpg`);
    expect(disk.directories.has(TRYON_DIR)).toBe(true);
  });
});

describe("« Enregistrer l'image » : ajout à Photos par un fichier aussitôt effacé", () => {
  const NAME = tryonFileName("spotto-essayage", "2026-11-14");

  it("accès « ajout seulement » ; l'image du serveur est remise telle quelle à Photos, puis le fichier est effacé", async () => {
    media.requestPermissionsAsync.mockResolvedValue({ granted: true, status: "granted" });
    const written: string[] = [];
    media.create.mockImplementation(async (uri: string) => {
      written.push(uri, disk.files.get(uri)?.content ?? "");
      return { id: "ph://1" };
    });
    expect(await saveImageToPhotos(IMAGE, NAME)).toBe("saved");
    expect(media.requestPermissionsAsync).toHaveBeenCalledWith(true);
    expect(written).toEqual([`${TRYON_DIR}spotto-essayage-2026-11-14.jpg`, "base64:/9j/4AAQSkZJRgABAQAAAQABAAD/"]);
    expect(remainingFiles()).toEqual([]);
  });

  it("ajout refusé dans les Réglages : rien n'est écrit, et le message dit où l'autoriser", async () => {
    media.requestPermissionsAsync.mockResolvedValue({ granted: false, status: "denied" });
    expect(await saveImageToPhotos(IMAGE, NAME)).toBe("denied");
    expect(media.create).not.toHaveBeenCalled();
    expect(remainingFiles()).toEqual([]);
    expect(tryonIphoneText.save.denied).toContain("Réglages");
  });

  it("échec de Photos : le fichier temporaire est quand même effacé", async () => {
    media.requestPermissionsAsync.mockResolvedValue({ granted: true, status: "granted" });
    media.create.mockRejectedValue(new Error("PHPhotosErrorDomain"));
    expect(await saveImageToPhotos(IMAGE, NAME)).toBe("failed");
    expect(remainingFiles()).toEqual([]);
  });

  it("autorisation illisible ou image invalide : rien n'est écrit", async () => {
    media.requestPermissionsAsync.mockRejectedValue(new Error("module absent"));
    expect(await saveImageToPhotos(IMAGE, NAME)).toBe("failed");
    expect(await saveImageToPhotos("data:image/png;base64,iVBORw0KGgo=", NAME)).toBe("failed");
    expect(media.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(media.create).not.toHaveBeenCalled();
    expect(remainingFiles()).toEqual([]);
  });

  it("nom du fichier : celui du site, en « .jpg » (Photos reconnaît le type au nom)", () => {
    expect(tryonFileName).toBe(webFileName);
    expect(NAME).toBe("spotto-essayage-2026-11-14.jpg");
  });
});

describe("date de naissance : chiffres au clavier, tirets posés seuls", () => {
  it("les tirets suivent la frappe, au format du site (AAAA-MM-JJ)", () => {
    expect(["1", "1990", "19900", "199005", "1990051", "19900512"].map(formatBirthDateInput)).toEqual(["1", "1990", "1990-0", "1990-05", "1990-05-1", "1990-05-12"]);
  });

  it("retour arrière : le tiret devenu inutile disparaît ; collage : seuls les chiffres comptent", () => {
    expect(formatBirthDateInput("1990-05-")).toBe("1990-05");
    expect(formatBirthDateInput("1990-")).toBe("1990");
    expect(formatBirthDateInput("12/05/1990")).toBe("1205-19-90");
    expect(formatBirthDateInput("1990-05-12 et plus 99")).toBe("1990-05-12");
    expect(formatBirthDateInput("1990-05-12").length).toBe(BIRTH_DATE_INPUT_LENGTH);
  });

  it("le contrôle du site décide ensuite : date incomplète ou impossible refusée avant tout envoi", () => {
    expect(checkBirthDate(formatBirthDateInput(""), "2026-11-14")).toBe("incomplete");
    expect(checkBirthDate(formatBirthDateInput("199005"), "2026-11-14")).toBe("incomplete");
    expect(checkBirthDate(formatBirthDateInput("12/05/1990"), "2026-11-14")).toBe("invalid");
    expect(checkBirthDate(formatBirthDateInput("19900512"), "2026-11-14")).toBeNull();
  });
});

// Même règles que tests/tryon-catalog.test.ts pour le catalogue du site.
function texts(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (typeof node === "function") return texts(node(2, 3));
  if (Array.isArray(node)) return node.flatMap(texts);
  if (node && typeof node === "object") return Object.values(node).flatMap(texts);
  return [];
}

function keys(node: unknown, prefix = ""): string[] {
  if (!node || typeof node !== "object" || Array.isArray(node)) return [prefix];
  return Object.entries(node).flatMap(([key, value]) => keys(value, prefix ? `${prefix}.${key}` : key));
}

const FRENCH_MARKS = /[àâçéèêëîïôûùœ«»]|\b(vous|votre|le|la|les|des|une|pour|avec)\b/i;
const TUTOIEMENT = /(?<!\p{L})(tu|te|toi|ton|ta|tes)(?!\p{L})|(?<!\p{L})t'/iu;
const NOM = new RegExp(marque.nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

describe("textes propres à l'iPhone (src/i18n/tryon-iphone-*.ios.ts)", () => {
  it("les deux langues ont exactement les mêmes clés, dans le même ordre ; aucun texte vide", () => {
    expect(keys(tryonIphoneEn)).toEqual(keys(tryonIphoneFr));
    for (const text of [...texts(tryonIphoneFr), ...texts(tryonIphoneEn)]) expect(text.trim().length, text).toBeGreaterThan(0);
  });

  it("aucun français dans l'anglais, aucun texte laissé identique ; vouvoiement en français", () => {
    expect(texts(tryonIphoneEn).filter((text) => FRENCH_MARKS.test(text))).toEqual([]);
    const english = texts(tryonIphoneEn);
    expect(texts(tryonIphoneFr).filter((text, index) => text === english[index])).toEqual([]);
    const all = texts(tryonIphoneFr).join("\n");
    expect(all).not.toMatch(TUTOIEMENT);
    expect(all).toMatch(/\bvos\b|\bvous\b/);
  });

  it("aucun texte du site recopié : chaque texte propre à l'iPhone est nouveau", () => {
    const site = new Set(texts(tryonText));
    expect(texts(tryonIphoneFr).filter((text) => site.has(text))).toEqual([]);
  });

  it("la langue suit celle de l'app, lue à chaque affichage", () => {
    expect(tryonIphoneText.save.saved).toBe("Image enregistrée dans vos photos.");
    setActiveLocale("en");
    expect(tryonIphoneText.save.saved).toBe("Image saved to your photos.");
  });

  it("avec un autre nom dans marque.json, le nouveau nom arrive dans les textes, l'ancien nulle part", async () => {
    vi.resetModules();
    vi.doMock("@monapp/shared-types/marque.json", () => ({ default: { ...marque, nom: "Zorglub" } }));
    const [{ tryonIphoneFr: fr }, { tryonIphoneEn: en }] = await Promise.all([import("../src/i18n/tryon-iphone-fr.ios"), import("../src/i18n/tryon-iphone-en.ios")]);
    for (const catalog of [fr, en]) {
      const all = texts(catalog);
      expect(all.filter((text) => NOM.test(text))).toEqual([]);
      expect(all.some((text) => text.includes("Zorglub"))).toBe(true);
    }
  });

  it("aucun fichier ne fige un texte propre à l'iPhone au chargement d'un module", () => {
    const ROOT = join(__dirname, "../src");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return files(path);
        return /\.(ts|tsx)$/.test(name) ? [path] : [];
      });
    // Même détecteur que tests/tryon-catalog.test.ts, pour `tryonIphoneText.`.
    const readAtLoad = (source: string): number[] => {
      const found: number[] = [];
      let inside = false;
      const reads = (line: string) => /(?<![\w.])tryonIphoneText\.[a-zA-Z]/.test(line) && !line.includes("=>") && !line.includes("function");
      source.split("\n").forEach((line, index) => {
        const opens = /^(export )?const \w+[^=]*= *[{[]\s*$/.test(line);
        const oneLine = /^(export )?const \w+[^=]*= *[{[].*[}\]];?\s*$/.test(line);
        if (opens || oneLine) {
          inside = opens;
          if (oneLine && reads(line)) found.push(index + 1);
          return;
        }
        if (!inside) return;
        if (/^[}\]]/.test(line)) {
          inside = false;
          return;
        }
        if (reads(line)) found.push(index + 1);
      });
      return found;
    };
    expect(readAtLoad("const A = {\n  a: tryonIphoneText.save.saved,\n};")).toEqual([2]);
    const found = files(ROOT)
      .filter((file) => !relative(ROOT, file).startsWith("i18n/"))
      .flatMap((file) => readAtLoad(readFileSync(file, "utf8")).map((line) => `${relative(ROOT, file)}:${line}`));
    expect(found).toEqual([]);
  });
});
