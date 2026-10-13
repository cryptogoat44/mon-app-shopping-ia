import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ImageSourceError } from "../src/lib/imageProcessing.js";
import { encodeSharedCopy, measureSharedSource, optimizePhoto, PHOTO_SIZES } from "../src/lib/photos.js";

// Lot 5, 5.C : copie de l'image d'une envie partagée (republiée ou envoyée).
// Souvent une petite vignette déjà compressée : la copie ne doit ni
// l'agrandir, ni la dégrader visiblement, ni la noircir (transparence), et
// sa miniature ne doit jamais être moins bonne que la copie d'affichage.
// Images fabriquées en mémoire : aucun appel réseau.

async function image(width: number, height: number, orientation?: number): Promise<Buffer> {
  const base = sharp({ create: { width, height, channels: 3, background: "#806040" } }).jpeg();
  return orientation ? base.withMetadata({ orientation }).toBuffer() : base.toBuffer();
}

/** Une « vignette » de 180 × 280 px avec du détail (dégradés et grain), déjà
 * compressée en JPEG qualité 75 comme celles de Google. Tirage fixe : le
 * même fichier à chaque essai. */
async function detailedThumbnail(): Promise<Buffer> {
  const width = 180;
  const height = 280;
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      pixels[i] = Math.round(128 + 60 * Math.sin(x / 9) + 40 * (random() - 0.5));
      pixels[i + 1] = Math.round(110 + 50 * Math.cos(y / 11) + 40 * (random() - 0.5));
      pixels[i + 2] = Math.round(100 + 40 * Math.sin((x + y) / 13) + 40 * (random() - 0.5));
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 75 }).toBuffer();
}

/** Écart entre deux images de même taille (PSNR, en dB : plus c'est haut,
 * plus elles sont proches ; au-delà de 45 dB, aucune différence visible). */
async function psnr(a: Buffer, b: Buffer): Promise<number> {
  const [left, right] = await Promise.all([a, b].map((input) => sharp(input).removeAlpha().raw().toBuffer()));
  expect(left!.length).toBe(right!.length);
  let sum = 0;
  for (let i = 0; i < left!.length; i++) {
    const delta = left![i]! - right![i]!;
    sum += delta * delta;
  }
  return 10 * Math.log10((255 * 255) / (sum / left!.length));
}

describe("copie de l'image d'une envie partagée", () => {
  it("petite source : gardée à sa taille, couleurs complètes (4:4:4), miniature identique à la copie", async () => {
    const copy = await encodeSharedCopy(await image(180, 280));
    expect([copy.width, copy.height]).toEqual([180, 280]);
    expect(await sharp(copy.display).metadata()).toMatchObject({ format: "jpeg", width: 180, height: 280, chromaSubsampling: "4:4:4" });
    expect(copy.thumb.equals(copy.display)).toBe(true);
  });

  it("grande source : réduite à 1 600 px (4:2:0, poids du fil), miniature de 480 px", async () => {
    const copy = await encodeSharedCopy(await image(3000, 4000));
    expect([copy.width, copy.height]).toEqual([1200, 1600]);
    expect(await sharp(copy.display).metadata()).toMatchObject({ width: 1200, height: 1600, chromaSubsampling: "4:2:0" });
    expect(await sharp(copy.thumb).metadata()).toMatchObject({ width: 360, height: 480 });
  });

  it("source moyenne (entre 480 et 800 px) : copie à sa taille en 4:4:4, miniature distincte de 480 px", async () => {
    const copy = await encodeSharedCopy(await image(600, 750));
    expect(await sharp(copy.display).metadata()).toMatchObject({ width: 600, height: 750, chromaSubsampling: "4:4:4" });
    expect(await sharp(copy.thumb).metadata()).toMatchObject({ width: 384, height: 480 });
  });

  it("PNG détouré (fond transparent) : fond blanc, jamais noir", async () => {
    const square = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#c03020" } }).png().toBuffer();
    const png = await sharp({ create: { width: 60, height: 60, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
      .composite([{ input: square, left: 20, top: 20 }])
      .png()
      .toBuffer();
    const copy = await encodeSharedCopy(png);
    const { data, info } = await sharp(copy.display).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    // Coin (transparent à l'origine) : blanc. Centre : le carré rouge.
    for (const value of data.subarray(0, 3)) expect(value).toBeGreaterThanOrEqual(250);
    const center = (30 * info.width + 30) * 3;
    expect(data[center]).toBeGreaterThan(150);
    expect(data[center + 1]).toBeLessThan(100);
  });

  it("photo marquée « tournée de 90° » (orientation EXIF 6) : redressée, sans métadonnées", async () => {
    const copy = await encodeSharedCopy(await image(600, 400, 6));
    expect([copy.width, copy.height]).toEqual([400, 600]);
    const meta = await sharp(copy.display).metadata();
    expect([meta.width, meta.height]).toEqual([400, 600]);
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
    // La miniature (480 px, distincte ici) est redressée aussi.
    expect(await sharp(copy.thumb).metadata()).toMatchObject({ width: 320, height: 480 });
  });

  it("refuse un SVG (jamais dessiné par le serveur), un fichier qui n'est pas une image et une image de plus de 40 mégapixels", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#c03020"/></svg>');
    const huge = await image(7000, 6000); // 42 mégapixels (fichier léger : une seule couleur)
    for (const input of [svg, Buffer.from("<html>pas une image</html>"), huge]) {
      await expect(encodeSharedCopy(input)).rejects.toBeInstanceOf(ImageSourceError);
      await expect(measureSharedSource(input)).rejects.toBeInstanceOf(ImageSourceError);
    }
  });

  it("fichier tronqué : l'en-tête se lit (dimensions), mais la copie est refusée", async () => {
    const full = await sharp({ create: { width: 400, height: 500, channels: 3, background: "#000", noise: { type: "gaussian", mean: 128, sigma: 40 } } }).jpeg().toBuffer();
    const truncated = full.subarray(0, Math.floor(full.length / 2));
    await expect(measureSharedSource(truncated)).resolves.toEqual({ width: 400, height: 500 });
    await expect(encodeSharedCopy(truncated)).rejects.toBeInstanceOf(ImageSourceError);
  });

  it("petite source déjà compressée : la copie reste fidèle (45 dB au moins), mieux qu'une photo ré-encodée", async () => {
    const source = await detailedThumbnail();
    const copy = await encodeSharedCopy(source);
    const shared = await psnr(source, copy.display);
    expect(shared).toBeGreaterThanOrEqual(45);
    // Ancien traitement (celui des photos) : nettement moins fidèle.
    expect(shared).toBeGreaterThan(await psnr(source, await optimizePhoto(source, PHOTO_SIZES.display)));
  });
});
