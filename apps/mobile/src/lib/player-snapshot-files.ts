// Instantanés du lecteur (« Spotter ce moment », mission « liens vidéo ») : le
// module natif les écrit dans le sous-dossier « lecteur-instantane/ » du
// cache (module natif local, modules/spotto-player-snapshot/ios).
// Le brouillon qui en utilise un vit en mémoire seulement : au lancement de
// l'app, aucun n'est donc en cours, et tout ce qui reste dans ce dossier (app
// fermée en plein parcours, recherche abandonnée) est effacé (revue de
// sécurité, règle n° 4). Version site : player-snapshot-files.web.ts.
import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";

/** Sous-dossier du cache des instantanés (même nom que dans le Swift). */
export const PLAYER_SNAPSHOT_FOLDER = "lecteur-instantane";

/** Au lancement : efface tous les instantanés laissés la fois précédente. */
export function clearPlayerSnapshots(): void {
  if (Platform.OS !== "ios") return;
  try {
    const folder = new Directory(Paths.cache, PLAYER_SNAPSHOT_FOLDER);
    if (!folder.exists) return;
    for (const entry of folder.list()) {
      try {
        if (entry instanceof File) entry.delete();
      } catch {
        // Effacement refusé : on passe au suivant.
      }
    }
  } catch {
    // Dossier indisponible : rien à effacer.
  }
}
