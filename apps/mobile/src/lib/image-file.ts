import { File } from "expo-file-system";
import { inMemoryImagePart, isDataUri } from "./data-uri";

// Fichier image local à joindre à un envoi — iPhone/Android (version site :
// image-file.web.ts). Le fetch d'Expo (SDK 57) refuse l'objet { uri, name,
// type } de React Native (« Unsupported FormDataPart implementation » :
// AUCUNE photo ne partait de l'iPhone — constaté sur simulateur, lot 3bis).
// Le File d'expo-file-system est un vrai Blob, lu depuis l'adresse locale.
// Image d'un moment trouvé dans une vidéo à partir de son lien (lot « vidéo
// auto ») : une adresse « data: », gardée en mémoire. Elle part telle quelle,
// sans jamais être écrite sur l'appareil : le fetch d'Expo lit tout objet qui
// offre `bytes()`, son nom et son type (comme le File d'expo-file-system).
export async function imageFileFromUri(uri: string): Promise<Blob> {
  if (isDataUri(uri)) {
    const part = inMemoryImagePart(uri);
    if (!part) throw new Error("image_data_unreadable");
    return part as unknown as Blob;
  }
  return new File(uri);
}
