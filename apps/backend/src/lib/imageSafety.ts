// Sécurité des images reçues (lot « sécurité des images », 2026-11-04).
// Faille GHSA-wq5f-xc86-pv6w : un SVG piégé pouvait faire exécuter du code
// au serveur par librsvg, la partie de sharp qui lit les SVG. Toute image
// envoyée (Spotter, Vault, avatar, publication, vidéo, copie d'une envie)
// passe par sharp, qui reconnaît un SVG à son contenu, quel que soit le type
// annoncé. sharp 0.35.5 corrige cette faille ; contre les suivantes du même
// genre, trois barrières :
// 1. au chargement de ce module, une seule fois, avant toute image : libvips
//    (le moteur de sharp) ne garde que les lecteurs JPEG, PNG, WebP, GIF et
//    HEIF/AVIF. Tous les autres (SVG, TIFF, etc.) sont bloqués ;
// 2. imageFormatOf : les premiers octets sont vérifiés AVANT sharp ;
// 3. MAX_INPUT_PIXELS : une image trop grande est refusée dès la lecture de
//    son en-tête, avant d'être décodée.
// Revue de sécurité du 12 novembre 2026 : le plafond de pixels ne suffisait
// pas. Certaines images ne se décodent que d'un seul bloc, en entier, en
// mémoire : un PNG entrelacé de 0,6 Mo (7200 × 7200, 16 bits) montait à
// 530 Mo, un AVIF de 2 Ko à 1 Go, sur un serveur de 512 Mo. Deux barrières
// de plus :
// 4. fullDecodeBytes / isTooHeavyToDecode : la mémoire d'un tel décodage est
//    estimée d'après l'en-tête, et l'image refusée au-delà de MAX_DECODE_BYTES,
//    avant tout décodage ;
// 5. oneImageAtATime : les traitements passent un par un, pour que des
//    envois simultanés ne s'additionnent jamais.
// Importé en tête de app.ts, et par imageProcessing.ts et photos.ts.
import sharp from "sharp";

/** Lecteurs de libvips gardés. Pour une image en mémoire, sharp n'utilise
 * que les variantes « Buffer » (essayé le 2026-11-04 : rouvrir les seules
 * variantes « Source » ou « File » ne laisse passer aucune image ; ces cinq-là
 * suffisent, voir tests/imageSafety.test.ts). Le GIF est lu par « Nsgif ».
 * HEIF : le binaire de sharp ne lit que l'AVIF, pas les photos HEIC
 * d'iPhone. Le JPEG « Ultra HDR » (lecteur Uhdr) reste bloqué : il est lu
 * comme un JPEG ordinaire. */
export const ALLOWED_IMAGE_LOADERS = [
  "VipsForeignLoadJpegBuffer",
  "VipsForeignLoadPngBuffer",
  "VipsForeignLoadWebpBuffer",
  "VipsForeignLoadNsgifBuffer",
  "VipsForeignLoadHeifBuffer",
];

// Tous les lecteurs bloqués, puis seulement ceux-là rouverts.
sharp.block({ operation: ["VipsForeignLoad"] });
sharp.unblock({ operation: ALLOWED_IMAGE_LOADERS });

/** Plafond des images envoyées, en pixels (largeur × hauteur) : 52 millions.
 * Passent une photo d'iPhone de 48 Mpx envoyée telle quelle (8064 × 6048 =
 * 48,8 millions) et celles des capteurs de 50 Mpx (8192 × 6144 = 50,3
 * millions). Chaque million de plus coûte de la mémoire ; le serveur a
 * 512 Mo. Ce plafond seul ne protège que des images lues par bandes : celles
 * qui se décodent d'un seul bloc (PNG entrelacé, JPEG progressif, GIF, AVIF)
 * ont en plus un plafond de mémoire, bien plus bas (MAX_DECODE_BYTES).
 * Au-delà, l'image est refusée dès son en-tête, sans être décodée : sans ce
 * plafond, un WebP de 38 octets (12 000 × 12 000) envoyé au Spotter faisait
 * monter la mémoire à 1,2 Go. La copie d'une envie garde son plafond de
 * 40 millions (photos.ts). */
export const MAX_INPUT_PIXELS = 52_000_000;

/** Mémoire qu'un décodage « d'un seul bloc » peut demander au plus : 128 Mo.
 * Avec le serveur chargé (≈ 90 Mo) et un seul traitement à la fois
 * (oneImageAtATime), le pic reste loin des 512 Mo. Passent : un JPEG
 * progressif jusqu'à ≈ 38 Mpx, un PNG entrelacé avec transparence jusqu'à
 * ≈ 26 Mpx, un GIF jusqu'à ≈ 24 Mpx, un AVIF jusqu'à ≈ 7 Mpx
 * (2 700 × 2 700). Les photos d'appareil (JPEG ordinaire, PNG non entrelacé,
 * WebP) se lisent par bandes : elles ne sont pas concernées et gardent le
 * plafond de 52 Mpx. */
export const MAX_DECODE_BYTES = 128 * 1024 * 1024;

/** Ce que l'en-tête d'une image dit d'elle (sharp : metadata()), sans la décoder. */
export interface ImageHeader {
  format?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  channels?: number | undefined;
  depth?: string | undefined;
  isProgressive?: boolean | undefined;
}

/** Octets par valeur d'une couche (« uchar » : 1, « ushort » : 2, le reste : 4). */
function sampleBytes(depth: string | undefined): number {
  if (depth === undefined || depth === "uchar" || depth === "char") return 1;
  if (depth === "ushort" || depth === "short") return 2;
  return 4;
}

/** Mémoire (en octets) qu'il faut pour décoder l'image quand elle ne peut
 * l'être que d'un seul bloc, estimée d'après son en-tête ; 0 quand elle se
 * lit par bandes (JPEG ordinaire, PNG non entrelacé, WebP). Coûts par pixel
 * mesurés le 12 novembre 2026 sur des images de 4 à 52 Mpx (pic de mémoire
 * du traitement, arrondi au-dessus) :
 * - AVIF/HEIF : 18 octets par pixel (le décodeur garde plusieurs copies) ;
 * - GIF : 5,5 ;
 * - JPEG progressif : 3,5 en couleurs ordinaires, 8,5 en CMJN (4 couches) ;
 * - PNG entrelacé : couches × octets par valeur × 1,25 (10 pour 4 couches
 *   de 16 bits) ;
 * - format inconnu : compté comme un PNG entrelacé (dans le doute, en entier).
 * Dimensions inconnues : infini (refusé). */
export function fullDecodeBytes(header: ImageHeader): number {
  const { format, width, height } = header;
  if (!width || !height) return Number.POSITIVE_INFINITY;
  const pixels = width * height;
  const channels = header.channels ?? 4;
  const whole = pixels * channels * sampleBytes(header.depth) * 1.25;
  switch (format) {
    case "heif":
      return pixels * 18;
    case "gif":
      return pixels * 5.5;
    case "jpeg":
      if (!header.isProgressive) return 0;
      return pixels * (channels > 3 ? 8.5 : 3.5);
    case "png":
      return header.isProgressive ? whole : 0;
    case "webp":
      return 0;
    default:
      return whole;
  }
}

/** Message d'un refus pour cette raison (ImageSourceError) : l'app reçoit la
 * même réponse que pour une image illisible ; le message sert aux tests et
 * au diagnostic. */
export const IMAGE_TOO_HEAVY = "Image trop lourde à décoder";

/** Vrai si décoder cette image demanderait plus de mémoire que permis : à
 * refuser dès l'en-tête, avant tout décodage. */
export function isTooHeavyToDecode(header: ImageHeader, maxBytes: number = MAX_DECODE_BYTES): boolean {
  return fullDecodeBytes(header) > maxBytes;
}

// File des traitements d'images : un seul à la fois dans tout le serveur.
// Sans elle, quatre envois simultanés (sharp décode sur quatre fils)
// additionnaient leur mémoire : quatre images permises chacune pouvaient
// dépasser ensemble les 512 Mo. L'attente est courte (un traitement dure de
// 0,1 à 2 s) et dans l'ordre d'arrivée.
let imageQueue: Promise<unknown> = Promise.resolve();
/** Traitements qui attendent leur tour (celui en cours n'est pas compté). */
let waitingImages = 0;

/** Traitements en attente au plus : 12. Chaque image qui attend garde son
 * fichier en mémoire (10 Mo au plus) : sans plafond, un flot d'envois ferait
 * grossir la file, donc la mémoire, sans fin. Au-delà, l'envoi est refusé
 * aussitôt (ImageQueueFullError : « réessayez », 503). */
export const MAX_WAITING_IMAGES = 12;

/** File des traitements d'images pleine : à réessayer dans un instant. */
export class ImageQueueFullError extends Error {
  constructor() {
    super("File des traitements d'images pleine");
    this.name = "ImageQueueFullError";
  }
}

/** Lance `job` quand le traitement d'image précédent est terminé (réussi ou
 * non), et rend son résultat. Seul le décodage passe ici : la lecture d'un
 * en-tête (metadata) ne coûte rien et n'attend pas. File pleine
 * (MAX_WAITING_IMAGES) : ImageQueueFullError, sans rien lancer. */
export function oneImageAtATime<T>(job: () => Promise<T>): Promise<T> {
  if (waitingImages >= MAX_WAITING_IMAGES) return Promise.reject(new ImageQueueFullError());
  waitingImages += 1;
  const start = () => {
    waitingImages -= 1;
    return job();
  };
  const run = imageQueue.then(start, start);
  imageQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Formats permis, reconnus à leurs premiers octets. */
export type ImageFormat = "jpeg" | "png" | "webp" | "gif" | "heif";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Marques HEIF/AVIF acceptées dans la boîte « ftyp ».
const HEIF_BRANDS: ReadonlySet<string> = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1", "avif", "avis"]);

/** Format d'une image d'après ses premiers octets, AVANT tout décodage ;
 * null si ce n'est pas un format permis (SVG, HTML, TIFF, fichier vide…).
 * Le type annoncé par l'app ou par un site n'est jamais cru sur parole. */
export function imageFormatOf(input: Buffer): ImageFormat | null {
  const text = (start: number, end: number) => input.toString("latin1", start, end);
  if (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return "jpeg";
  if (input.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "webp";
  if (text(0, 6) === "GIF87a" || text(0, 6) === "GIF89a") return "gif";
  // Boîte « ftyp » : sa taille sur 4 octets, « ftyp », puis la marque. Une
  // taille plausible (16 octets à 1 Ko, comme libvips) écarte un faux
  // en-tête écrit en texte devant un SVG (« ␣␣␣␣ftypavif<svg… »).
  if (input.length >= 16 && text(4, 8) === "ftyp" && HEIF_BRANDS.has(text(8, 12))) {
    const size = input.readUInt32BE(0);
    if (size >= 16 && size <= 1024) return "heif";
  }
  return null;
}
