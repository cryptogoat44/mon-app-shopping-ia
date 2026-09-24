import { describe, expect, it } from "vitest";
import { detectLink, extractUrl } from "../src/lib/link-detection";
import { MIN_CROP, containBox, cropToBox, croppedView, moveCrop, resizeCrop, scaleCrop } from "../src/lib/crop-geometry";

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
});

describe("géométrie du recadrage", () => {
  it("place une image verticale entière, centrée, dans son cadre", () => {
    expect(containBox({ width: 300, height: 300 }, { width: 600, height: 1200 })).toEqual({ left: 75, top: 0, width: 150, height: 300 });
  });

  it("déplace le cadre sans jamais sortir de l'image", () => {
    expect(moveCrop({ x: 0.5, y: 0.5, width: 0.4, height: 0.4 }, 0.5, -0.9)).toEqual({ x: 0.6, y: 0, width: 0.4, height: 0.4 });
  });

  it("agrandit par un coin en gardant le coin opposé fixe, jusqu'au bord", () => {
    const out = resizeCrop({ x: 0.2, y: 0.2, width: 0.4, height: 0.4 }, "bottomRight", 0.9, 0.1);
    expect(out.x).toBe(0.2);
    expect(out.y).toBe(0.2);
    expect(out.width).toBeCloseTo(0.8);
    expect(out.height).toBeCloseTo(0.5);
  });

  it("ne descend jamais sous la taille minimale", () => {
    const out = resizeCrop({ x: 0.2, y: 0.2, width: 0.4, height: 0.4 }, "topLeft", 0.9, 0.9);
    expect(out.width).toBeCloseTo(MIN_CROP);
    expect(out.height).toBeCloseTo(MIN_CROP);
    expect(out.x + out.width).toBeCloseTo(0.6);
  });

  it("convertit le cadre en points écran", () => {
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

  it("agrandit ou réduit le cadre autour de son centre (VoiceOver), sans sortir de l'image", () => {
    const grown = scaleCrop({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, 2);
    expect(grown.width).toBeCloseTo(0.4);
    expect(grown.x).toBeCloseTo(0.3);
    const huge = scaleCrop({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, 2);
    expect(huge).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});
