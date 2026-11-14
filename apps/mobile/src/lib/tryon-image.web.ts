// Essayage virtuel photo (site) : l'image produite. Elle arrive en base64
// dans la réponse du serveur (avec son bandeau « Image générée par IA »), et
// devient aussitôt un fichier en mémoire (Blob) : affiché par une adresse
// blob: libérée à la fermeture de la fenêtre, enregistré par un
// téléchargement direct. Décodée ici, jamais par fetch() sur l'adresse
// « data: » : les traces réseau de Sentry gardent les adresses appelées, et
// celle-ci contiendrait l'image. Rien n'est écrit dans le navigateur
// (ni localStorage, ni IndexedDB, ni cache).
// Fichier .web : jamais dans l'app iPhone. Testé (tests/tryon-photo.test.ts).
import { base64Of, isJpegDataUri } from "./tryon-read.web";

/** Le JPEG contenu dans l'adresse « data: » reçue ; null si elle est illisible. */
export function jpegBlobFromDataUri(dataUri: string): Blob | null {
  if (!isJpegDataUri(dataUri)) return null;
  let binary: string;
  try {
    binary = atob(base64Of(dataUri));
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: "image/jpeg" });
}

/** Nom du fichier enregistré : « <produit>-essayage-AAAA-MM-JJ.jpg ». */
export function tryonFileName(base: string, day: string): string {
  return `${base}-${day}.jpg`;
}

/** Téléchargement direct de l'image affichée (adresse blob: déjà créée).
 * Rien n'est ouvert dans un onglet ; aucune action de partage. */
export function downloadImage(url: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
