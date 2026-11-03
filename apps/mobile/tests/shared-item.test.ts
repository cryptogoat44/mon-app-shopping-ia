import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveLocale } from "../src/i18n";
import { detectLink } from "../src/lib/link-detection";
import {
  classifySharedItem,
  isShareOpeningUrl,
  normalizeSharedLink,
  peekSharedItem,
  receiveSharedItem,
  sharedRefusalMessage,
  subscribeSharedItem,
  takeSharedItem,
  type SharedItem,
} from "../src/lib/shared-item";
import { redirectSystemPath } from "../src/app/+native-intent";

// Lot « partager vers Spotto » : ce que la feuille de partage d'iOS remet à
// Spotto (forme du module expo-share-intent), classé avant d'être ouvert.
const GROUP = "file:///private/var/mobile/Containers/Shared/AppGroup/0D1E2F/";

function file(name: string, mimeType: string | null, extra: Partial<Record<"width" | "height" | "size" | "duration", number>> = {}) {
  return { path: `${GROUP}${name}`, mimeType, fileName: name, width: null, height: null, size: null, duration: null, ...extra };
}

describe("classement de l'élément partagé", () => {
  it("lien partagé par TikTok, Instagram, Pinterest ou Safari : un lien", () => {
    expect(classifySharedItem({ files: null, webUrl: "https://vm.tiktok.com/ZMabc123/", text: "https://vm.tiktok.com/ZMabc123/" })).toEqual({
      kind: "link",
      text: "https://vm.tiktok.com/ZMabc123/",
    });
    expect(classifySharedItem({ files: null, webUrl: "https://www.zara.com/fr/veste-p1.html", text: null })).toEqual({ kind: "link", text: "https://www.zara.com/fr/veste-p1.html" });
  });

  it("phrase de partage avec un lien dedans : le lien seul", () => {
    expect(classifySharedItem({ files: null, webUrl: null, text: "Regarde cette vidéo ! https://vm.tiktok.com/ZMabc123/ #fyp" })).toEqual({
      kind: "link",
      text: "https://vm.tiktok.com/ZMabc123/",
    });
  });

  it("capture d'écran ou photo : une image, avec sa taille quand elle est connue", () => {
    expect(classifySharedItem({ files: [file("A1B2.PNG", "image/png", { width: 1179, height: 2556, size: 812_000 })] })).toEqual({
      kind: "image",
      uri: `${GROUP}A1B2.PNG`,
      width: 1179,
      height: 2556,
    });
    expect(classifySharedItem({ files: [file("IMG_0001.HEIC", "image/heic")] })).toEqual({ kind: "image", uri: `${GROUP}IMG_0001.HEIC`, width: null, height: null });
  });

  it("vidéo (enregistrement d'écran, vidéo de Photos) : une vidéo, avec son poids", () => {
    expect(classifySharedItem({ files: [file("C3D4.MOV", "video/quicktime", { size: 24_000_000, duration: 12_000, width: 886, height: 1920 })] })).toEqual({
      kind: "video",
      uri: `${GROUP}C3D4.MOV`,
      sizeBytes: 24_000_000,
    });
  });

  it("type absent ou générique : l'extension du nom tranche", () => {
    expect(classifySharedItem({ files: [file("E5.mp4", "application/octet-stream")] })).toMatchObject({ kind: "video" });
    expect(classifySharedItem({ files: [file("F6.jpeg", null)] })).toMatchObject({ kind: "image" });
  });

  it("chemin sans « file:// » complété ; adresse non locale refusée", () => {
    expect(classifySharedItem({ files: [{ path: "/private/var/mobile/Containers/Shared/AppGroup/0D1E2F/G7.png", mimeType: "image/png" }] })).toMatchObject({
      kind: "image",
      uri: "file:///private/var/mobile/Containers/Shared/AppGroup/0D1E2F/G7.png",
    });
    expect(classifySharedItem({ files: [{ path: "ph://ED7AC36B/L0/001", mimeType: "image/jpeg" }] })).toEqual({ kind: "refused", reason: "unreadable" });
  });

  it("fichier quelconque, texte sans lien : non pris en charge", () => {
    expect(classifySharedItem({ files: [file("contrat.pdf", "application/pdf")] })).toEqual({ kind: "refused", reason: "unsupported" });
    expect(classifySharedItem({ files: null, webUrl: null, text: "veste en daim marron" })).toEqual({ kind: "refused", reason: "unsupported" });
  });

  it("plusieurs éléments à la fois : refusés, un seul s'ouvre", () => {
    expect(classifySharedItem({ files: [file("A.PNG", "image/png"), file("B.MOV", "video/quicktime")] })).toEqual({ kind: "refused", reason: "several" });
  });

  it("partage vide ou illisible : on le dit", () => {
    expect(classifySharedItem(null)).toEqual({ kind: "refused", reason: "unreadable" });
    expect(classifySharedItem({ files: [], webUrl: null, text: "  " })).toEqual({ kind: "refused", reason: "unreadable" });
    expect(classifySharedItem({ files: [{ path: "", mimeType: "image/png" }] })).toEqual({ kind: "refused", reason: "unreadable" });
  });
});

describe("normalisation du lien partagé", () => {
  it.each([
    ["  https://vm.tiktok.com/ZMabc123/  ", "https://vm.tiktok.com/ZMabc123/"],
    ["Regarde ce reel ! https://www.instagram.com/reel/Cxyz/?igsh=abc.", "https://www.instagram.com/reel/Cxyz/?igsh=abc"],
    ["pin.it/4xYz", "https://pin.it/4xYz"],
    ["http://www.pinterest.fr/pin/123/", "http://www.pinterest.fr/pin/123/"],
  ])("« %s » → %s", (text, url) => {
    expect(normalizeSharedLink(text)).toBe(url);
  });

  it.each([[""], ["veste marron"], ["javascript:alert(1)"], ["file:///var/mobile/x.png"], [`https://exemple.fr/${"a".repeat(2100)}`]])("« %s » : aucun lien", (text) => {
    expect(normalizeSharedLink(text)).toBeNull();
  });

  it("le lien transmis à part passe avant celui du texte", () => {
    expect(classifySharedItem({ webUrl: "https://pin.it/1", text: "Vu sur https://exemple.fr" })).toEqual({ kind: "link", text: "https://pin.it/1" });
  });

  it("même lecture que le champ de lien : même lien, même plateforme", () => {
    for (const text of ["Regarde ! https://vm.tiktok.com/ZMabc123/ #fyp", "https://www.instagram.com/reel/abc/", "pin.it/4xYz", "https://www.tiktok.com/@mayela"]) {
      expect(detectLink(normalizeSharedLink(text)!)).toEqual(detectLink(text));
    }
  });
});

describe("mise en attente jusqu'à la connexion", () => {
  beforeEach(() => {
    takeSharedItem();
  });

  it("pas connecté : l'élément attend, intact ; connecté : le Spotter le prend une seule fois", () => {
    const item: SharedItem = { kind: "link", text: "https://vm.tiktok.com/ZMabc123/" };
    receiveSharedItem(item);
    // Aucun écran du Spotter n'existe avant la connexion : rien ne le prend.
    expect(peekSharedItem()).toEqual(item);
    expect(peekSharedItem()).toEqual(item);
    expect(takeSharedItem()).toEqual(item);
    expect(takeSharedItem()).toBeNull();
    expect(peekSharedItem()).toBeNull();
  });

  it("un nouveau partage remplace celui qui attendait, rendu pour effacer sa copie", () => {
    const video: SharedItem = { kind: "video", uri: "file:///cache/A.MOV", sizeBytes: 1_000 };
    const image: SharedItem = { kind: "image", uri: "file:///cache/B.PNG", width: 10, height: 20 };
    expect(receiveSharedItem(video)).toBeNull();
    expect(receiveSharedItem(image)).toEqual(video);
    expect(takeSharedItem()).toEqual(image);
  });

  it("les écrans abonnés sont prévenus à l'arrivée et au retrait, plus après désabonnement", () => {
    const listener = vi.fn();
    const stop = subscribeSharedItem(listener);
    receiveSharedItem({ kind: "refused", reason: "several" });
    takeSharedItem();
    takeSharedItem();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    receiveSharedItem({ kind: "refused", reason: "several" });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("élément non pris en charge : message clair, en français et en anglais", () => {
  it("un message différent par cas, jamais vide", () => {
    for (const locale of ["fr", "en"] as const) {
      setActiveLocale(locale);
      const messages = (["several", "unsupported", "unreadable"] as const).map(sharedRefusalMessage);
      expect(new Set(messages).size).toBe(3);
      for (const message of messages) expect(message.length).toBeGreaterThan(20);
    }
    setActiveLocale("fr");
  });
});

describe("ouverture de l'app par l'extension de partage", () => {
  it("l'adresse de l'extension ne mène à aucun écran : démarrage à l'accueil, ou on reste où l'on est", () => {
    for (const fragment of ["media", "weburl", "text", "file"]) {
      const url = `spotto://dataUrl=spottoShareKey?nonce=4F1C#${fragment}`;
      expect(isShareOpeningUrl(url)).toBe(true);
      expect(redirectSystemPath({ path: url, initial: true })).toBe("/");
      expect(redirectSystemPath({ path: url, initial: false })).toBeNull();
    }
    for (const path of ["spotto:///", "spotto://nouveau-mot-de-passe", "https://mon-app-shopping-ia-web.onrender.com/spot"]) {
      expect(isShareOpeningUrl(path)).toBe(false);
      expect(redirectSystemPath({ path, initial: true })).toBe(path);
    }
  });
});
