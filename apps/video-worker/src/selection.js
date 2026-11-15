// Choix des images rendues : parmi les images candidates (une toutes les
// 0,5 s au moins, 40 au plus), garder 6 à 16 images nettes, différentes les
// unes des autres et réparties sur toute la vidéo. Logique pure, testée.
//
// Mêmes mesures que l'étage 1 de l'app (apps/mobile/src/lib/video-stage1.ts
// et frame-sample.ts), recopiées ici pour que le service reste sans
// dépendance : netteté (variance du laplacien), empreinte dHash de 64 bits et
// couleurs moyennes de 3 × 3 zones, sur une petite image de 96 × 96 px
// fournie par ffmpeg (rouge-vert-bleu, 3 octets par pixel).

/** Côté de la petite image examinée. */
export const SCORING_EDGE = 96;
export const SCORING_BYTES = SCORING_EDGE * SCORING_EDGE * 3;
/** Floue : moins de 40 % de la netteté des meilleures images de la vidéo. */
const BLUR_RATIO = 0.4;
/** Image unie (écran noir, transition) : aucune netteté exploitable. */
export const MIN_SHARPNESS = 2;
/** Quasi-doublon : empreintes différentes sur 6 bits au plus (sur 64)… */
const DUPLICATE_DISTANCE = 6;
/** … ET couleurs proches dans chacune des 9 zones (≤ 12 sur 255). */
const DUPLICATE_COLOR = 12;
/** Écart de luminosité (sur 255) sous lequel deux cases voisines sont égales. */
const HASH_TOLERANCE = 2;
const ZONES = 3;

/**
 * @typedef {object} FrameScore
 * @property {number} sharpness
 * @property {string} hash Empreinte de 64 bits (« 0 » et « 1 »).
 * @property {number[]} colors Couleurs moyennes (rouge, vert, bleu) des 9 zones.
 */

/**
 * Mesures d'une petite image rouge-vert-bleu.
 * @param {Uint8Array} rgb
 * @param {number} [width]
 * @param {number} [height]
 * @returns {FrameScore}
 */
export function scoreFrame(rgb, width = SCORING_EDGE, height = SCORING_EDGE) {
  const gray = new Uint8Array(width * height);
  const sums = new Float64Array(ZONES * ZONES * 3);
  const counts = new Float64Array(ZONES * ZONES);
  for (let pixel = 0; pixel < gray.length; pixel += 1) {
    const base = pixel * 3;
    const red = rgb[base] ?? 0;
    const green = rgb[base + 1] ?? 0;
    const blue = rgb[base + 2] ?? 0;
    gray[pixel] = Math.round(0.299 * red + 0.587 * green + 0.114 * blue);
    const zone = Math.min(ZONES - 1, Math.floor((Math.floor(pixel / width) * ZONES) / height)) * ZONES + Math.min(ZONES - 1, Math.floor(((pixel % width) * ZONES) / width));
    sums[zone * 3] += red;
    sums[zone * 3 + 1] += green;
    sums[zone * 3 + 2] += blue;
    counts[zone] += 1;
  }
  const colors = Array.from(sums, (sum, index) => Math.round(sum / Math.max(1, counts[Math.floor(index / 3)])));
  return { sharpness: sharpness(gray, width, height), hash: differenceHash(gray, width, height), colors };
}

/** Netteté : variance du laplacien (bords francs → valeur élevée). */
export function sharpness(/** @type {Uint8Array} */ gray, /** @type {number} */ width, /** @type {number} */ height) {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const laplacian = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += laplacian;
      sumSquares += laplacian * laplacian;
      count += 1;
    }
  }
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

/** Empreinte « dHash » : image réduite à 9 × 8 cases ; chaque bit dit si une
 * case est nettement plus claire que sa voisine de gauche. */
export function differenceHash(/** @type {Uint8Array} */ gray, /** @type {number} */ width, /** @type {number} */ height) {
  const cells = [];
  for (let row = 0; row < 8; row += 1) {
    const top = Math.floor((row * height) / 8);
    const bottom = Math.min(height, Math.max(top + 1, Math.floor(((row + 1) * height) / 8)));
    for (let column = 0; column < 9; column += 1) {
      const left = Math.floor((column * width) / 9);
      const right = Math.min(width, Math.max(left + 1, Math.floor(((column + 1) * width) / 9)));
      let total = 0;
      for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) total += gray[y * width + x];
      cells.push(total / ((right - left) * (bottom - top)));
    }
  }
  let hash = "";
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) hash += cells[row * 9 + column + 1] - cells[row * 9 + column] > HASH_TOLERANCE ? "1" : "0";
  }
  return hash;
}

export function hammingDistance(/** @type {string} */ a, /** @type {string} */ b) {
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) distance += 1;
  return distance;
}

/** Plus grand écart de couleur entre deux images, zone par zone. */
export function colorDifference(/** @type {number[]} */ a, /** @type {number[]} */ b) {
  let largest = 0;
  for (let zone = 0; zone * 3 < a.length; zone += 1) {
    let squares = 0;
    for (let channel = 0; channel < 3; channel += 1) squares += ((a[zone * 3 + channel] ?? 0) - (b[zone * 3 + channel] ?? 0)) ** 2;
    largest = Math.max(largest, Math.sqrt(squares));
  }
  return largest;
}

/** Même forme et mêmes couleurs : deux images du même plan. */
export function isNearDuplicate(/** @type {FrameScore} */ a, /** @type {FrameScore} */ b) {
  return hammingDistance(a.hash, b.hash) <= DUPLICATE_DISTANCE && colorDifference(a.colors, b.colors) <= DUPLICATE_COLOR;
}

/** Valeur au rang `ratio` (0 à 1) d'une liste de nombres. */
function percentile(/** @type {number[]} */ values, /** @type {number} */ ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(ratio * sorted.length))] ?? 0;
}

/**
 * @template {FrameScore & { timeSeconds: number }} T
 * @param {readonly T[]} candidates
 * @param {{ minFrames: number, maxFrames: number }} limits
 * @returns {T[]} Images gardées, dans l'ordre du temps.
 *
 * 1. Nettes : au moins 40 % de la netteté des meilleures (80e centile) ;
 * 2. réparties : la vidéo est coupée en `maxFrames` tranches égales, et la
 *    plus nette de chaque tranche est gardée si elle n'est pas un
 *    quasi-doublon d'une image déjà gardée ;
 * 3. complétées : les plus nettes qui restent, sans quasi-doublon ;
 * 4. au moins `minFrames` (si la vidéo en a assez) : une vidéo presque fixe
 *    n'offre parfois que 2 ou 3 images vraiment différentes ; on ajoute
 *    alors les images les plus éloignées dans le temps de celles déjà
 *    gardées (d'abord celles qui ne sont pas unies).
 */
export function selectFrames(candidates, { minFrames, maxFrames }) {
  if (candidates.length === 0 || maxFrames <= 0) return [];
  const threshold = Math.max(MIN_SHARPNESS, BLUR_RATIO * percentile(candidates.map((candidate) => candidate.sharpness), 0.8));
  const good = candidates.filter((candidate) => candidate.sharpness >= threshold);
  /** @type {T[]} */
  const kept = [];
  const isNew = (/** @type {T} */ candidate) => !kept.includes(candidate) && !kept.some((other) => isNearDuplicate(other, candidate));

  // 2. Une par tranche de temps.
  const first = Math.min(...candidates.map((candidate) => candidate.timeSeconds));
  const last = Math.max(...candidates.map((candidate) => candidate.timeSeconds));
  const span = Math.max(last - first, 1e-6);
  for (let slice = 0; slice < maxFrames; slice += 1) {
    const from = first + (slice * span) / maxFrames;
    const to = first + ((slice + 1) * span) / maxFrames;
    const inSlice = good
      .filter((candidate) => candidate.timeSeconds >= from && (slice === maxFrames - 1 ? candidate.timeSeconds <= to : candidate.timeSeconds < to))
      .sort((a, b) => b.sharpness - a.sharpness);
    const chosen = inSlice.find(isNew);
    if (chosen) kept.push(chosen);
  }

  // 3. Les plus nettes qui restent.
  for (const candidate of [...good].sort((a, b) => b.sharpness - a.sharpness)) {
    if (kept.length >= maxFrames) break;
    if (isNew(candidate)) kept.push(candidate);
  }

  // 4. Le minimum, si la vidéo est presque fixe.
  const target = Math.min(minFrames, maxFrames, candidates.length);
  while (kept.length < target) {
    const rest = candidates.filter((candidate) => !kept.includes(candidate));
    const textured = rest.filter((candidate) => candidate.sharpness >= MIN_SHARPNESS);
    const pool = textured.length > 0 ? textured : rest;
    let best = pool[0];
    let bestGap = -1;
    for (const candidate of pool) {
      const gap = kept.length === 0 ? candidate.sharpness : Math.min(...kept.map((other) => Math.abs(other.timeSeconds - candidate.timeSeconds)));
      if (gap > bestGap || (gap === bestGap && candidate.sharpness > best.sharpness)) {
        best = candidate;
        bestGap = gap;
      }
    }
    kept.push(best);
  }
  return kept.sort((a, b) => a.timeSeconds - b.timeSeconds);
}
