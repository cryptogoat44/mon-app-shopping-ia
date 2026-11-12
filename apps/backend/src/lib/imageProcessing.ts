import sharp, { type Sharp } from "sharp";
import type { CropRect } from "@monapp/shared-types";
import { safeFetch } from "./safeFetch.js";
import { IMAGE_TOO_HEAVY, MAX_INPUT_PIXELS, imageFormatOf, isTooHeavyToDecode, oneImageAtATime } from "./imageSafety.js";

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

/** Zone en pixels (gauche, haut, largeur, hauteur). */
interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** La zone vue à l'écran (image redressée) retrouvée dans l'image telle
 * qu'elle est stockée, pour chacune des 8 orientations EXIF (largeur et
 * hauteur stockées : `storedWidth`, `storedHeight`). Exporté pour les tests. */
export function storedRect(orientation: number, storedWidth: number, storedHeight: number, shown: PixelRect): PixelRect {
  const { left, top, width, height } = shown;
  switch (orientation) {
    case 2: // miroir horizontal
      return { left: storedWidth - left - width, top, width, height };
    case 3: // demi-tour
      return { left: storedWidth - left - width, top: storedHeight - top - height, width, height };
    case 4: // miroir vertical
      return { left, top: storedHeight - top - height, width, height };
    case 5: // transposée
      return { left: top, top: left, width: height, height: width };
    case 6: // quart de tour (photo verticale d'iPhone)
      return { left: top, top: storedHeight - left - width, width: height, height: width };
    case 7: // transposée inverse
      return { left: storedWidth - top - height, top: storedHeight - left - width, width: height, height: width };
    case 8: // quart de tour dans l'autre sens
      return { left: storedWidth - top - height, top: left, width: height, height: width };
    default:
      return shown;
  }
}

/** Recadre l'image sur la zone choisie (proportions 0–1), la redresse selon
 * son orientation EXIF (photos d'iPhone), la limite à 1 600 px et la
 * convertit en JPEG. Sans zone, l'image entière est seulement normalisée.
 * Relève ImageSourceError si le fichier n'est pas une image lisible (le type
 * déclaré par l'app n'est jamais cru sur parole : c'est sharp qui décode),
 * pas d'un format permis ou trop grande (lib/imageSafety.ts).
 * Mémoire (lot garde-fous, 2026-11-05) : avant, l'image entière était
 * redressée et réencodée, puis décodée une seconde fois : ≈ 545 Mo au pic pour
 * une photo de 48 Mpx, sur un serveur de 512 Mo. Désormais, une seule chaîne
 * sharp, et rien n'est jamais tourné en entier : la zone est découpée dans
 * l'image telle qu'elle est stockée (storedRect), puis redressée et réduite ;
 * sans zone, sharp décode l'image déjà réduite. Mesuré sur 48 Mpx : 125 à
 * 160 Mo au pic selon la zone (dont ≈ 85 Mo pour Node et sharp chargés), et
 * exactement les mêmes pixels qu'en redressant d'abord (même zone, même
 * sens, mêmes dimensions). Dimensions et orientation lues dans l'en-tête
 * seul (metadata), sans décoder l'image. */
export async function prepareImageForAnalysis(input: Buffer, crop: CropRect | null): Promise<Buffer> {
  // Format vérifié sur les premiers octets, AVANT sharp : un SVG n'est
  // jamais lu, même annoncé comme une photo.
  if (!imageFormatOf(input)) throw new ImageSourceError("Image illisible");
  const options = { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS } as const;
  let storedWidth: number | undefined;
  let storedHeight: number | undefined;
  let orientation: number;
  let tooHeavy: boolean;
  try {
    const meta = await sharp(input, options).metadata();
    storedWidth = meta.width;
    storedHeight = meta.height;
    orientation = meta.orientation ?? 1;
    tooHeavy = isTooHeavyToDecode(meta);
  } catch {
    throw new ImageSourceError("Image illisible");
  }
  if (!storedWidth || !storedHeight) throw new ImageSourceError("Image illisible");
  // Revue de sécurité du 12 novembre 2026 : une image qui ne se décode que
  // d'un seul bloc (PNG entrelacé, JPEG progressif, GIF, AVIF) et demanderait
  // trop de mémoire est refusée ici, sur son en-tête (lib/imageSafety.ts).
  if (tooHeavy) throw new ImageSourceError(IMAGE_TOO_HEAVY);

  let image: Sharp;
  if (crop) {
    // La zone est donnée sur l'image telle qu'affichée, orientation EXIF
    // appliquée (5 à 8 : largeur et hauteur échangées) — sinon une photo
    // verticale d'iPhone serait recadrée sur une zone tournée de 90°.
    const swapped = orientation >= 5 && orientation <= 8;
    const width = swapped ? storedHeight : storedWidth;
    const height = swapped ? storedWidth : storedHeight;
    const left = Math.round(crop.x * width);
    const top = Math.round(crop.y * height);
    const cropWidth = Math.min(Math.round(crop.width * width), width - left);
    const cropHeight = Math.min(Math.round(crop.height * height), height - top);
    if (cropWidth < MIN_CROP_PIXELS || cropHeight < MIN_CROP_PIXELS) {
      throw new ImageSourceError("Zone trop petite");
    }
    // Découpée dans l'image stockée, puis redressée (autoOrient après extract).
    image = sharp(input, options)
      .extract(storedRect(orientation, storedWidth, storedHeight, { left, top, width: cropWidth, height: cropHeight }))
      .autoOrient();
  } else {
    image = sharp(input, { ...options, autoOrient: true });
  }

  try {
    // Un seul traitement d'image à la fois dans tout le serveur (lib/imageSafety.ts).
    return await oneImageAtATime(() =>
      image
        .resize({ width: MAX_ANALYSIS_EDGE, height: MAX_ANALYSIS_EDGE, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer()
    );
  } catch {
    // Le décodage se fait ici : un fichier tronqué ou corrompu est une image
    // illisible (400), comme avant, jamais une erreur du serveur.
    throw new ImageSourceError("Image illisible");
  }
}
