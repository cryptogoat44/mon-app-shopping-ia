import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Lot « profil et icône des réglages » : photo de profil — ce qui est
// accepté (JPEG, PNG, HEIC), les refus et leurs messages, les étapes du
// parcours (menu → choix → cadrage → envoi ; ou suppression), la conversion
// en JPEG sur l'appareil. Sélecteur et retouche d'image simulés.
const { launchImageLibraryAsync, launchCameraAsync, requestCameraPermissionsAsync, manipulate } = vi.hoisted(() => ({
  launchImageLibraryAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
  requestCameraPermissionsAsync: vi.fn(),
  manipulate: vi.fn(),
}));
vi.mock("expo-image-picker", () => ({
  launchImageLibraryAsync,
  launchCameraAsync,
  requestCameraPermissionsAsync,
  UIImagePickerPreferredAssetRepresentationMode: { Automatic: "automatic", Compatible: "compatible", Current: "current" },
  CameraType: { back: "back", front: "front" },
}));
vi.mock("expo-image-manipulator", () => ({ ImageManipulator: { manipulate }, SaveFormat: { JPEG: "jpeg", PNG: "png" } }));

import { AVATAR_MAX_BYTES } from "@monapp/shared-types";
import { setActiveLocale } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import {
  AVATAR_SOURCE_MAX_BYTES,
  CLOSED,
  avatarFlow,
  checkSourceFile,
  isHeicLike,
  isUploadTooLarge,
  refusalMessage,
  undecodableRefusal,
  uploadTooLargeMessage,
  type AvatarFlow,
  type AvatarFlowEvent,
} from "../src/lib/avatar-photo";
import { pickAvatarFromLibrary, takeAvatarPhoto } from "../src/lib/avatar-source";
import * as webSource from "../src/lib/avatar-source.web";
import { renderAvatarCrop } from "../src/lib/avatar-image";

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  setActiveLocale("fr");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const IMAGE = { uri: "file:///cache/photo.jpg", width: 3024, height: 4032 };

describe("formats acceptés : JPEG, PNG, HEIC", () => {
  it("par type ou par nom de fichier", () => {
    for (const file of [
      { mimeType: "image/jpeg", fileName: "a.jpg" },
      { mimeType: "image/png", fileName: "capture.png" },
      { mimeType: "image/heic", fileName: "IMG_0001.HEIC" },
      { mimeType: "image/heif" },
      { mimeType: "", fileName: "IMG_0002.heic" }, // Chrome sous Windows : type vide
      { mimeType: "application/octet-stream", fileName: "IMG_0003.HEIC" },
      {},
    ]) {
      expect(checkSourceFile(file), JSON.stringify(file)).toBeNull();
    }
  });

  it("autres formats refusés, dit clairement", () => {
    for (const file of [{ mimeType: "image/gif", fileName: "a.gif" }, { mimeType: "image/webp" }, { mimeType: "image/svg+xml", fileName: "logo.svg" }, { mimeType: "", fileName: "photo.tiff" }, { mimeType: "application/pdf", fileName: "doc.pdf" }]) {
      expect(checkSourceFile(file), JSON.stringify(file)).toBe("format");
    }
    expect(refusalMessage("format")).toBe("Format non accepté : choisissez une photo JPEG, PNG ou HEIC.");
  });

  it("trop lourde avant même d'être ouverte (30 Mo) ; carré envoyé : 5 Mo au plus, comme le serveur", () => {
    expect(checkSourceFile({ mimeType: "image/jpeg", fileSize: AVATAR_SOURCE_MAX_BYTES })).toBeNull();
    expect(checkSourceFile({ mimeType: "image/jpeg", fileSize: AVATAR_SOURCE_MAX_BYTES + 1 })).toBe("too_large");
    expect(refusalMessage("too_large")).toBe("Cette photo est trop lourde (30 Mo maximum). Choisissez-en une autre.");
    expect(isUploadTooLarge(AVATAR_MAX_BYTES)).toBe(false);
    expect(isUploadTooLarge(AVATAR_MAX_BYTES + 1)).toBe(true);
    expect(uploadTooLargeMessage()).toBe("Cette photo est trop lourde (5 Mo maximum). Choisissez-en une autre.");
  });

  it("HEIC illisible par le navigateur : message clair (Safari ou l'app) ; autre fichier illisible : message général", () => {
    expect(isHeicLike({ mimeType: "image/heic" })).toBe(true);
    expect(isHeicLike({ fileName: "IMG_1.HEIF" })).toBe(true);
    expect(isHeicLike({ mimeType: "image/jpeg", fileName: "a.jpg" })).toBe(false);
    expect(undecodableRefusal({ mimeType: "", fileName: "IMG_1.heic" })).toBe("heic_browser");
    expect(undecodableRefusal({ mimeType: "image/png" })).toBe("unreadable");
    expect(refusalMessage("heic_browser")).toContain("Safari");
    setActiveLocale("en");
    expect(refusalMessage("heic_browser")).toBe("This browser can't open HEIC photos. Choose a JPEG or PNG photo, or use Safari or the Spotto iPhone app.");
    expect(refusalMessage("camera_denied")).toBe(en.cameraCapture.denied);
  });
});

describe("étapes du parcours", () => {
  const run = (events: AvatarFlowEvent[], from: AvatarFlow = CLOSED) => events.reduce(avatarFlow, from);
  const picked: AvatarFlowEvent = { type: "picked", result: { kind: "picked", image: IMAGE } };

  it("menu → choix → cadrage → valider → envoi → fermé", () => {
    expect(run([{ type: "open" }])).toEqual({ step: "menu", error: null });
    expect(run([{ type: "open" }, { type: "pick" }])).toEqual({ step: "picking" });
    expect(run([{ type: "open" }, { type: "pick" }, picked])).toEqual({ step: "crop", image: IMAGE, error: null });
    expect(run([{ type: "open" }, { type: "pick" }, picked, { type: "validate" }])).toEqual({ step: "sending", image: IMAGE });
    expect(run([{ type: "open" }, { type: "pick" }, picked, { type: "validate" }, { type: "succeeded" }])).toEqual(CLOSED);
  });

  it("envoi raté : retour au cadrage, même photo, avec le message (on peut réessayer)", () => {
    const failed = run([{ type: "open" }, { type: "pick" }, picked, { type: "validate" }, { type: "failed", message: "L'envoi a échoué." }]);
    expect(failed).toEqual({ step: "crop", image: IMAGE, error: "L'envoi a échoué." });
    expect(avatarFlow(failed, { type: "validate" })).toEqual({ step: "sending", image: IMAGE });
  });

  it("choix annulé : fermé ; choix refusé : le menu revient avec le message", () => {
    expect(run([{ type: "open" }, { type: "pick" }, { type: "picked", result: { kind: "cancelled" } }])).toEqual(CLOSED);
    expect(run([{ type: "open" }, { type: "pick" }, { type: "picked", result: { kind: "refused", reason: "heic_browser" } }])).toEqual({
      step: "menu",
      error: refusalMessage("heic_browser"),
    });
  });

  it("supprimer : confirmation, puis suppression ; un échec ramène au menu avec le message", () => {
    const confirm = run([{ type: "open" }, { type: "askDelete" }]);
    expect(confirm).toEqual({ step: "confirmDelete" });
    expect(avatarFlow(confirm, { type: "close" })).toEqual(CLOSED);
    const deleting = avatarFlow(confirm, { type: "confirmDelete" });
    expect(deleting).toEqual({ step: "deleting" });
    expect(avatarFlow(deleting, { type: "succeeded" })).toEqual(CLOSED);
    expect(avatarFlow(deleting, { type: "failed", message: "Réessayez." })).toEqual({ step: "menu", error: "Réessayez." });
  });

  it("pendant un envoi ou une suppression, « Annuler » attend la réponse ; les événements hors étape sont ignorés", () => {
    const sending: AvatarFlow = { step: "sending", image: IMAGE };
    expect(avatarFlow(sending, { type: "close" })).toBe(sending);
    expect(avatarFlow({ step: "deleting" }, { type: "close" })).toEqual({ step: "deleting" });
    expect(avatarFlow(CLOSED, { type: "validate" })).toBe(CLOSED);
    expect(avatarFlow(CLOSED, picked)).toBe(CLOSED);
    expect(avatarFlow({ step: "menu", error: null }, { type: "open" })).toEqual({ step: "menu", error: null });
  });
});

describe("iPhone : galerie et appareil photo", () => {
  it("galerie : demandée en JPEG (« compatible »), photo d'iCloud téléchargée, sans autorisation", async () => {
    launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///cache/a.jpg", width: 4032, height: 3024, mimeType: "image/jpeg", fileName: "IMG_1.jpg", fileSize: 3_000_000 }] });
    expect(await pickAvatarFromLibrary()).toEqual({ kind: "picked", image: { uri: "file:///cache/a.jpg", width: 4032, height: 3024 } });
    expect(launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ["images"], preferredAssetRepresentationMode: "compatible", shouldDownloadFromNetwork: true }));
    expect(requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });

  it("HEIC remis tel quel par iOS : accepté (il sera converti en JPEG au recadrage) ; GIF : refusé", async () => {
    launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///cache/b.heic", width: 4032, height: 3024, mimeType: "image/heic", fileName: "IMG_2.heic" }] });
    expect((await pickAvatarFromLibrary()).kind).toBe("picked");
    launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///cache/c.gif", width: 200, height: 200, mimeType: "image/gif", fileName: "c.gif" }] });
    expect(await pickAvatarFromLibrary()).toEqual({ kind: "refused", reason: "format" });
  });

  it("annulé, ou photo impossible à lire (restée sur iCloud sans réseau)", async () => {
    launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickAvatarFromLibrary()).toEqual({ kind: "cancelled" });
    launchImageLibraryAsync.mockRejectedValue(new Error("Failed to read"));
    expect(await pickAvatarFromLibrary()).toEqual({ kind: "refused", reason: "unreadable" });
  });

  it("appareil photo : autorisation demandée, caméra avant ; refusée, on dit où l'autoriser", async () => {
    requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
    launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///cache/selfie.jpg", width: 3024, height: 4032, mimeType: "image/jpeg" }] });
    expect((await takeAvatarPhoto()).kind).toBe("picked");
    expect(launchCameraAsync).toHaveBeenCalledWith(expect.objectContaining({ cameraType: "front" }));
    requestCameraPermissionsAsync.mockResolvedValue({ granted: false });
    expect(await takeAvatarPhoto()).toEqual({ kind: "refused", reason: "camera_denied" });
    expect(refusalMessage("camera_denied")).toBe(fr.cameraCapture.denied);
  });
});

describe("site : choix d'un fichier", () => {
  /** Simule le navigateur : le fichier choisi, et s'il sait l'ouvrir. */
  function browser(file: File | null, decodes: boolean) {
    const listeners: Record<string, () => void> = {};
    const input = {
      type: "",
      accept: "",
      style: {},
      files: file ? [file] : [],
      addEventListener: (name: string, listener: () => void) => (listeners[name] = listener),
      remove: vi.fn(),
      click: () => queueMicrotask(() => (file ? listeners.change?.() : listeners.cancel?.())),
    };
    vi.stubGlobal("document", { createElement: () => input, body: { appendChild: vi.fn() } });
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        naturalWidth = 1600;
        naturalHeight = 1200;
        set src(_value: string) {
          queueMicrotask(() => (decodes ? this.onload?.() : this.onerror?.()));
        }
      }
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:essai");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    return { input, revoke };
  }

  it("JPEG : prêt à cadrer ; le choix ne propose que JPEG, PNG et HEIC", async () => {
    const { input } = browser(new File([new Uint8Array(10)], "photo.jpg", { type: "image/jpeg" }), true);
    expect(await webSource.pickAvatarFromLibrary()).toEqual({ kind: "picked", image: { uri: "blob:essai", width: 1600, height: 1200 } });
    expect(input.accept).toBe("image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif");
    expect(webSource.CAN_TAKE_PHOTO).toBe(false);
  });

  it("HEIC sur Chrome (illisible) : message clair, rien n'est gardé en mémoire ; sur Safari (lisible) : accepté", async () => {
    const heic = new File([new Uint8Array(10)], "IMG_0001.HEIC", { type: "" });
    const chrome = browser(heic, false);
    expect(await webSource.pickAvatarFromLibrary()).toEqual({ kind: "refused", reason: "heic_browser" });
    expect(chrome.revoke).toHaveBeenCalledWith("blob:essai");
    vi.unstubAllGlobals();
    browser(new File([new Uint8Array(10)], "IMG_0001.HEIC", { type: "image/heic" }), true);
    expect((await webSource.pickAvatarFromLibrary()).kind).toBe("picked");
  });

  it("annulé ; trop lourd ; autre format", async () => {
    browser(null, true);
    expect(await webSource.pickAvatarFromLibrary()).toEqual({ kind: "cancelled" });
    vi.unstubAllGlobals();
    const big = new File([new Uint8Array(10)], "grosse.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: AVATAR_SOURCE_MAX_BYTES + 1 });
    browser(big, true);
    expect(await webSource.pickAvatarFromLibrary()).toEqual({ kind: "refused", reason: "too_large" });
    vi.unstubAllGlobals();
    browser(new File([new Uint8Array(10)], "anim.gif", { type: "image/gif" }), true);
    expect(await webSource.pickAvatarFromLibrary()).toEqual({ kind: "refused", reason: "format" });
  });
});

describe("recadrage sur l'appareil : un carré JPEG", () => {
  it("zone choisie découpée, ramenée à 1 024 px, enregistrée en JPEG (une photo HEIC devient un JPEG)", async () => {
    const release = vi.fn();
    const saveAsync = vi.fn(async () => ({ uri: "file:///cache/carre.jpg", width: 1024, height: 1024 }));
    const context = { crop: vi.fn(), resize: vi.fn(), renderAsync: vi.fn(async () => ({ saveAsync, release })) };
    manipulate.mockReturnValue(context);
    const crop = { originX: 0, originY: 504, width: 3024, height: 3024 };
    expect(await renderAvatarCrop({ ...IMAGE, uri: "file:///cache/IMG_1.heic" }, crop)).toBe("file:///cache/carre.jpg");
    expect(manipulate).toHaveBeenCalledWith("file:///cache/IMG_1.heic");
    expect(context.crop).toHaveBeenCalledWith(crop);
    expect(context.resize).toHaveBeenCalledWith({ width: 1024, height: 1024 });
    expect(saveAsync).toHaveBeenCalledWith({ format: "jpeg", compress: 0.85 });
    expect(release).toHaveBeenCalled();
  });

  it("petite zone : jamais agrandie ; image illisible : null (message à la personne)", async () => {
    const context = { crop: vi.fn(), resize: vi.fn(), renderAsync: vi.fn(async () => ({ saveAsync: async () => ({ uri: "file:///x.jpg" }), release: vi.fn() })) };
    manipulate.mockReturnValue(context);
    await renderAvatarCrop(IMAGE, { originX: 0, originY: 0, width: 400, height: 400 });
    expect(context.resize).toHaveBeenCalledWith({ width: 400, height: 400 });
    manipulate.mockReturnValue({ crop: vi.fn(), resize: vi.fn(), renderAsync: vi.fn(async () => Promise.reject(new Error("decode"))) });
    expect(await renderAvatarCrop(IMAGE, { originX: 0, originY: 0, width: 400, height: 400 })).toBeNull();
  });
});

describe("textes de la photo de profil (FR et EN)", () => {
  it("français : vouvoiement, jamais de tutoiement", () => {
    const all = [...Object.values(fr.avatarPhoto), fr.editProfile.changePhoto, fr.editProfile.addPhoto, fr.editProfile.bioHint, fr.editProfile.bioTooLong, fr.editProfile.bioTooManyLines]
      .map((text) => (typeof text === "function" ? (text as (...args: number[]) => string)(160, 3) : text))
      .join("\n");
    expect(all).not.toMatch(/\b(tu|te|toi|ton|ta|tes|t')\b/i);
    expect(fr.avatarPhoto.removeConfirm).toContain("Votre");
  });

  it("anglais : chaque texte traduit", () => {
    for (const key of Object.keys(fr.avatarPhoto) as (keyof typeof fr.avatarPhoto)[]) {
      const french = fr.avatarPhoto[key];
      const english = en.avatarPhoto[key];
      const sample = (text: unknown) => (typeof text === "function" ? (text as (n: number) => string)(5) : text);
      expect(sample(english), key).not.toBe(sample(french));
    }
  });
});
