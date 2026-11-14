import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { BRAND } from "../src/lib/brand.js";
import { ImageSourceError } from "../src/lib/imageProcessing.js";
import { AI_DIGITAL_SOURCE_TYPE, BAND_FONT_FAMILY, BAND_FONT_FILE, addAiBand, aiBandText, bandHeightFor, escapePangoMarkup } from "../src/lib/tryon/band.js";
import { TRYON_IMAGE_MAX_SIDE, TRYON_PHOTO_MAX_BYTES, jpegDataUri, prepareGarmentImage, prepareTryonPhoto } from "../src/lib/tryon/images.js";

// Essayage virtuel : la photo du membre (formats, métadonnées retirées,
// taille), l'image de la pièce, et le bandeau « Image générée par IA »
// (police du dépôt, texte dans la langue de l'app, métadonnée IPTC). Tout en
// mémoire : aucune image n'est écrite sur le disque.

const flat = (width: number, height: number, background = "#a08060") => sharp({ create: { width, height, channels: 3, background } });

/** Une photo de téléphone avec EXIF (auteur, copyright, position GPS), XMP et profil ICC. */
async function phonePhoto(options: { width?: number; height?: number; orientation?: number } = {}): Promise<Buffer> {
  return flat(options.width ?? 600, options.height ?? 400)
    .withExif({
      IFD0: { Artist: "Camille Secret", Copyright: "SECRET-COPYRIGHT", Make: "Apple", Model: "iPhone 17" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 2400/100", GPSLongitudeRef: "E", GPSLongitude: "2/1 21/1 0/1" },
    })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>XMP-SECRET</dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>')
    .withIccProfile("p3")
    .withMetadata(options.orientation ? { orientation: options.orientation } : {})
    .jpeg()
    .toBuffer();
}

async function rejection(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ImageSourceError);
    return (error as Error).message;
  }
  return "acceptée";
}

describe("photo du membre : en mémoire, ré-encodée, sans aucune métadonnée", () => {
  it("EXIF (dont la position GPS), XMP et profil ICC disparaissent ; le JPEG reste lisible", async () => {
    const source = await phonePhoto();
    const before = await sharp(source).metadata();
    expect([Boolean(before.exif), Boolean(before.xmp), Boolean(before.icc)]).toEqual([true, true, true]);
    expect(source.includes("SECRET-COPYRIGHT")).toBe(true);

    const prepared = await prepareTryonPhoto(source);
    const after = await sharp(prepared).metadata();
    expect(after.format).toBe("jpeg");
    expect([after.exif, after.xmp, after.icc, after.iptc]).toEqual([undefined, undefined, undefined, undefined]);
    for (const secret of ["SECRET-COPYRIGHT", "Camille Secret", "XMP-SECRET", "iPhone 17", "GPS"]) expect(prepared.includes(secret), secret).toBe(false);
  });

  it("l'orientation de la photo est appliquée avant que l'EXIF ne disparaisse (photo verticale d'iPhone)", async () => {
    const prepared = await prepareTryonPhoto(await phonePhoto({ width: 600, height: 400, orientation: 6 }));
    const { width, height, orientation } = await sharp(prepared).metadata();
    expect([width, height]).toEqual([400, 600]);
    expect(orientation).toBeUndefined();
  });

  it("1 296 px au plus sur le grand côté, jamais agrandie", async () => {
    const big = await prepareTryonPhoto(await flat(3024, 4032).jpeg().toBuffer());
    expect(await sharp(big).metadata()).toMatchObject({ width: 972, height: TRYON_IMAGE_MAX_SIDE });
    const small = await prepareTryonPhoto(await flat(300, 500).png().toBuffer());
    expect(await sharp(small).metadata()).toMatchObject({ format: "jpeg", width: 300, height: 500 });
  });

  it("JPEG, PNG et WebP acceptés ; GIF, AVIF, TIFF, SVG et fichier vide refusés (type réel, jamais celui annoncé)", async () => {
    for (const image of [await flat(64, 64).jpeg().toBuffer(), await flat(64, 64).png().toBuffer(), await flat(64, 64).webp().toBuffer()]) {
      expect((await sharp(await prepareTryonPhoto(image)).metadata()).format).toBe("jpeg");
    }
    for (const image of [await flat(64, 64).gif().toBuffer(), await flat(64, 64).avif().toBuffer(), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.alloc(0)]) {
      expect(await rejection(() => prepareTryonPhoto(image))).not.toBe("acceptée");
    }
  });

  it("plus de 10 Mo : refusée sans être lue", async () => {
    const huge = Buffer.concat([await flat(64, 64).jpeg().toBuffer(), Buffer.alloc(TRYON_PHOTO_MAX_BYTES)]);
    expect(await rejection(() => prepareTryonPhoto(huge))).toBe("Image illisible");
  });

  it("une photo PNG transparente devient un JPEG sur fond blanc (jamais noir)", async () => {
    const transparent = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const { data } = await sharp(await prepareTryonPhoto(transparent)).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)].every((value) => value > 245)).toBe(true);
  });

  it("image d'une pièce téléchargée : les cinq formats permis, même traitement", async () => {
    for (const image of [await flat(64, 64).gif().toBuffer(), await flat(64, 64).avif().toBuffer(), await phonePhoto()]) {
      const prepared = await prepareGarmentImage(image);
      const metadata = await sharp(prepared).metadata();
      expect(metadata.format).toBe("jpeg");
      expect(metadata.exif).toBeUndefined();
    }
    expect(jpegDataUri(Buffer.from([1, 2, 3]))).toBe("data:image/jpeg;base64,AQID");
  });
});

describe("bandeau « Image générée par IA » et métadonnée IPTC", () => {
  it("texte dans la langue de l'app, avec le nom de l'app (lib/brand.ts)", () => {
    expect(aiBandText("fr")).toBe(`Image générée par IA · ${BRAND}`);
    expect(aiBandText("en")).toBe(`AI-generated image · ${BRAND}`);
  });

  it("le balisage de Pango est échappé (un nom ou un texte ne devient jamais du balisage)", () => {
    expect(escapePangoMarkup(`<b>Nom</b> & "Cie" l'été`)).toBe("&lt;b&gt;Nom&lt;/b&gt; &amp; &quot;Cie&quot; l&#39;été");
  });

  it("incrusté en bas : mêmes dimensions, le haut intact, le bas couvert par un bandeau sombre", async () => {
    const source = await flat(864, 1296, "#e8e0d0").jpeg().toBuffer();
    const banded = await addAiBand(source, "fr");
    const { data, info } = await sharp(banded).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([864, 1296]);
    const luminance = (x: number, y: number) => {
      const index = (y * info.width + x) * info.channels;
      return (data[index]! + data[index + 1]! + data[index + 2]!) / 3;
    };
    expect(luminance(10, 10)).toBeGreaterThan(200);
    const band = bandHeightFor(1296);
    expect(band).toBe(71);
    // Coin du bandeau (sans texte) : sombre.
    expect(luminance(4, 1296 - Math.floor(band / 2))).toBeLessThan(90);
    // Au milieu du bandeau, le texte blanc : des pixels clairs.
    let light = 0;
    for (let x = 200; x < 664; x += 1) if (luminance(x, 1296 - Math.floor(band / 2)) > 180) light += 1;
    expect(light).toBeGreaterThan(20);
  });

  it("JPEG sans EXIF, avec la métadonnée IPTC « trainedAlgorithmicMedia » en XMP", async () => {
    const banded = await addAiBand(await phonePhoto(), "en");
    const metadata = await sharp(banded).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.exif).toBeUndefined();
    const xmp = metadata.xmp?.toString("utf8") ?? "";
    expect(xmp).toContain(`<Iptc4xmpExt:DigitalSourceType>${AI_DIGITAL_SOURCE_TYPE}</Iptc4xmpExt:DigitalSourceType>`);
    expect(AI_DIGITAL_SOURCE_TYPE).toBe("http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia");
    expect(xmp).not.toContain("XMP-SECRET");
    expect(banded.includes("SECRET-COPYRIGHT")).toBe(false);
  });

  it("les deux langues donnent deux bandeaux différents ; une image étroite garde un bandeau lisible", async () => {
    const source = await flat(864, 1296).jpeg().toBuffer();
    const [fr, en] = await Promise.all([addAiBand(source, "fr"), addAiBand(source, "en")]);
    expect(fr.equals(en)).toBe(false);
    const narrow = await addAiBand(await flat(120, 900).jpeg().toBuffer(), "fr");
    expect(await sharp(narrow).metadata()).toMatchObject({ width: 120, height: 900 });
    const tiny = await addAiBand(await flat(30, 20).png().toBuffer(), "fr");
    expect(await sharp(tiny).metadata()).toMatchObject({ width: 30, height: 20 });
  });

  it("seule une image JPEG ou PNG rendue par le fournisseur est acceptée", async () => {
    expect(await rejection(() => addAiBand(Buffer.from("<svg/>"), "fr"))).toBe("Format non accepté");
    const webp = await flat(64, 64).webp().toBuffer();
    expect(await rejection(() => addAiBand(webp, "fr"))).toBe("Format non accepté");
  });
});

describe("police du bandeau : un fichier du dépôt, sous licence libre, indépendant des polices du serveur", () => {
  const fontsDir = dirname(BAND_FONT_FILE);

  it("le fichier de police et sa licence SIL OFL 1.1 sont dans le dépôt", () => {
    expect(existsSync(BAND_FONT_FILE)).toBe(true);
    const license = readFileSync(join(fontsDir, "OFL.txt"), "utf8");
    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(license).toContain("Copyright 2020 The Newsreader Project Authors");
    expect(createHash("sha256").update(readFileSync(BAND_FONT_FILE)).digest("hex")).toBe("64dadba9c887b4c871dfdc7d3146ae1e288cc26940baeacf9a313a30fd06e2d9");
    expect(readFileSync(join(fontsDir, "LISEZ-MOI.md"), "utf8")).toContain("64dadba9c887b4c871dfdc7d3146ae1e288cc26940baeacf9a313a30fd06e2d9");
  });

  it("le texte se dessine avec la police du dépôt quand le serveur n'a AUCUNE police installée", () => {
    // Chaque rendu dans son propre processus (une police chargée reste connue
    // du processus) ; une configuration de polices vide : aucun dossier de
    // polices, seule la police du dépôt peut servir.
    const workdir = mkdtempSync(join(tmpdir(), "polices-vides-"));
    try {
      const config = join(workdir, "fonts.conf");
      writeFileSync(config, `<?xml version="1.0"?>\n<fontconfig><cachedir>${join(workdir, "cache")}</cachedir></fontconfig>\n`);
      const sharpPath = createRequire(import.meta.url).resolve("sharp");
      const render = (fontfile: string | null, env: NodeJS.ProcessEnv): { width: number; height: number; ink: number } => {
        const script = `
          const sharp = require(${JSON.stringify(sharpPath)});
          const options = { text: ${JSON.stringify(`<span foreground="#FFFFFF">${aiBandText("fr")}</span>`)}, font: ${JSON.stringify(`${BAND_FONT_FAMILY} 28`)}, rgba: true, dpi: 72 };
          ${fontfile ? `options.fontfile = ${JSON.stringify(fontfile)};` : ""}
          sharp({ text: options }).raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => {
            let ink = 0;
            for (let i = 3; i < data.length; i += 4) if (data[i] > 128) ink += 1;
            process.stdout.write(JSON.stringify({ width: info.width, height: info.height, ink }));
          });
        `;
        const result = spawnSync(process.execPath, ["-e", script], { env, encoding: "utf8", timeout: 30_000 });
        expect(result.status, result.stderr).toBe(0);
        return JSON.parse(result.stdout) as { width: number; height: number; ink: number };
      };
      const empty = { ...process.env, FONTCONFIG_FILE: config };
      const withoutSystemFonts = render(BAND_FONT_FILE, empty);
      const usual = render(BAND_FONT_FILE, { ...process.env });
      const controlWithoutAnyFont = render(null, empty);
      // Avec la police du dépôt : le même texte, aux mêmes dimensions, qu'il y
      // ait ou non des polices sur le serveur (seul le lissage peut varier).
      expect(Math.abs(withoutSystemFonts.width - usual.width)).toBeLessThanOrEqual(3);
      expect(Math.abs(withoutSystemFonts.height - usual.height)).toBeLessThanOrEqual(2);
      expect(withoutSystemFonts.ink).toBeGreaterThan(usual.ink * 0.85);
      expect(withoutSystemFonts.ink).toBeLessThan(usual.ink * 1.15);
      // Contre-épreuve : sans le fichier, dans cet environnement, aucune
      // police : Pango ne dessine que des cases de remplacement, bien plus petites.
      // Seulement sous Linux (le serveur chez Render, la vérification de GitHub) :
      // sur macOS, Pango trouve les polices par le système (CoreText) et ignore
      // FONTCONFIG_FILE, la contre-épreuve n'y prouverait rien.
      if (process.platform === "linux") {
        expect(controlWithoutAnyFont.height).toBeLessThan(withoutSystemFonts.height * 0.6);
        expect(Math.abs(controlWithoutAnyFont.width - withoutSystemFonts.width)).toBeGreaterThan(30);
      }
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
