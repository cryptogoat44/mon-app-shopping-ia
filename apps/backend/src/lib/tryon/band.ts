// Bandeau visible « Image générée par IA · <nom de l'app> » (« AI-generated
// image · … » en anglais), incrusté en bas de chaque image d'essayage avant
// qu'elle ne quitte le serveur, et métadonnée IPTC « DigitalSourceType =
// trainedAlgorithmicMedia », écrite en XMP (la place prévue par la norme
// IPTC pour les images produites par une IA). Le nom vient de lib/brand.ts :
// le bandeau suit un changement de nom.
// La police est un fichier du dépôt (Newsreader Medium, licence SIL OFL 1.1,
// assets/fonts/) : le rendu ne dépend d'aucune police installée sur le
// serveur. Le texte passe par le moteur Pango de sharp, qui lit un balisage :
// tout texte inséré est échappé.
// En mémoire seulement : l'image n'est jamais écrite nulle part.
import { fileURLToPath } from "node:url";
import sharp, { type Metadata } from "sharp";
import { BRAND } from "../brand.js";
import { ImageSourceError } from "../imageProcessing.js";
import { IMAGE_TOO_HEAVY, ImageQueueFullError, MAX_INPUT_PIXELS, imageFormatOf, isTooHeavyToDecode, oneImageAtATime, type ImageFormat } from "../imageSafety.js";
import type { Locale } from "../locale.js";

/** Chemin absolu de la police du bandeau (même place depuis src/ et dist/). */
export const BAND_FONT_FILE = fileURLToPath(new URL("../../../assets/fonts/Newsreader_500Medium.ttf", import.meta.url));
/** Nom de la police dans le fichier (famille et graisse). */
export const BAND_FONT_FAMILY = "Newsreader Medium";

/** Métadonnée IPTC « image produite par une IA » (vocabulaire officiel de l'IPTC), en XMP. */
export const AI_DIGITAL_SOURCE_TYPE = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
export const AI_GENERATED_XMP = [
  '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
  '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
  '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
  '<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/">',
  `<Iptc4xmpExt:DigitalSourceType>${AI_DIGITAL_SOURCE_TYPE}</Iptc4xmpExt:DigitalSourceType>`,
  "</rdf:Description>",
  "</rdf:RDF>",
  "</x:xmpmeta>",
  '<?xpacket end="w"?>',
].join("");

/** Images acceptées en sortie d'un fournisseur. */
const RESULT_FORMATS: ReadonlySet<ImageFormat> = new Set<ImageFormat>(["jpeg", "png"]);
const JPEG_QUALITY = 90;

export interface BandStyle {
  placement: "top" | "bottom";
  /** Fond du bandeau (r, g, b de 0 à 255 ; opacité de 0 à 1). */
  background: { r: number; g: number; b: number; alpha: number };
}

/** Le bandeau de l'essayage : bas de l'image, fond sombre, texte blanc. */
export const AI_BAND_STYLE: BandStyle = { placement: "bottom", background: { r: 17, g: 17, b: 17, alpha: 0.78 } };

/** Texte du bandeau, dans la langue de l'app sur l'appareil. */
export function aiBandText(locale: Locale): string {
  return locale === "en" ? `AI-generated image · ${BRAND}` : `Image générée par IA · ${BRAND}`;
}

const PANGO_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Texte sûr pour le balisage de Pango (« <b> » reste du texte). */
export function escapePangoMarkup(text: string): string {
  return text.replace(/[&<>"']/g, (char) => PANGO_ESCAPES[char]!);
}

/** Hauteur du bandeau : 5,5 % de l'image, entre 28 et 120 px (jamais plus que l'image). */
export function bandHeightFor(imageHeight: number): number {
  return Math.min(imageHeight, Math.max(28, Math.min(120, Math.round(imageHeight * 0.055))));
}

interface RenderedText {
  data: Buffer;
  width: number;
  height: number;
}

async function renderText(text: string, fontSize: number): Promise<RenderedText> {
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="#FFFFFF">${escapePangoMarkup(text)}</span>`,
      font: `${BAND_FONT_FAMILY} ${fontSize}`,
      fontfile: BAND_FONT_FILE,
      rgba: true,
      dpi: 72,
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Le texte, à la taille qui tient dans le bandeau : réduit pour une image
 * étroite ; pour une toute petite image, le texte dessiné est réduit à son
 * tour (le bandeau reste toujours là). */
async function fittedText(text: string, width: number, bandHeight: number): Promise<RenderedText> {
  const padding = Math.max(4, Math.round(bandHeight * 0.25));
  const maxWidth = Math.max(1, width - 2 * padding);
  const maxHeight = Math.max(1, bandHeight - 2);
  const fits = (label: RenderedText) => label.width <= maxWidth && label.height <= maxHeight;
  const preferred = Math.max(4, Math.round(bandHeight * 0.42));
  const first = await renderText(text, preferred);
  if (fits(first)) return first;
  const scale = Math.min(maxWidth / first.width, maxHeight / first.height);
  const second = await renderText(text, Math.max(4, Math.floor(preferred * scale)));
  if (fits(second)) return second;
  const { data, info } = await sharp(second.data).resize({ width: maxWidth, height: maxHeight, fit: "inside" }).png().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Le bandeau (PNG avec transparence), à la largeur de l'image. */
async function renderBand(text: string, width: number, height: number, style: BandStyle): Promise<Buffer> {
  const bandHeight = bandHeightFor(height);
  const label = await fittedText(text, width, bandHeight);
  return sharp({ create: { width, height: bandHeight, channels: 4, background: style.background } })
    .composite([{ input: label.data, gravity: "centre" }])
    .png()
    .toBuffer();
}

function unreadable(error: unknown): Error {
  return error instanceof ImageQueueFullError ? error : new ImageSourceError("Image illisible");
}

/** Dimensions affichées (orientation appliquée) d'une image rendue par un
 * fournisseur, vérifiée avant tout décodage. */
async function checkedSize(image: Buffer): Promise<{ width: number; height: number }> {
  const format = imageFormatOf(image);
  if (!format || !RESULT_FORMATS.has(format)) throw new ImageSourceError("Format non accepté");
  let header: Metadata;
  try {
    header = await sharp(image, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new ImageSourceError("Image illisible");
  }
  if (isTooHeavyToDecode(header)) throw new ImageSourceError(IMAGE_TOO_HEAVY);
  const { width, height } = header.autoOrient;
  if (!width || !height) throw new ImageSourceError("Image illisible");
  return { width, height };
}

/** L'image avec un bandeau `text` (en haut ou en bas), en JPEG, sans aucune
 * métadonnée héritée ; `xmp` : métadonnée XMP à écrire, s'il y en a une. */
export async function drawBand(image: Buffer, text: string, style: BandStyle, xmp?: string): Promise<Buffer> {
  const { width, height } = await checkedSize(image);
  try {
    return await oneImageAtATime(async () => {
      const band = await renderBand(text, width, height, style);
      const output = sharp(image, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true })
        .flatten({ background: "#ffffff" })
        .composite([{ input: band, gravity: style.placement === "top" ? "north" : "south" }])
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
      return (xmp ? output.withXmp(xmp) : output).toBuffer();
    });
  } catch (error) {
    throw unreadable(error);
  }
}

/** L'image d'essayage prête à partir vers le membre : bandeau « Image
 * générée par IA » dans sa langue, métadonnée IPTC en XMP, rien d'autre. */
export function addAiBand(image: Buffer, locale: Locale): Promise<Buffer> {
  return drawBand(image, aiBandText(locale), AI_BAND_STYLE, AI_GENERATED_XMP);
}
