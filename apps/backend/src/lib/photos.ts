import sharp from "sharp";
import { ImageSourceError } from "./imageProcessing.js";

// Photos envoyées par les utilisateurs (publications, Vault, avatar) —
// lot « images et fluidité ». Une photo d'iPhone pèse 3 à 4 Mo (3024 × 4032) :
// affichée telle quelle, elle alourdissait le fil (mesure : 9 Mo pour 7
// publications). On l'enregistre redimensionnée, en gardant la netteté :
// - « affichage » : 1 600 px sur le grand côté — plus que les 1 170 px d'un
//   écran d'iPhone en pleine largeur (390 points × 3) ;
// - « miniature » : 480 px, pour les grilles (≈ 320 px nécessaires) ;
// - avatar : 512 px.
// sharp retire aussi les métadonnées (dont la position GPS des photos).
export const PHOTO_SIZES = { display: 1600, thumb: 480, avatar: 512 } as const;

export async function optimizePhoto(input: Buffer, maxSide: number, quality = 82): Promise<Buffer> {
  try {
    return await sharp(input, { failOn: "error" })
      .rotate() // orientation EXIF appliquée avant de retirer les métadonnées
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new ImageSourceError("Image illisible");
  }
}
