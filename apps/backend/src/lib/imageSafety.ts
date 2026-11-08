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
 * millions). Chaque million de plus coûte de la mémoire : mesuré le
 * 2026-11-04, une image à ce plafond ajoute au plus ≈ 200 Mo pendant son
 * traitement en photo (PNG entrelacé, le pire format) ; le serveur a 512 Mo.
 * Au-delà, l'image est refusée dès son en-tête, sans être décodée : sans ce
 * plafond, un WebP de 38 octets (12 000 × 12 000) envoyé au Spotter faisait
 * monter la mémoire à 1,2 Go. La copie d'une envie garde son plafond de
 * 40 millions (photos.ts). */
export const MAX_INPUT_PIXELS = 52_000_000;

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
