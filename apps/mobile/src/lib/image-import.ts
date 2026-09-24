import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

// Au-delà, l'analyse n'y gagne rien et l'envoi est plus lent (le serveur
// ramène de toute façon l'image à 1 600 px).
const MAX_EDGE = 1600;

export type ImportResult =
  | { kind: "picked"; uri: string; width: number; height: number }
  | { kind: "cancelled" }
  | { kind: "denied" };

/** Ouvre la photothèque puis réduit la photo avant l'envoi (une photo
 * d'iPhone pèse souvent 3 à 5 Mo). Web et iPhone. */
export async function importPhotoForSpotter(): Promise<ImportResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { kind: "denied" };

  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
  const asset = picked.canceled ? null : picked.assets[0];
  if (!asset) return { kind: "cancelled" };

  const { width, height } = asset;
  const context = ImageManipulator.manipulate(asset.uri);
  if (width > MAX_EDGE || height > MAX_EDGE) {
    context.resize(width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  return { kind: "picked", uri: saved.uri, width: saved.width, height: saved.height };
}
