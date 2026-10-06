// Petite image d'un moment de la vidéo (lot 4, temps 1 bis) : ce que l'étage
// 1 de l'analyse automatique examine pour juger la netteté et repérer les
// quasi-doublons. Une seule conversion, pour l'iPhone (PNG) et le site
// (canevas). Logique pure, testée.

/** Zones de couleur : 3 × 3. */
const ZONES = 3;

export interface FrameSample {
  /** Luminance de chaque pixel (0 = noir, 255 = blanc), ligne par ligne. */
  gray: Uint8Array;
  width: number;
  height: number;
  /** Couleur moyenne (rouge, vert, bleu) de 3 × 3 zones, ligne par ligne :
   * deux plans de même forme mais de couleurs différentes (la même pose,
   * une autre veste) ne sont pas des doublons. */
  colors: number[];
}

/** Pixels (1 à 4 canaux par pixel) → luminance (0,299 R + 0,587 G + 0,114 B)
 * et couleurs moyennes des zones. */
export function toFrameSample(pixels: ArrayLike<number>, width: number, height: number, channels: number): FrameSample {
  const gray = new Uint8Array(width * height);
  const sums = new Float64Array(ZONES * ZONES * 3);
  const counts = new Float64Array(ZONES * ZONES);
  for (let pixel = 0; pixel < gray.length; pixel += 1) {
    const base = pixel * channels;
    const red = pixels[base]!;
    const green = channels >= 3 ? pixels[base + 1]! : red;
    const blue = channels >= 3 ? pixels[base + 2]! : red;
    gray[pixel] = channels >= 3 ? Math.round(0.299 * red + 0.587 * green + 0.114 * blue) : red;
    const zone = Math.min(ZONES - 1, Math.floor((Math.floor(pixel / width) * ZONES) / height)) * ZONES + Math.min(ZONES - 1, Math.floor(((pixel % width) * ZONES) / width));
    sums[zone * 3] = sums[zone * 3]! + red;
    sums[zone * 3 + 1] = sums[zone * 3 + 1]! + green;
    sums[zone * 3 + 2] = sums[zone * 3 + 2]! + blue;
    counts[zone] = counts[zone]! + 1;
  }
  const colors = Array.from(sums, (sum, index) => Math.round(sum / Math.max(1, counts[Math.floor(index / 3)]!)));
  return { gray, width, height, colors };
}
