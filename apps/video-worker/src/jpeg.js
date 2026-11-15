// Découpe du flux d'images JPEG écrit par ffmpeg dans un tuyau (image2pipe,
// mjpeg) : lecture des segments un à un (jamais une simple recherche de
// FFD9, qui peut apparaître dans une table), taille lue dans l'en-tête SOF.
// Une image tronquée (programme arrêté) est ignorée.

/** Début d'image (SOI) suivi d'un marqueur. */
const SOI = Buffer.from([0xff, 0xd8, 0xff]);

/** Marqueurs SOF (début d'image) qui portent la taille : C0 à CF, sauf C4 (DHT), C8 (JPG) et CC (DAC). */
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * @typedef {{ data: Buffer, width: number, height: number }} JpegImage
 */

/**
 * Lit une image JPEG à partir de `start` (sur FFD8).
 * @param {Buffer} buffer
 * @param {number} start
 * @returns {{ end: number, width: number, height: number } | null} `end` exclu ; null si l'image est incomplète ou invalide.
 */
function readJpegAt(buffer, start) {
  let width = 0;
  let height = 0;
  let pos = start + 2;
  while (pos + 1 < buffer.length) {
    if (buffer[pos] !== 0xff) return null;
    // Octets de remplissage (FF FF …) permis avant un marqueur.
    while (pos + 1 < buffer.length && buffer[pos + 1] === 0xff) pos += 1;
    if (pos + 1 >= buffer.length) return null;
    const marker = buffer[pos + 1];
    if (marker === 0xd9) return width > 0 && height > 0 ? { end: pos + 2, width, height } : null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    if (marker === 0xd8 || marker === 0x00) return null;
    if (pos + 3 >= buffer.length) return null;
    const length = buffer.readUInt16BE(pos + 2);
    if (length < 2 || pos + 2 + length > buffer.length) return null;
    if (SOF_MARKERS.has(marker)) {
      if (length < 7) return null;
      height = buffer.readUInt16BE(pos + 5);
      width = buffer.readUInt16BE(pos + 7);
    }
    pos += 2 + length;
    if (marker === 0xda) {
      // Données compressées : jusqu'au prochain vrai marqueur (FF suivi
      // d'autre chose que 00 ou d'un marqueur de reprise D0 à D7).
      for (;;) {
        pos = buffer.indexOf(0xff, pos);
        if (pos < 0 || pos + 1 >= buffer.length) return null;
        const next = buffer[pos + 1];
        if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) break;
        pos += 1;
      }
    }
  }
  return null;
}

/**
 * Toutes les images complètes du flux, dans l'ordre. Les images rendues sont
 * des vues sur `buffer` (rien n'est copié) : effacer `buffer` les efface aussi.
 * @param {Buffer} buffer
 * @returns {JpegImage[]}
 */
export function splitJpegStream(buffer) {
  /** @type {JpegImage[]} */
  const images = [];
  let pos = 0;
  while (pos + 3 < buffer.length) {
    const start = buffer.indexOf(SOI, pos);
    if (start < 0) break;
    const image = readJpegAt(buffer, start);
    if (!image) {
      pos = start + 2;
      continue;
    }
    images.push({ data: buffer.subarray(start, image.end), width: image.width, height: image.height });
    pos = image.end;
  }
  return images;
}

