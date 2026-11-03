import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat, type ImageRef } from "expo-image-manipulator";

// Au-delà, l'analyse n'y gagne rien et l'envoi est plus lent (le serveur
// ramène de toute façon l'image à 1 600 px).
export const SPOTTER_IMAGE_MAX_EDGE = 1600;

export type ImportResult =
  | { kind: "picked"; uri: string; width: number; height: number }
  | { kind: "cancelled" }
  // Le sélecteur n'a pas pu fournir la photo (iPhone : restée sur iCloud, sans
  // connexion, par exemple), ou elle n'a pas pu être lue : on le dit (lot 4 ter).
  | { kind: "unavailable" };

async function pickPhoto(): Promise<ImagePicker.ImagePickerAsset | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
  return picked.canceled ? null : (picked.assets[0] ?? null);
}

/** Réduit l'image avant l'envoi (une photo d'iPhone pèse souvent 3 à 5 Mo)
 * et l'enregistre en JPEG : un nouveau fichier, dans le cache. */
async function shrinkForSpotter(source: Parameters<typeof ImageManipulator.manipulate>[0], width: number, height: number): Promise<ImportResult> {
  try {
    const context = ImageManipulator.manipulate(source);
    if (width > SPOTTER_IMAGE_MAX_EDGE || height > SPOTTER_IMAGE_MAX_EDGE) {
      context.resize(width >= height ? { width: SPOTTER_IMAGE_MAX_EDGE } : { height: SPOTTER_IMAGE_MAX_EDGE });
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
    return { kind: "picked", uri: saved.uri, width: saved.width, height: saved.height };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Ouvre la photothèque puis réduit la photo avant l'envoi. Web et iPhone.
 * Aucune autorisation n'est demandée (lot 3bis) : le sélecteur du système ne
 * remet à l'app que la photo choisie, sans accès au reste de la photothèque. */
export async function importPhotoForSpotter(): Promise<ImportResult> {
  let asset: ImagePicker.ImagePickerAsset | null;
  try {
    asset = await pickPhoto();
  } catch {
    return { kind: "unavailable" };
  }
  if (!asset) return { kind: "cancelled" };
  return shrinkForSpotter(asset.uri, asset.width, asset.height);
}

/** Image reçue par la feuille de partage d'iOS (lot « partager vers Spotto ») :
 * la même préparation qu'une photo choisie. Taille inconnue : lue sur l'image
 * ouverte une première fois ; déjà assez petite, elle est enregistrée telle
 * quelle (une seule passe). Cette première image est libérée tout de suite
 * après, sans attendre le ramasse-miettes (elle pèse lourd en mémoire). */
export async function prepareSharedPhoto(uri: string, width: number | null, height: number | null): Promise<ImportResult> {
  if (width && height) return shrinkForSpotter(uri, width, height);
  let image: ImageRef | null = null;
  try {
    image = await ImageManipulator.manipulate(uri).renderAsync();
    if (image.width > SPOTTER_IMAGE_MAX_EDGE || image.height > SPOTTER_IMAGE_MAX_EDGE) return await shrinkForSpotter(image, image.width, image.height);
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
    return { kind: "picked", uri: saved.uri, width: saved.width, height: saved.height };
  } catch {
    return { kind: "unavailable" };
  } finally {
    image?.release();
  }
}
