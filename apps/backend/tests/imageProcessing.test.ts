import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ImageSourceError, downloadThumbnail, prepareImageForAnalysis } from "../src/lib/imageProcessing.js";

async function image(width: number, height: number, orientation?: number): Promise<Buffer> {
  const base = sharp({ create: { width, height, channels: 3, background: "#806040" } }).jpeg();
  return orientation ? base.withMetadata({ orientation }).toBuffer() : base.toBuffer();
}

describe("préparation de l'image analysée (recadrage côté serveur)", () => {
  it("découpe exactement la zone choisie, en proportions de l'image", async () => {
    const out = await prepareImageForAnalysis(await image(1000, 800), { x: 0.1, y: 0.25, width: 0.5, height: 0.5 });
    expect(await sharp(out).metadata()).toMatchObject({ width: 500, height: 400, format: "jpeg" });
  });

  it("redresse d'abord une photo d'iPhone (orientation EXIF) avant de recadrer", async () => {
    // Stockée en 600 × 400 mais marquée « tournée de 90° » : affichée en
    // 400 × 600. La zone « moitié haute » doit donc faire 400 × 300.
    const out = await prepareImageForAnalysis(await image(600, 400, 6), { x: 0, y: 0, width: 1, height: 0.5 });
    expect(await sharp(out).metadata()).toMatchObject({ width: 400, height: 300 });
  });

  it("limite l'image envoyée à 1 600 px sans l'agrandir", async () => {
    const big = await sharp(await prepareImageForAnalysis(await image(4000, 3000), null)).metadata();
    expect(Math.max(big.width!, big.height!)).toBe(1600);
    const small = await sharp(await prepareImageForAnalysis(await image(300, 200), null)).metadata();
    expect([small.width, small.height]).toEqual([300, 200]);
  });

  it("refuse un fichier qui n'est pas une image, et une zone de quelques pixels", async () => {
    await expect(prepareImageForAnalysis(Buffer.from("pas une image"), null)).rejects.toBeInstanceOf(ImageSourceError);
    await expect(
      prepareImageForAnalysis(await image(100, 100), { x: 0, y: 0, width: 0.1, height: 0.1 })
    ).rejects.toBeInstanceOf(ImageSourceError);
  });

  it("ne télécharge jamais une vignette hors de la liste blanche d'hébergeurs", async () => {
    await expect(downloadThumbnail("https://exemple-malveillant.com/image.jpg")).rejects.toThrow("hôte non autorisé");
    await expect(downloadThumbnail("http://p16-common-sign.tiktokcdn-eu.com/image.jpg")).rejects.toThrow("schéma non autorisé");
  });
});
