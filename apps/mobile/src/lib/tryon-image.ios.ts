// Essayage virtuel photo, app iPhone : « Enregistrer l'image ». L'image
// produite arrive du serveur en base64, avec son bandeau « Image générée par
// IA » et sa mention IPTC (XMP), gardés tels quels. Pour l'ajouter à la
// photothèque, iOS demande un fichier : il est écrit dans le dossier de
// l'essayage (lib/tryon-files.ios.ts), remis à Photos, puis effacé aussitôt,
// même en cas d'échec. Autorisation demandée : l'ajout seulement (« ajouter
// des photos »), jamais la lecture de la photothèque ; iOS la demande au
// premier appui, avec le texte de app.json (savePhotosPermission). L'image
// affichée vient de la mémoire : rien d'autre n'est écrit. Version site :
// tryon-image.web.ts (téléchargement direct), dont le nom de fichier est repris.
// Imports relatifs : fichier testé par vitest (tests/tryon-iphone.test.ts).
import { Asset, requestPermissionsAsync } from "expo-media-library";
import { base64Of, isJpegDataUri } from "./tryon-read.ios";
import { discardTryonFile, tryonTempFile } from "./tryon-files.ios";

export { tryonFileName } from "./tryon-image.web";

/** `denied` : l'ajout à la photothèque est refusé dans les Réglages. */
export type SaveOutcome = "saved" | "denied" | "failed";

/** Ajoute l'image produite à la photothèque. `fileName` finit par « .jpg »
 * (Photos reconnaît le type au nom du fichier). */
export async function saveImageToPhotos(dataUri: string, fileName: string): Promise<SaveOutcome> {
  if (!isJpegDataUri(dataUri)) return "failed";
  try {
    // Accès « ajout seulement » d'iOS : la photothèque n'est jamais lue.
    const permission = await requestPermissionsAsync(true);
    if (!permission.granted) return "denied";
  } catch {
    return "failed";
  }
  let uri: string | null = null;
  try {
    const file = tryonTempFile(fileName);
    uri = file.uri;
    file.write(base64Of(dataUri), { encoding: "base64" });
    await Asset.create(file.uri);
    return "saved";
  } catch {
    return "failed";
  } finally {
    // Photos a sa propre copie : le fichier temporaire ne sert plus.
    discardTryonFile(uri);
  }
}
