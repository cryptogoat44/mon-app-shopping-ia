import { parseImageDataUri } from "./data-uri";

// Fichier image à joindre à un envoi — site (version iPhone : image-file.ts).
// Le sélecteur de photos renvoie une adresse blob:/data: ; le FormData du
// navigateur n'accepte qu'un vrai fichier. Une image en « data: » (moment
// d'une vidéo trouvé à partir de son lien, lot « vidéo auto ») est lue en
// mémoire, sans requête ni adresse « blob: » à oublier ensuite.
export async function imageFileFromUri(uri: string): Promise<Blob> {
  const inline = parseImageDataUri(uri);
  if (inline) return new Blob([inline.bytes as Uint8Array<ArrayBuffer>], { type: inline.type });
  return (await fetch(uri)).blob();
}
