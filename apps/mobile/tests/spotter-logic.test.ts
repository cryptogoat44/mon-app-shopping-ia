import { describe, expect, it } from "vitest";
import { detectLink, extractUrl } from "../src/lib/link-detection";
import { containBox, cropToBox, croppedView } from "../src/lib/crop-geometry";

describe("reconnaissance du lien", () => {
  it("extrait le lien d'un texte de partage TikTok", () => {
    expect(extractUrl("Regarde cette vidéo ! https://vm.tiktok.com/ZMabc123/ #fyp")).toBe("https://vm.tiktok.com/ZMabc123/");
  });

  it("ajoute https:// à un lien tapé sans", () => {
    expect(extractUrl("pin.it/4xYz")).toBe("https://pin.it/4xYz");
  });

  it.each([
    ["https://www.tiktok.com/@x/video/1", "tiktok"],
    ["https://vm.tiktok.com/ZMabc/", "tiktok"],
    ["https://www.instagram.com/reel/abc/", "instagram"],
    ["https://pin.it/4xYz", "pinterest"],
    ["https://fr.pinterest.com/pin/123/", "pinterest"],
    ["https://www.pinterest.fr/pin/123/", "pinterest"],
  ])("reconnaît %s comme %s", (text, platform) => {
    expect(detectLink(text)).toMatchObject({ kind: "supported", platform });
  });

  it("ne confond pas un domaine qui contient le nom d'une plateforme", () => {
    expect(detectLink("https://tiktok.com.exemple-malveillant.com/video")).toMatchObject({ kind: "unsupported" });
  });

  it("distingue vide, pas un lien, et lien non pris en charge", () => {
    expect(detectLink("   ")).toEqual({ kind: "empty" });
    expect(detectLink("veste marron")).toEqual({ kind: "not_a_link" });
    expect(detectLink("https://www.zara.com/fr/veste")).toMatchObject({ kind: "unsupported" });
  });

  it.each([
    ["https://www.tiktok.com/", "tiktok"],
    ["https://www.tiktok.com/@mayelasjourney", "tiktok"],
    ["https://www.tiktok.com/tag/outfit", "tiktok"],
    ["https://www.instagram.com/", "instagram"],
    ["https://www.instagram.com/zara/", "instagram"],
    ["https://fr.pinterest.com/", "pinterest"],
    ["https://fr.pinterest.com/marie/tenues-automne/", "pinterest"],
  ])("repère %s comme un lien %s qui ne mène pas à un contenu", (text, platform) => {
    expect(detectLink(text)).toMatchObject({ kind: "not_a_video", platform });
  });

  it.each([
    "https://www.tiktok.com/t/ZT8abc/",
    "https://vt.tiktok.com/ZSabc/",
    "https://m.tiktok.com/v/7554393000504266014.html",
    "https://www.tiktok.com/@x/photo/7554393000504266014",
    "https://www.instagram.com/p/C1abc/",
    "https://www.instagram.com/reels/C1abc/",
  ])("accepte le format de contenu %s", (text) => {
    expect(detectLink(text)).toMatchObject({ kind: "supported" });
  });
});

// Le tracé « Entourez la pièce » (zone, marge, bornes, taille minimale) : tests/piece-trace.test.ts.
describe("géométrie de la zone", () => {
  it("place une image verticale entière, centrée, dans son cadre", () => {
    expect(containBox({ width: 300, height: 300 }, { width: 600, height: 1200 })).toEqual({ left: 75, top: 0, width: 150, height: 300 });
  });

  it("convertit la zone en points écran", () => {
    expect(cropToBox({ x: 0.5, y: 0.25, width: 0.5, height: 0.5 }, { left: 10, top: 20, width: 200, height: 400 })).toEqual({
      left: 110,
      top: 120,
      width: 100,
      height: 200,
    });
  });

  it("affiche seulement la zone choisie dans un cadre donné", () => {
    const view = croppedView({ width: 1000, height: 2000 }, { x: 0.1, y: 0.5, width: 0.5, height: 0.25 }, 300, 1000);
    // Zone : 500 × 500 px → cadre carré 300 × 300, image entière à l'échelle 0,6.
    expect(view.frame).toEqual({ width: 300, height: 300 });
    expect(view.image).toMatchObject({ width: 600, height: 1200, left: -60, top: -600 });
  });

  it("respecte la hauteur maximale du cadre", () => {
    const view = croppedView({ width: 1000, height: 1000 }, { x: 0, y: 0, width: 0.2, height: 1 }, 300, 400);
    expect(view.frame.height).toBe(400);
    expect(view.frame.width).toBeCloseTo(80);
  });
});

describe("partage d'une proposition", () => {
  it("le lien partagé est toujours accompagné de la mention « lien affilié »", async () => {
    const { fr } = await import("../src/i18n/fr");
    const message = fr.result.shareMessage("Veste en daim", "https://marchand.example/veste");
    expect(message).toContain("https://marchand.example/veste (lien affilié)");
  });
});
