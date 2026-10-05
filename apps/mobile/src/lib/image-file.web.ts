// Fichier image à joindre à un envoi — site (version iPhone : image-file.ts).
// Le sélecteur de photos renvoie une adresse blob:/data: ; le FormData du
// navigateur n'accepte qu'un vrai fichier.
export async function imageFileFromUri(uri: string): Promise<Blob> {
  return (await fetch(uri)).blob();
}
