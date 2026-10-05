import { File } from "expo-file-system";

// Fichier image local à joindre à un envoi — iPhone/Android (version site :
// image-file.web.ts). Le fetch d'Expo (SDK 57) refuse l'objet { uri, name,
// type } de React Native (« Unsupported FormDataPart implementation » :
// AUCUNE photo ne partait de l'iPhone — constaté sur simulateur, lot 3bis).
// Le File d'expo-file-system est un vrai Blob, lu depuis l'adresse locale.
export async function imageFileFromUri(uri: string): Promise<Blob> {
  return new File(uri);
}
