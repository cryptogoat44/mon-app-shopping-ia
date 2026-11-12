import sharp, { type Metadata, type Sharp } from "sharp";
import { AVATAR_SIDE } from "@monapp/shared-types";
import { ImageSourceError } from "./imageProcessing.js";
import { IMAGE_TOO_HEAVY, ImageQueueFullError, MAX_INPUT_PIXELS, imageFormatOf, isTooHeavyToDecode, oneImageAtATime } from "./imageSafety.js";

// Photos envoyées par les utilisateurs (publications, Vault, avatar) —
// lot « images et fluidité ». Une photo d'iPhone pèse 3 à 4 Mo (3024 × 4032) :
// affichée telle quelle, elle alourdissait le fil (mesure : 9 Mo pour 7
// publications). On l'enregistre redimensionnée, en gardant la netteté :
// - « affichage » : 1 600 px sur le grand côté — plus que les 1 170 px d'un
//   écran d'iPhone en pleine largeur (390 points × 3) ;
// - « miniature » : 480 px, pour les grilles (≈ 320 px nécessaires) ;
// - avatar : un carré de 512 px (encodeAvatar, plus bas).
// sharp retire aussi les métadonnées (dont la position GPS des photos).
// Format, taille et mémoire du décodage sont vérifiés avant tout décodage, et
// les traitements passent un par un (lib/imageSafety.ts).
export const PHOTO_SIZES = { display: 1600, thumb: 480, avatar: AVATAR_SIDE } as const;

/** L'erreur à relever après un traitement manqué : « image illisible »
 * (fichier tronqué ou corrompu), sauf quand la file des traitements est
 * pleine — ce n'est pas la faute de l'image, l'erreur passe telle quelle. */
function unreadable(error: unknown): Error {
  return error instanceof ImageQueueFullError ? error : new ImageSourceError("Image illisible");
}

/** L'en-tête d'une image (jamais décodée ici) ; ImageSourceError s'il est
 * illisible ou si l'image dépasse `maxPixels`, ou si la décoder demanderait
 * trop de mémoire. */
async function readHeader(input: Buffer, maxPixels: number): Promise<Metadata> {
  let header: Metadata;
  try {
    header = await sharp(input, { failOn: "error", limitInputPixels: maxPixels }).metadata();
  } catch {
    throw new ImageSourceError("Image illisible");
  }
  if (isTooHeavyToDecode(header)) throw new ImageSourceError(IMAGE_TOO_HEAVY);
  return header;
}

/** Comme optimizePhoto, avec la taille finale (ex. images envoyées à l'IA,
 * dont les coordonnées renvoyées dépendent de cette taille). */
export async function optimizePhotoWithSize(input: Buffer, maxSide: number, quality = 82): Promise<{ data: Buffer; width: number; height: number }> {
  // Premiers octets vérifiés AVANT sharp : un SVG n'est jamais lu, même
  // annoncé comme une photo.
  if (!imageFormatOf(input)) throw new ImageSourceError("Image illisible");
  // En-tête seul : une image qui ne se décode que d'un bloc et demanderait
  // trop de mémoire est refusée ici, avant tout décodage.
  await readHeader(input, MAX_INPUT_PIXELS);
  try {
    const { data, info } = await oneImageAtATime(() =>
      sharp(input, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
        .rotate() // orientation EXIF appliquée avant de retirer les métadonnées
        .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true })
    );
    return { data, width: info.width, height: info.height };
  } catch (error) {
    throw unreadable(error);
  }
}

export async function optimizePhoto(input: Buffer, maxSide: number, quality = 82): Promise<Buffer> {
  return (await optimizePhotoWithSize(input, maxSide, quality)).data;
}

// Photo de profil (lot « profil et icône des réglages ») : JPEG ou PNG
// seulement (l'app convertit les photos HEIC d'iPhone en JPEG avant l'envoi :
// le sharp du serveur ne sait pas les lire). Toujours un carré de
// PHOTO_SIZES.avatar px de côté (moins si la photo est plus petite : jamais
// agrandie), centré, orientation EXIF appliquée, fond blanc sous la
// transparence d'un PNG. Aucune métadonnée gardée (ni EXIF, ni position
// GPS) : sharp les retire tant qu'on ne demande pas withMetadata.
export const AVATAR_FORMATS: ReadonlySet<string> = new Set(["jpeg", "png"]);
/** Plus grande image acceptée pour une photo de profil : 2 048 × 2 048
 * pixels (revue de sécurité du 12 novembre 2026). L'app envoie toujours un
 * carré de 1 024 px au plus, déjà recadré sur l'appareil : le plafond général
 * de 52 Mpx n'avait aucune raison d'être ici, et laissait passer un PNG de
 * 0,6 Mo qui demandait 530 Mo de mémoire au serveur. Refus dès l'en-tête. */
export const AVATAR_MAX_INPUT_PIXELS = 2048 * 2048;
// Marques des photos HEIC d'iPhone (codées en HEVC) : le sharp du serveur ne sait pas les lire.
const HEVC_BRANDS: ReadonlySet<string> = new Set(["heic", "heix", "hevc", "hevx"]);

/** Vraie image d'un format permis ailleurs mais pas pour la photo de
 * profil (WebP, GIF, AVIF, HEIC envoyé sans conversion) : la personne doit
 * savoir quoi envoyer. Seul l'en-tête est lu (rien n'est décodé) ; un faux
 * en-tête devant autre chose (SVG déguisé) n'en est pas une et reste
 * « illisible », comme le veut la sécurité des images. */
export async function isOtherImageFormat(input: Buffer): Promise<boolean> {
  const format = imageFormatOf(input);
  if (!format || AVATAR_FORMATS.has(format)) return false;
  if (format === "heif" && HEVC_BRANDS.has(input.toString("latin1", 8, 12))) return true;
  try {
    const { width, height } = await sharp(input, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    return Boolean(width && height);
  } catch {
    return false;
  }
}

/** Photo de profil prête à enregistrer, et son côté. Relève ImageSourceError
 * si l'image est illisible, trop grande (AVATAR_MAX_INPUT_PIXELS, et la
 * mémoire de son décodage) ou d'un autre format (vérifié sur les premiers
 * octets, avant sharp). Rien n'est décodé avant ces contrôles. */
export async function encodeAvatar(input: Buffer): Promise<{ data: Buffer; side: number }> {
  const format = imageFormatOf(input);
  if (!format || !AVATAR_FORMATS.has(format)) throw new ImageSourceError("Image illisible");
  // Dimensions lues dans l'en-tête seul, sans décoder l'image.
  const header = await readHeader(input, MAX_INPUT_PIXELS);
  if ((header.width ?? 0) * (header.height ?? 0) > AVATAR_MAX_INPUT_PIXELS) throw new ImageSourceError(IMAGE_TOO_HEAVY);
  const side = Math.min(PHOTO_SIZES.avatar, header.autoOrient.width, header.autoOrient.height);
  if (!side) throw new ImageSourceError("Image illisible");
  try {
    const data = await oneImageAtATime(() =>
      sharp(input, { failOn: "error", limitInputPixels: AVATAR_MAX_INPUT_PIXELS, autoOrient: true })
        .resize({ width: side, height: side, fit: "cover", position: "centre" })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer()
    );
    return { data, side };
  } catch (error) {
    throw unreadable(error);
  }
}

// Copie de l'image d'une envie partagée (lot 5, 5.C : republiée sur un
// profil ou envoyée à une personne). Ce n'est pas une photo d'iPhone, mais
// souvent une petite image de produit déjà compressée (vignette de Google :
// ≈ 180 × 280 px) : la ré-encoder comme une photo (qualité 82, couleurs
// sous-échantillonnées en 4:2:0) ajoutait une deuxième perte visible, et sa
// miniature, à la même taille en qualité 78, était pire encore. D'où :
// - formats d'image classiques seulement (jamais de SVG, que sharp devrait
//   dessiner lui-même à partir d'un fichier venu d'ailleurs), vérifiés sur
//   les premiers octets AVANT sharp (lib/imageSafety.ts), 40 mégapixels
//   au plus ;
// - orientation EXIF appliquée, fond blanc sous la transparence (un PNG de
//   produit détouré ressortait sur fond NOIR : le JPEG n'a pas de
//   transparence) ;
// - jamais agrandie ; 1 600 px au plus sur le grand côté, comme une photo ;
// - petite source (800 px au plus) : qualité 92 et couleurs complètes
//   (4:4:4), la perte ajoutée devient négligeable pour quelques Ko ;
//   au-delà : qualité 85 en 4:2:0, pour le poids du fil ;
// - miniature : la copie d'affichage elle-même quand la source fait 480 px
//   au plus (jamais moins bonne qu'elle), sinon 480 px en qualité 82.
// optimizePhoto, ci-dessus, reste celle des photos envoyées par les utilisateurs.
const SHARED_COPY_FORMATS: ReadonlySet<string> = new Set(["jpeg", "png", "webp", "heif", "gif"]);
const SHARED_COPY_MAX_PIXELS = 40_000_000;
const SHARED_COPY_SMALL_SIDE = 800;

export interface SharedCopy {
  display: Buffer;
  thumb: Buffer;
  /** Dimensions de la copie d'affichage. */
  width: number;
  height: number;
}

/** Ouvre une image à copier : format accepté et taille plafonnée, sinon
 * ImageSourceError. Seul l'en-tête est lu à ce stade. */
async function openSharedSource(input: Buffer): Promise<{ image: Sharp; width: number; height: number }> {
  // metadata() fait déjà lire le fichier par sharp : le format se vérifie
  // donc avant, sur les premiers octets.
  if (!imageFormatOf(input)) throw new ImageSourceError("Image illisible");
  // Illisible, plus de 40 mégapixels, ou trop de mémoire pour la décoder : refus.
  const { format, width, height } = await readHeader(input, SHARED_COPY_MAX_PIXELS);
  if (format && SHARED_COPY_FORMATS.has(format) && width && height) {
    return { image: sharp(input, { failOn: "error", limitInputPixels: SHARED_COPY_MAX_PIXELS }), width, height };
  }
  throw new ImageSourceError("Image illisible");
}

/** Dimensions d'une source candidate (en-tête seulement), pour choisir la
 * plus grande ; ImageSourceError si elle n'est pas acceptée. */
export async function measureSharedSource(input: Buffer): Promise<{ width: number; height: number }> {
  const { width, height } = await openSharedSource(input);
  return { width, height };
}

/** Copie d'une image partagée, en deux tailles (règles ci-dessus). Relève
 * ImageSourceError si l'image n'est pas acceptée ou ne se décode pas
 * jusqu'au bout (fichier tronqué, par exemple). */
export async function encodeSharedCopy(input: Buffer): Promise<SharedCopy> {
  const { image, width, height } = await openSharedSource(input);
  // Le grand côté ne change pas avec l'orientation EXIF.
  const longSide = Math.max(width, height);
  try {
    const prepared = image.rotate().flatten({ background: "#ffffff" });
    // Les deux tailles dans le même passage de la file : jamais deux décodages en même temps.
    return await oneImageAtATime(async () => {
      const { data: display, info } = await prepared
        .clone()
        .resize({ width: PHOTO_SIZES.display, height: PHOTO_SIZES.display, fit: "inside", withoutEnlargement: true })
        .jpeg(longSide <= SHARED_COPY_SMALL_SIDE ? { quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true } : { quality: 85, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      const thumb =
        longSide <= PHOTO_SIZES.thumb
          ? display
          : await prepared
              .clone()
              .resize({ width: PHOTO_SIZES.thumb, height: PHOTO_SIZES.thumb, fit: "inside" })
              .jpeg({ quality: 82, mozjpeg: true })
              .toBuffer();
      return { display, thumb, width: info.width, height: info.height };
    });
  } catch (error) {
    throw unreadable(error);
  }
}
