// Images de l'essayage virtuel (lot « essayage virtuel »), traitées en
// mémoire seulement : jamais sur disque, jamais dans le stockage, jamais
// dans un journal. Mêmes barrières que toute image reçue (lib/imageSafety.ts) :
// format reconnu sur les premiers octets avant sharp, plafond de pixels et
// mémoire du décodage estimée sur l'en-tête, avant tout décodage, puis un
// seul traitement d'image à la fois dans tout le serveur.
// - Photo du membre : JPEG, PNG ou WebP seulement (l'app et le site
//   convertissent les photos HEIC avant l'envoi), 10 Mo au plus, orientation
//   appliquée, 1 296 px au plus sur le grand côté (FASHN travaille en
//   864 × 1 296), ré-encodée en JPEG : toutes les métadonnées disparaissent
//   (EXIF, dont la position GPS, XMP, profil ICC).
// - Image de la pièce téléchargée par le serveur (quand le fournisseur n'a
//   pas pu la charger lui-même) : les cinq formats permis, même traitement.
import sharp, { type Metadata } from "sharp";
import { ImageSourceError } from "../imageProcessing.js";
import { IMAGE_TOO_HEAVY, ImageQueueFullError, MAX_INPUT_PIXELS, imageFormatOf, isTooHeavyToDecode, oneImageAtATime, type ImageFormat } from "../imageSafety.js";

/** Formats acceptés pour la photo du membre (vérifiés sur ses octets). */
export const TRYON_PHOTO_FORMATS: ReadonlySet<ImageFormat> = new Set<ImageFormat>(["jpeg", "png", "webp"]);
/** Formats acceptés pour l'image d'une pièce téléchargée chez le marchand. */
export const TRYON_GARMENT_FORMATS: ReadonlySet<ImageFormat> = new Set<ImageFormat>(["jpeg", "png", "webp", "gif", "heif"]);
/** Poids maximal de la photo envoyée : 10 Mo. */
export const TRYON_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
/** Grand côté maximal des images envoyées au fournisseur. */
export const TRYON_IMAGE_MAX_SIDE = 1296;
const JPEG_QUALITY = 90;

/** L'erreur à relever après un traitement manqué : « image illisible », sauf
 * file des traitements pleine (à réessayer, ce n'est pas la faute de l'image). */
function unreadable(error: unknown): Error {
  return error instanceof ImageQueueFullError ? error : new ImageSourceError("Image illisible");
}

/** En-tête seul (rien n'est décodé) ; ImageSourceError s'il est illisible,
 * trop grand, ou si le décodage demanderait trop de mémoire. */
async function readHeader(input: Buffer): Promise<Metadata> {
  let header: Metadata;
  try {
    header = await sharp(input, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new ImageSourceError("Image illisible");
  }
  if (isTooHeavyToDecode(header)) throw new ImageSourceError(IMAGE_TOO_HEAVY);
  return header;
}

/** Vérifie puis ré-encode une image en JPEG de 1 296 px au plus, sans
 * aucune métadonnée (sharp n'en garde aucune sans withMetadata). */
async function reencode(input: Buffer, formats: ReadonlySet<ImageFormat>): Promise<Buffer> {
  if (input.length === 0 || input.length > TRYON_PHOTO_MAX_BYTES) throw new ImageSourceError("Image illisible");
  // Premiers octets vérifiés AVANT sharp : un SVG ou un format refusé n'est jamais lu.
  const format = imageFormatOf(input);
  if (!format || !formats.has(format)) throw new ImageSourceError("Format non accepté");
  const header = await readHeader(input);
  if (!header.width || !header.height) throw new ImageSourceError("Image illisible");
  try {
    return await oneImageAtATime(() =>
      sharp(input, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true })
        .resize({ width: TRYON_IMAGE_MAX_SIDE, height: TRYON_IMAGE_MAX_SIDE, fit: "inside", withoutEnlargement: true })
        // Le JPEG n'a pas de transparence : fond blanc, jamais noir.
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer()
    );
  } catch (error) {
    throw unreadable(error);
  }
}

/** Photo du membre prête à partir chez le fournisseur. ImageSourceError si
 * elle n'est pas un JPEG, un PNG ou un WebP lisible, ou si elle est trop
 * grande ; ImageQueueFullError si le serveur est trop chargé. */
export function prepareTryonPhoto(input: Buffer): Promise<Buffer> {
  return reencode(input, TRYON_PHOTO_FORMATS);
}

/** Image d'une pièce téléchargée chez le marchand, prête à partir chez le
 * fournisseur (mêmes refus). */
export function prepareGarmentImage(input: Buffer): Promise<Buffer> {
  return reencode(input, TRYON_GARMENT_FORMATS);
}

/** Une image JPEG en « data URI » (la forme attendue par FASHN, et celle
 * renvoyée au membre) ; jamais écrite ailleurs qu'en mémoire. */
export function jpegDataUri(jpeg: Buffer): string {
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}
