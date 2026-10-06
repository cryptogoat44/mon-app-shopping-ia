// Pixels d'une petite image PNG (lot 4, temps 1 bis) : sur iPhone, seul moyen
// simple de lire les pixels d'une image de la vidéo depuis l'app, pour juger
// sa netteté et la comparer aux autres (le site lit les pixels du canevas).
// Décompression par fflate (licence MIT, sans dépendance). Formats lus : 8
// bits par canal, gris ou couleur, avec ou sans transparence, non entrelacé —
// ce que produit l'iPhone. Logique pure, testée.
import { unzlibSync } from "fflate";
import { toFrameSample, type FrameSample } from "./frame-sample";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Octets par pixel selon le type de couleur PNG (8 bits par canal). */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | BASE64.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes.subarray(0, index);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/** Retire les filtres PNG, ligne par ligne (aucun, gauche, haut, moyenne, Paeth). */
function unfilter(data: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  if (data.length < (stride + 1) * height) throw new Error("png_truncated");
  const pixels = new Uint8Array(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = data[row * (stride + 1)]!;
    if (filter > 4) throw new Error("png_filter");
    const source = row * (stride + 1) + 1;
    const target = row * stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? pixels[target + i - channels]! : 0;
      const up = row > 0 ? pixels[target + i - stride]! : 0;
      const upLeft = row > 0 && i >= channels ? pixels[target + i - stride - channels]! : 0;
      const predictor = filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, upLeft) : 0;
      pixels[target + i] = (data[source + i]! + predictor) & 0xff;
    }
  }
  return pixels;
}

/** Image PNG (octets) → luminance de chaque pixel. Relève une erreur pour
 * tout format non pris en charge. */
export function decodePngSample(bytes: Uint8Array): FrameSample {
  if (SIGNATURE.some((value, index) => bytes[index] !== value)) throw new Error("png_signature");
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const chunks: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      const [bitDepth, colorType, , , interlace] = data.subarray(8, 13);
      channels = CHANNELS[colorType ?? -1] ?? 0;
      if (bitDepth !== 8 || channels === 0 || interlace !== 0) throw new Error("png_format");
    } else if (type === "IDAT") {
      chunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (!width || !height || chunks.length === 0) throw new Error("png_incomplete");
  const compressed = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let position = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, position);
    position += chunk.length;
  }
  return toFrameSample(unfilter(unzlibSync(compressed), width, height, channels), width, height, channels);
}
