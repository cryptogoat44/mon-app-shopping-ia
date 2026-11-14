import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PHOTO_MAX_SIDE,
  PHOTO_SOURCE_MAX_BYTES,
  PHOTO_UPLOAD_MAX_BYTES,
  checkPhotoFile,
  chooseTryonFile,
  fittedSize,
  isHeicFile,
  preparePhoto,
} from "../src/lib/tryon-photo.web";
import { downloadImage, jpegBlobFromDataUri, tryonFileName } from "../src/lib/tryon-image.web";

// Essayage virtuel photo (site) : la photo de la personne (formats acceptés,
// taille, conversion en JPEG de 1 296 px au plus dans un canevas, métadonnées
// perdues, adresses temporaires libérées) et l'image produite (décodée en
// mémoire, enregistrée par un téléchargement direct). Faux navigateur écrit à
// la main : image, canevas, champ de fichier, lien.

interface FakeCanvas {
  width: number;
  height: number;
  context: { fillStyle: string; imageSmoothingQuality: string; fillRect: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn> } | null;
  getContext: (kind: string) => FakeCanvas["context"];
  toBlob: ReturnType<typeof vi.fn>;
  sizes: { width: number; height: number }[];
}

const browser = vi.hoisted(() => ({
  /** Dimensions de l'image que le faux navigateur « ouvre » ; null : il ne sait pas la lire. */
  image: { width: 4000, height: 3000 } as { width: number; height: number } | null,
  /** Ce que rend le canevas (null : échec). */
  output: null as Blob | null,
  noContext: false,
  canvases: [] as unknown[],
  created: [] as string[],
  revoked: [] as string[],
  appended: [] as unknown[],
}));

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  set src(_url: string) {
    setTimeout(() => {
      if (browser.image) {
        this.naturalWidth = browser.image.width;
        this.naturalHeight = browser.image.height;
        this.onload?.();
      } else {
        this.onerror?.();
      }
    }, 0);
  }
}

function fakeCanvas(): FakeCanvas {
  const canvas: FakeCanvas = {
    width: 300,
    height: 150,
    sizes: [],
    context: browser.noContext ? null : { fillStyle: "", imageSmoothingQuality: "low", fillRect: vi.fn(), drawImage: vi.fn() },
    getContext: () => canvas.context,
    toBlob: vi.fn((done: (blob: Blob | null) => void) => {
      canvas.sizes.push({ width: canvas.width, height: canvas.height });
      setTimeout(() => done(browser.output), 0);
    }),
  };
  return canvas;
}

/** Champ de fichier ou lien : ce que le code touche, et de quoi simuler le navigateur. */
function fakeNode(tag: string) {
  const listeners = new Map<string, () => void>();
  return {
    tag,
    type: "",
    accept: "",
    href: "",
    download: "",
    rel: "",
    style: {} as Record<string, string>,
    files: null as File[] | null,
    removed: false,
    clicked: 0,
    addEventListener: (name: string, listener: () => void) => void listeners.set(name, listener),
    fire: (name: string) => listeners.get(name)?.(),
    click() {
      this.clicked += 1;
    },
    remove() {
      this.removed = true;
    },
  };
}

type FakeNode = ReturnType<typeof fakeNode>;

function fakeElement(tag: string): FakeCanvas | FakeNode {
  if (tag !== "canvas") return fakeNode(tag);
  const canvas = fakeCanvas();
  browser.canvases.push(canvas);
  return canvas;
}

const jpeg = (size = 2048) => new Blob([new Uint8Array(size)], { type: "image/jpeg" });
const photoFile = (name: string, type: string, size = 1024) => new File([new Uint8Array(size)], name, { type });

beforeEach(() => {
  Object.assign(browser, { image: { width: 4000, height: 3000 }, output: jpeg(), noContext: false, canvases: [], created: [], revoked: [], appended: [] });
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("document", { createElement: vi.fn(fakeElement), body: { appendChild: (node: unknown) => browser.appended.push(node) } });
  let next = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const url = `blob:https://site.exemple.test/${(next += 1)}`;
    browser.created.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => void browser.revoked.push(url));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("formats acceptés : JPEG, PNG, WebP, HEIC ; 30 Mo au plus avant conversion", () => {
  it("par type ou par extension (type vide pour le HEIC sur certains navigateurs)", () => {
    for (const [name, type] of [
      ["a.jpg", "image/jpeg"],
      ["capture.png", "image/png"],
      ["photo.webp", "image/webp"],
      ["IMG_0001.HEIC", "image/heic"],
      ["IMG_0002.heif", "image/heif"],
      ["IMG_0003.HEIC", ""],
      ["IMG_0004.HEIC", "application/octet-stream"],
    ] as const) {
      expect(checkPhotoFile({ name, type, size: 1024 }), name).toBeNull();
    }
  });

  it("autres formats refusés avant même d'ouvrir la photo", () => {
    for (const [name, type] of [
      ["a.gif", "image/gif"],
      ["logo.svg", "image/svg+xml"],
      ["photo.tiff", ""],
      ["doc.pdf", "application/pdf"],
      ["page.html", "text/html"],
      ["sans-extension", ""],
      ["photo.avif", "image/avif"],
    ] as const) {
      expect(checkPhotoFile({ name, type, size: 1024 }), name).toBe("format");
    }
  });

  it("trop lourde : refusée avant d'être ouverte", () => {
    expect(checkPhotoFile({ name: "a.jpg", type: "image/jpeg", size: PHOTO_SOURCE_MAX_BYTES })).toBeNull();
    expect(checkPhotoFile({ name: "a.jpg", type: "image/jpeg", size: PHOTO_SOURCE_MAX_BYTES + 1 })).toBe("too_large");
  });

  it("HEIC reconnu par son type ou son nom", () => {
    expect(isHeicFile({ name: "IMG.HEIC", type: "", size: 1 })).toBe(true);
    expect(isHeicFile({ name: "x", type: "image/heif-sequence", size: 1 })).toBe(true);
    expect(isHeicFile({ name: "a.jpg", type: "image/jpeg", size: 1 })).toBe(false);
  });
});

describe("taille du JPEG envoyé : grand côté de 1 296 px au plus, jamais agrandi", () => {
  it("paysage, portrait, carré, petite image", () => {
    expect(PHOTO_MAX_SIDE).toBe(1296);
    expect(fittedSize(4000, 3000)).toEqual({ width: 1296, height: 972 });
    expect(fittedSize(3024, 4032)).toEqual({ width: 972, height: 1296 });
    expect(fittedSize(2000, 2000)).toEqual({ width: 1296, height: 1296 });
    expect(fittedSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fittedSize(1296, 10)).toEqual({ width: 1296, height: 10 });
    expect(fittedSize(20000, 10)).toEqual({ width: 1296, height: 1 });
  });
});

describe("conversion dans un canevas : JPEG, métadonnées perdues, rien d'écrit", () => {
  it("photo redessinée à la bonne taille sur fond blanc, en JPEG ; adresse du fichier d'origine libérée", async () => {
    const choice = await preparePhoto(photoFile("IMG_1234.jpg", "image/jpeg"));
    expect(choice).toEqual({ kind: "picked", photo: { blob: browser.output, width: 1296, height: 972 } });
    const canvas = browser.canvases[0] as FakeCanvas;
    expect(canvas.sizes).toEqual([{ width: 1296, height: 972 }]);
    expect(canvas.context!.fillStyle).toBe("#ffffff");
    expect(canvas.context!.fillRect).toHaveBeenCalledWith(0, 0, 1296, 972);
    expect(canvas.context!.drawImage).toHaveBeenCalledWith(expect.any(FakeImage), 0, 0, 1296, 972);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.9);
    // Mémoire du canevas libérée aussitôt ; adresse temporaire du fichier libérée.
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    expect(browser.revoked).toEqual(browser.created);
    expect(browser.created).toHaveLength(1);
  });

  it("HEIC que le navigateur ne sait pas ouvrir : message dédié ; autre fichier illisible : message général", async () => {
    browser.image = null;
    expect(await preparePhoto(photoFile("IMG_0001.HEIC", "image/heic"))).toEqual({ kind: "refused", reason: "heic_browser" });
    expect(await preparePhoto(photoFile("abime.jpg", "image/jpeg"))).toEqual({ kind: "refused", reason: "unreadable" });
    expect(browser.revoked).toEqual(browser.created);
  });

  it("format refusé : la photo n'est même pas ouverte", async () => {
    expect(await preparePhoto(photoFile("anim.gif", "image/gif"))).toEqual({ kind: "refused", reason: "format" });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("canevas indisponible ou sans résultat : illisible ; JPEG trop lourd (cas extrême) : refusé", async () => {
    browser.noContext = true;
    expect(await preparePhoto(photoFile("a.jpg", "image/jpeg"))).toEqual({ kind: "refused", reason: "unreadable" });
    browser.noContext = false;
    browser.output = null;
    expect(await preparePhoto(photoFile("a.jpg", "image/jpeg"))).toEqual({ kind: "refused", reason: "unreadable" });
    browser.output = new Blob([new Uint8Array(8)], { type: "image/gif" });
    expect(await preparePhoto(photoFile("a.jpg", "image/jpeg"))).toEqual({ kind: "refused", reason: "unreadable" });
    browser.output = jpeg(PHOTO_UPLOAD_MAX_BYTES + 1);
    expect(await preparePhoto(photoFile("a.jpg", "image/jpeg"))).toEqual({ kind: "refused", reason: "upload_too_large" });
  });
});

describe("choix du fichier", () => {
  it("champ caché, formats annoncés, ouvert dans le geste ; le fichier choisi est rendu, le champ retiré", async () => {
    const choosing = chooseTryonFile();
    const input = browser.appended[0] as FakeNode;
    expect(input.type).toBe("file");
    expect(input.accept.split(",")).toEqual(expect.arrayContaining(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]));
    expect(input.style.display).toBe("none");
    expect(input.clicked).toBe(1);
    const file = photoFile("moi.png", "image/png");
    input.files = [file];
    input.fire("change");
    expect(await choosing).toBe(file);
    expect(input.removed).toBe(true);
  });

  it("annulé : null", async () => {
    const choosing = chooseTryonFile();
    (browser.appended[0] as FakeNode).fire("cancel");
    expect(await choosing).toBeNull();
  });
});

describe("image produite", () => {
  it("décodée en mémoire depuis le base64 (octet pour octet) ; adresse illisible : null", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const dataUri = `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
    const blob = jpegBlobFromDataUri(dataUri)!;
    expect(blob.type).toBe("image/jpeg");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(jpegBlobFromDataUri("data:image/png;base64,iVBORw0KGgo=")).toBeNull();
    expect(jpegBlobFromDataUri("https://cdn.exemple.test/a.jpg")).toBeNull();
  });

  it("nom du fichier enregistré", () => {
    expect(tryonFileName("produit-essayage", "2026-11-13")).toBe("produit-essayage-2026-11-13.jpg");
  });

  it("enregistrement : téléchargement direct par un lien caché, retiré aussitôt", () => {
    downloadImage("blob:https://site.exemple.test/9", "produit-essayage-2026-11-13.jpg");
    const link = browser.appended[0] as FakeNode;
    expect(link.tag).toBe("a");
    expect(link.href).toBe("blob:https://site.exemple.test/9");
    expect(link.download).toBe("produit-essayage-2026-11-13.jpg");
    expect(link.clicked).toBe(1);
    expect(link.removed).toBe(true);
  });
});
