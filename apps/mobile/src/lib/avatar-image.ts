import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { PixelCrop } from "./avatar-crop";
import { AVATAR_UPLOAD_SIDE, type PickedImage } from "./avatar-photo";

// Photo de profil recadrée SUR L'APPAREIL (lot « profil et icône des
// réglages ») : le carré choisi, ramené à 1 024 px au plus et enregistré en
// JPEG — un nouveau fichier, dans le cache (iPhone) ou en mémoire (site).
// C'est ici qu'une photo HEIC d'iPhone devient un JPEG : le serveur ne sait
// pas lire le HEIC. Le serveur refait ensuite le carré en 512 px et retire
// toutes les métadonnées.

/** Adresse du JPEG prêt à envoyer ; null si l'image n'a pas pu être traitée. */
export async function renderAvatarCrop(image: PickedImage, crop: PixelCrop): Promise<string | null> {
  try {
    const context = ImageManipulator.manipulate(image.uri);
    context.crop(crop);
    const side = Math.min(AVATAR_UPLOAD_SIDE, crop.width);
    context.resize({ width: side, height: side });
    const rendered = await context.renderAsync();
    try {
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
      return saved.uri;
    } finally {
      rendered.release();
    }
  } catch {
    return null;
  }
}
