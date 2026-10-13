import sharp, { type Sharp } from "sharp";
import { ImageSourceError } from "./imageProcessing.js";

// Photos envoyées par les utilisateurs (publications, Vault, avatar) —
// lot « images et fluidité ». Une photo d'iPhone pèse 3 à 4 Mo (3024 × 4032) :
// affichée telle quelle, elle alourdissait le fil (mesure : 9 Mo pour 7
// publications). On l'enregistre redimensionnée, en gardant la netteté :
// - « affichage » : 1 600 px sur le grand côté — plus que les 1 170 px d'un
//   écran d'iPhone en pleine largeur (390 points × 3) ;
// - « miniature » : 480 px, pour les grilles (≈ 320 px nécessaires) ;
// - avatar : 512 px.
// sharp retire aussi les métadonnées (dont la position GPS des photos).
export const PHOTO_SIZES = { display: 1600, thumb: 480, avatar: 512 } as const;

/** Comme optimizePhoto, avec la taille finale (ex. images envoyées à l'IA,
 * dont les coordonnées renvoyées dépendent de cette taille). */
export async function optimizePhotoWithSize(input: Buffer, maxSide: number, quality = 82): Promise<{ data: Buffer; width: number; height: number }> {
  try {
    const { data, info } = await sharp(input, { failOn: "error" })
      .rotate() // orientation EXIF appliquée avant de retirer les métadonnées
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new ImageSourceError("Image illisible");
  }
}

export async function optimizePhoto(input: Buffer, maxSide: number, quality = 82): Promise<Buffer> {
  return (await optimizePhotoWithSize(input, maxSide, quality)).data;
}

// Copie de l'image d'une envie partagée (lot 5, 5.C : republiée sur un
// profil ou envoyée à une personne). Ce n'est pas une photo d'iPhone, mais
// souvent une petite image de produit déjà compressée (vignette de Google :
// ≈ 180 × 280 px) : la ré-encoder comme une photo (qualité 82, couleurs
// sous-échantillonnées en 4:2:0) ajoutait une deuxième perte visible, et sa
// miniature, à la même taille en qualité 78, était pire encore. D'où :
// - formats d'image classiques seulement (jamais de SVG, que sharp devrait
//   dessiner lui-même à partir d'un fichier venu d'ailleurs), 40 mégapixels
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
  try {
    const image = sharp(input, { failOn: "error", limitInputPixels: SHARED_COPY_MAX_PIXELS });
    const { format, width, height } = await image.metadata();
    if (format && SHARED_COPY_FORMATS.has(format) && width && height) return { image, width, height };
  } catch {
    // Illisible, ou plus de 40 mégapixels : même refus ci-dessous.
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
  } catch {
    throw new ImageSourceError("Image illisible");
  }
}
