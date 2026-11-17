// Petites images JPEG factices (en-tête seulement : SOI, APP0, SOF0 avec la
// taille, EOI) pour les tests du lot « vidéo auto ». Rien n'est lu ni écrit sur disque.

export function jpegBytes(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ]);
}

/** « data:image/jpeg;base64,… » d'une image de cette taille. */
export function jpegDataUri(width: number, height: number): string {
  return `data:image/jpeg;base64,${Buffer.from(jpegBytes(width, height)).toString("base64")}`;
}
