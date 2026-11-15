// Images reçues en « data: » (lot « vidéo auto » : image d'un moment trouvé
// dans une vidéo TikTok ou Instagram à partir de son lien). Elles restent en
// mémoire : jamais écrites sur l'appareil ni dans le navigateur. Ce fichier
// les lit (base64), en vérifie l'en-tête et la taille (JPEG), et en fait une
// pièce jointe en mémoire pour l'envoi de la recherche habituelle.
// Logique pure, testée. Imports relatifs : fichier testé par vitest.

export interface PixelSize {
  width: number;
  height: number;
}

/** Au-delà, l'adresse est refusée (une image de 1 280 px en JPEG ≈ 0,1 à 0,5 Mo). */
export const MAX_DATA_URI_LENGTH = 4_000_000;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const VALUES = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let index = 0; index < ALPHABET.length; index++) table[ALPHABET.charCodeAt(index)] = index;
  return table;
})();

/** Base64 standard (RFC 4648, « = » final facultatif) ; null au premier caractère étranger. */
export function decodeBase64(text: string): Uint8Array | null {
  const clean = text.endsWith("==") ? text.slice(0, -2) : text.endsWith("=") ? text.slice(0, -1) : text;
  if (clean.length % 4 === 1) return null;
  const bytes = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (let position = 0; position < clean.length; position++) {
    const code = clean.charCodeAt(position);
    const value = code < 128 ? VALUES[code]! : -1;
    if (value < 0) return null;
    buffer = ((buffer << 6) | value) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
}

const IMAGE_DATA_URI = /^data:(image\/(?:jpeg|png|webp));base64,/;

/** Image en « data: » (JPEG, PNG ou WebP, en base64) : son type et ses octets ; null sinon. */
export function parseImageDataUri(uri: unknown): { type: string; bytes: Uint8Array } | null {
  if (typeof uri !== "string" || uri.length > MAX_DATA_URI_LENGTH) return null;
  const match = IMAGE_DATA_URI.exec(uri);
  if (!match) return null;
  const bytes = decodeBase64(uri.slice(match[0].length));
  return bytes && bytes.length > 0 ? { type: match[1]!, bytes } : null;
}

export function isDataUri(uri: string): boolean {
  return uri.startsWith("data:");
}

/** Largeur et hauteur lues dans l'en-tête JPEG (premier marqueur SOF) ; null si l'image n'est pas un JPEG lisible. */
export function jpegSize(bytes: Uint8Array): PixelSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    // Octets de remplissage, puis marqueurs sans longueur.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    // Fin d'image ou début des données avant toute taille : illisible.
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2) return null;
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      if (offset + 9 > bytes.length) return null;
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

/** Image JPEG en « data: » : ses octets et sa taille ; null si l'adresse ou l'image est illisible. */
export function readJpegDataUri(uri: unknown): { bytes: Uint8Array; size: PixelSize } | null {
  const parsed = parseImageDataUri(uri);
  if (!parsed || parsed.type !== "image/jpeg") return null;
  const size = jpegSize(parsed.bytes);
  return size ? { bytes: parsed.bytes, size } : null;
}

/** Pièce jointe gardée en mémoire : le fetch d'Expo (iPhone) lit tout objet
 * qui offre `bytes()` comme un fichier, avec son nom et son type. */
export interface InMemoryImagePart {
  name: string;
  type: string;
  size: number;
  bytes(): Promise<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** L'image d'une adresse « data: », prête à joindre à un envoi, sans fichier ; null si illisible. */
export function inMemoryImagePart(uri: string): InMemoryImagePart | null {
  const parsed = parseImageDataUri(uri);
  if (!parsed) return null;
  const { type, bytes } = parsed;
  const extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return {
    name: `moment.${extension}`,
    type,
    size: bytes.byteLength,
    bytes: async () => bytes,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}
