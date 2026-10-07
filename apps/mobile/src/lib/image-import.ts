import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

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

/** Ouvre la photothèque puis réduit la photo avant l'envoi (une photo
 * d'iPhone pèse souvent 3 à 5 Mo). Web et iPhone. Aucune autorisation
 * n'est demandée (lot 3bis) : le sélecteur du système ne remet à l'app que
 * la photo choisie, sans accès au reste de la photothèque. */
export async function importPhotoForSpotter(): Promise<ImportResult> {
  let asset: ImagePicker.ImagePickerAsset | null;
  try {
    asset = await pickPhoto();
  } catch {
    return { kind: "unavailable" };
  }
  if (!asset) return { kind: "cancelled" };
  try {
    const { width, height } = asset;
    const context = ImageManipulator.manipulate(asset.uri);
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
