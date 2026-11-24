// Petites images PNG en niveaux de gris (8 bits, sans filtre), écrites pour les
// tests du contrôle « image noire » de « Spotter ce moment » (retours du
// build 2). Les sommes CRC sont laissées à zéro : le décodeur de l'app
// (src/lib/png-pixels.ts) ne les lit pas. Rien n'est écrit sur disque.
import { zlibSync } from "fflate";

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  return out;
}

/** PNG gris de `width` × `height`, chaque pixel donné par `pixel(x, y)` (0 à 255), en base64. */
export function grayPngBase64(width: number, height: number, pixel: (x: number, y: number) => number): string {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 0, 0, 0, 0], 8);
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x += 1) raw[y * (width + 1) + 1 + x] = pixel(x, y);
  }
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlibSync(raw)), chunk("IEND", new Uint8Array(0))];
  return Buffer.from(Buffer.concat(parts)).toString("base64");
}
