// Essayage virtuel photo, app iPhone : les fichiers temporaires. La photo de
// la personne et l'image à enregistrer n'existent sur l'iPhone que le temps
// de servir, dans un seul dossier du cache réservé à l'essayage : copie
// remise par le sélecteur ou l'appareil photo, JPEG converti, fichier remis à
// Photos par « Enregistrer l'image ». Chacun est effacé dès qu'il ne sert
// plus, même après un échec ou une annulation (même règle que les copies
// d'une vidéo, lib/video-frames.ts). Le dossier entier est vidé à l'ouverture
// et à la fermeture de la fenêtre de l'essayage : les restes d'une app fermée
// de force disparaissent aussi. Rien n'est jamais effacé hors du cache de
// l'app (lib/local-files.ts), rien n'est gardé ailleurs (ni AsyncStorage, ni
// photothèque sans « Enregistrer l'image »).
// Imports relatifs : fichier testé par vitest (tests/tryon-iphone.test.ts).
import { Directory, File, Paths } from "expo-file-system";
import { isOwnCacheFile } from "./local-files";

/** Dossier du cache réservé à l'essayage (Library/Caches/tryon de l'app). */
const DIRECTORY_NAME = "tryon";

function tryonDirectory(): Directory {
  return new Directory(Paths.cache, DIRECTORY_NAME);
}

function isInCache(uri: string): boolean {
  return isOwnCacheFile(uri, Paths.cache.uri);
}

/** Range dans le dossier de l'essayage un fichier qu'un module d'Expo vient
 * d'écrire ailleurs dans le cache (sélecteur, conversion), pour que le
 * vidage du dossier l'emporte aussi ; renvoie sa nouvelle adresse. Rangement
 * impossible : le fichier reste où il est, et il sera effacé de là. */
export function keepInTryonDirectory(uri: string): string {
  if (!isInCache(uri)) return uri;
  try {
    const directory = tryonDirectory();
    directory.create({ intermediates: true, idempotent: true });
    const file = new File(uri);
    file.moveSync(directory);
    return file.uri;
  } catch {
    return uri;
  }
}

/** Nouveau fichier dans le dossier de l'essayage (créé au besoin). */
export function tryonTempFile(name: string): File {
  const directory = tryonDirectory();
  directory.create({ intermediates: true, idempotent: true });
  return new File(directory, name);
}

/** Efface un fichier de l'essayage ; silencieux s'il n'existe plus. */
export function discardTryonFile(uri: string | null | undefined): void {
  if (!uri || !isInCache(uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Déjà effacé (dossier vidé entre-temps, ou par le système) : rien à faire.
  }
}

/** Vide le dossier de l'essayage (ouverture et fermeture de la fenêtre). */
export function sweepTryonFiles(): void {
  try {
    const directory = tryonDirectory();
    if (directory.exists) directory.delete();
  } catch {
    // Dossier déjà effacé : rien à faire.
  }
}
