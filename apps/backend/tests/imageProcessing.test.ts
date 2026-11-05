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

  // Lot garde-fous : une seule chaîne sharp (mémoire divisée par deux ou plus
  // sur une photo de 48 Mpx), le même résultat visible.
  it("photo d'iPhone tournée (EXIF 6 et 8) : la zone choisie est bien celle vue à l'écran", async () => {
    // 600 × 400 en quatre couleurs (rouge, vert / bleu, jaune), affichée tournée.
    const raw = Buffer.alloc(600 * 400 * 3);
    const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
    for (let y = 0; y < 400; y += 1) for (let x = 0; x < 600; x += 1) raw.set(colors[(y < 200 ? 0 : 2) + (x < 300 ? 0 : 1)]!, (y * 600 + x) * 3);
    const dominant = async (out: Buffer) => {
      const { channels } = await sharp(out).stats();
      return channels.slice(0, 3).map((c) => (c.mean > 128 ? 1 : 0)).join("");
    };
    for (const [orientation, topLeft] of [[6, "001"], [8, "010"]] as const) {
      const input = await sharp(raw, { raw: { width: 600, height: 400, channels: 3 } }).jpeg().withMetadata({ orientation }).toBuffer();
      // Le quart en haut à gauche de l'image affichée (400 × 600).
      const out = await prepareImageForAnalysis(input, { x: 0, y: 0, width: 0.5, height: 0.5 });
      expect(await sharp(out).metadata()).toMatchObject({ width: 200, height: 300, format: "jpeg" });
      expect(await dominant(out)).toBe(topLeft);
    }
  });

  it("une photo tronquée est une image illisible (400), jamais une erreur du serveur", async () => {
    const whole = await image(1200, 900);
    await expect(prepareImageForAnalysis(whole.subarray(0, Math.floor(whole.length / 2)), null)).rejects.toBeInstanceOf(ImageSourceError);
    await expect(prepareImageForAnalysis(whole.subarray(0, Math.floor(whole.length / 2)), { x: 0.1, y: 0.1, width: 0.5, height: 0.5 })).rejects.toBeInstanceOf(ImageSourceError);
  });

  it("ne télécharge jamais une vignette hors de la liste blanche d'hébergeurs", async () => {
    await expect(downloadThumbnail("https://exemple-malveillant.com/image.jpg")).rejects.toThrow("hôte non autorisé");
    await expect(downloadThumbnail("http://p16-common-sign.tiktokcdn-eu.com/image.jpg")).rejects.toThrow("schéma non autorisé");
  });
});
