import sharp, { type Sharp } from "sharp";
import type { CropRect } from "@monapp/shared-types";
import { safeFetch } from "./safeFetch.js";
import { MAX_INPUT_PIXELS, imageFormatOf } from "./imageSafety.js";

// Hébergeurs des vignettes renvoyées par les voies officielles (oEmbed) :
// seules adresses que le serveur accepte de télécharger pour les recadrer
// (règle 9 : liste blanche, redirections revérifiées par safeFetch). Les
// vignettes TikTok viennent de tiktokcdn-eu.com (constaté le 2026-09-24),
// d'autres régions existent ; celles d'Instagram (si un jeton Meta est un
// jour configuré) de cdninstagram.com / fbcdn.net.
export const THUMBNAIL_HOSTS = [
  "tiktokcdn.com",
  "tiktokcdn-eu.com",
  "tiktokcdn-us.com",
  "cdninstagram.com",
  "fbcdn.net",
];

const MAX_REMOTE_IMAGE_BYTES = 15 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10_000;

// Taille maximale de l'image envoyée à l'analyse : au-delà, Google Lens
// n'y gagne rien et l'envoi est plus lent.
const MAX_ANALYSIS_EDGE = 1600;
// En dessous, le recadrage n'a plus de sens (quelques pixels).
const MIN_CROP_PIXELS = 32;

export class ImageSourceError extends Error {}

/** Télécharge une vignette officielle (liste blanche d'hébergeurs,
 * contrôle du type et de la taille). */
export async function downloadThumbnail(url: string): Promise<Buffer> {
  const response = await safeFetch(url, {
    allowedHosts: THUMBNAIL_HOSTS,
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new ImageSourceError(`Vignette indisponible (${response.status})`);
  if (!response.headers.get("content-type")?.startsWith("image/")) {
    throw new ImageSourceError("La vignette n'est pas une image");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_REMOTE_IMAGE_BYTES) throw new ImageSourceError("Vignette trop volumineuse");
  return buffer;
}

/** Recadre l'image sur la zone choisie (proportions 0–1), la redresse selon
 * son orientation EXIF (photos d'iPhone), la limite à 1 600 px et la
 * convertit en JPEG. Sans zone, l'image entière est seulement normalisée.
 * Relève ImageSourceError si le fichier n'est pas une image lisible (le type
 * déclaré par l'app n'est jamais cru sur parole : c'est sharp qui décode),
 * pas d'un format permis ou trop grande (lib/imageSafety.ts).
 * Mémoire (lot garde-fous, 2026-11-05) : une seule chaîne sharp, qui redresse,
 * recadre et réduit en un passage. Avant, l'image entière était redressée et
 * réencodée, puis décodée une seconde fois : ≈ 509 Mo au pic pour une photo de
 * 48 Mpx, sur un serveur de 512 Mo. Les dimensions redressées sont lues dans
 * l'en-tête seul (metadata), sans décoder l'image. */
export async function prepareImageForAnalysis(input: Buffer, crop: CropRect | null): Promise<Buffer> {
  // Format vérifié sur les premiers octets, AVANT sharp : un SVG n'est
  // jamais lu, même annoncé comme une photo.
  if (!imageFormatOf(input)) throw new ImageSourceError("Image illisible");
  const options = { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true } as const;
  let width: number;
  let height: number;
  try {
    // autoOrient : largeur et hauteur telles qu'affichées, orientation EXIF
    // appliquée — sinon une photo verticale d'iPhone serait recadrée sur une
    // zone tournée de 90°. L'en-tête seul : la limite de pixels s'applique déjà.
    const meta = await sharp(input, options).metadata();
    width = meta.autoOrient.width;
    height = meta.autoOrient.height;
  } catch {
    throw new ImageSourceError("Image illisible");
  }
  if (!width || !height) throw new ImageSourceError("Image illisible");

  // autoOrient (option d'entrée) : sharp redresse l'image AVANT le recadrage
  // (extract avant resize : coordonnées de l'image redressée).
  let image: Sharp = sharp(input, options);
  if (crop) {
    const left = Math.round(crop.x * width);
    const top = Math.round(crop.y * height);
    const cropWidth = Math.min(Math.round(crop.width * width), width - left);
    const cropHeight = Math.min(Math.round(crop.height * height), height - top);
    if (cropWidth < MIN_CROP_PIXELS || cropHeight < MIN_CROP_PIXELS) {
      throw new ImageSourceError("Zone trop petite");
    }
    image = image.extract({ left, top, width: cropWidth, height: cropHeight });
  }

  try {
    return await image
      .resize({ width: MAX_ANALYSIS_EDGE, height: MAX_ANALYSIS_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch {
    // Le décodage se fait ici désormais : un fichier tronqué ou corrompu est
    // une image illisible (400), comme avant, jamais une erreur du serveur.
    throw new ImageSourceError("Image illisible");
  }
}
