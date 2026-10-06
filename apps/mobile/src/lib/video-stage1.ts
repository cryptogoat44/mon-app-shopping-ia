// Étage 1 de l'analyse automatique (lot 4, temps 1 bis), sur l'appareil,
// gratuit : parmi des images prises à intervalles réguliers dans la vidéo,
// garder 8 à 12 images nettes et différentes les unes des autres (les images
// floues et les quasi-doublons sont écartés). La vidéo ne quitte jamais
// l'appareil. Logique pure, testée.
import { VIDEO_AI } from "@monapp/shared-types";
import { filmstripTimes } from "./video-timeline";
import type { FrameSample } from "./frame-sample";

export type { FrameSample };

/** Images examinées : une toutes les 0,5 s, entre 12 et 24. */
const MIN_CANDIDATES = 12;
const MAX_CANDIDATES = 24;
const CANDIDATE_SPACING_MS = 500;
/** Côté des petites images examinées (assez pour juger la netteté). */
export const SCORING_EDGE = 96;
/** Floue : moins de 40 % de la netteté des meilleures images de la vidéo. */
const BLUR_RATIO = 0.4;
/** Image unie (écran noir, transition) : aucune netteté exploitable. */
const MIN_SHARPNESS = 2;
/** Quasi-doublon : empreintes différentes sur 6 bits au plus (sur 64)… */
const DUPLICATE_DISTANCE = 6;
/** … ET couleurs proches dans chacune des 9 zones (distance ≤ 12 sur 255,
 * rouge-vert-bleu) : la même pose avec une autre veste n'est pas un doublon.
 * Deux images successives d'un même plan restent sous 8 ; une veste marron
 * et une veste vert olive, à 27 (seuil de 20 en écart moyen trop indulgent :
 * constaté sur iPhone, lot 4 temps 1 bis). */
const DUPLICATE_COLOR = 12;
/** Écart de luminosité (sur 255) en dessous duquel deux cases voisines sont
 * jugées égales : sans lui, le moindre bruit d'une zone unie changerait
 * l'empreinte. */
const HASH_TOLERANCE = 2;

export interface FrameCandidate {
  timeMs: number;
  sharpness: number;
  /** Empreinte de 64 bits (« 0 » et « 1 »). */
  hash: string;
  /** Couleurs moyennes des 9 zones (voir frame-sample.ts). */
  colors: number[];
}

/** Moments examinés, répartis sur toute la vidéo. */
export function candidateTimes(durationMs: number): number[] {
  const count = Math.min(MAX_CANDIDATES, Math.max(MIN_CANDIDATES, Math.round(durationMs / CANDIDATE_SPACING_MS)));
  return filmstripTimes(durationMs, count);
}

/** Netteté : variance du laplacien. Bords francs → valeur élevée ; flou de
 * bougé ou de mise au point → valeur faible. */
export function sharpness({ gray, width, height }: FrameSample): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const laplacian = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - width]! - gray[i + width]!;
      sum += laplacian;
      sumSquares += laplacian * laplacian;
      count += 1;
    }
  }
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

/** Moyenne des pixels d'un rectangle (bornes entières, au moins un pixel). */
function areaMean(image: FrameSample, left: number, top: number, right: number, bottom: number): number {
  let sum = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) sum += image.gray[y * image.width + x]!;
  }
  return sum / ((right - left) * (bottom - top));
}

/** Empreinte « dHash » : l'image réduite à 9 × 8 cases ; chaque bit dit si
 * une case est nettement plus claire que sa voisine de gauche. Deux images
 * presque identiques ont presque la même empreinte. */
export function differenceHash(image: FrameSample): string {
  const cells: number[] = [];
  for (let row = 0; row < 8; row += 1) {
    const top = Math.floor((row * image.height) / 8);
    const bottom = Math.max(top + 1, Math.floor(((row + 1) * image.height) / 8));
    for (let column = 0; column < 9; column += 1) {
      const left = Math.floor((column * image.width) / 9);
      const right = Math.max(left + 1, Math.floor(((column + 1) * image.width) / 9));
      cells.push(areaMean(image, left, top, Math.min(right, image.width), Math.min(bottom, image.height)));
    }
  }
  let hash = "";
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      hash += cells[row * 9 + column + 1]! - cells[row * 9 + column]! > HASH_TOLERANCE ? "1" : "0";
    }
  }
  return hash;
}

/** Plus grand écart de couleur entre deux images, zone par zone (distance
 * entre les couleurs moyennes, en rouge-vert-bleu). */
export function colorDifference(a: readonly number[], b: readonly number[]): number {
  let largest = 0;
  for (let zone = 0; zone * 3 < a.length; zone += 1) {
    let squares = 0;
    for (let channel = 0; channel < 3; channel += 1) squares += ((a[zone * 3 + channel] ?? 0) - (b[zone * 3 + channel] ?? 0)) ** 2;
    largest = Math.max(largest, Math.sqrt(squares));
  }
  return largest;
}

/** Même forme et mêmes couleurs : deux images du même plan. */
export function isNearDuplicate(a: FrameCandidate, b: FrameCandidate): boolean {
  return hammingDistance(a.hash, b.hash) <= DUPLICATE_DISTANCE && colorDifference(a.colors, b.colors) <= DUPLICATE_COLOR;
}

export function hammingDistance(a: string, b: string): number {
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) distance += 1;
  return distance;
}

/** Valeur au rang `ratio` (0 à 1) d'une liste de nombres. */
function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(ratio * sorted.length))] ?? 0;
}

/** Images retenues, dans l'ordre de la vidéo : nettes (comparées aux
 * meilleures de la même vidéo), sans quasi-doublon, 12 au plus. Une vidéo
 * presque fixe peut n'en offrir que 2 ou 3 de vraiment différentes. Si
 * toutes sont floues, la plus nette est gardée. */
export function selectFrames(candidates: readonly FrameCandidate[], max: number = VIDEO_AI.maxFrames): FrameCandidate[] {
  if (candidates.length === 0) return [];
  const threshold = Math.max(MIN_SHARPNESS, BLUR_RATIO * percentile(candidates.map((candidate) => candidate.sharpness), 0.8));
  const bySharpness = [...candidates].sort((a, b) => b.sharpness - a.sharpness);
  const kept: FrameCandidate[] = [];
  for (const candidate of bySharpness) {
    if (kept.length === max) break;
    if (candidate.sharpness < threshold) break;
    if (!kept.some((other) => isNearDuplicate(other, candidate))) kept.push(candidate);
  }
  if (kept.length === 0) kept.push(bySharpness[0]!);
  return kept.sort((a, b) => a.timeMs - b.timeMs);
}
