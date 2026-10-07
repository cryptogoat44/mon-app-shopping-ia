import { useState } from "react";
import { useRouter } from "expo-router";
import { importSpotVideo, videoImportMessage } from "./spot-video";

/** « Ajouter une vidéo » (Spotter, lien collé) : choix dans le sélecteur du
 * système, puis l'écran unique — aperçu, quelques mots, « Lancer » (lot 4 ter).
 * `onMessage` reçoit le message clair d'un refus (trop longue, trop lourde,
 * illisible, indisponible). */
export function useVideoImport(onMessage: (message: string | null) => void) {
  const router = useRouter();
  const [importing, setImporting] = useState(false);

  async function importVideo() {
    onMessage(null);
    setImporting(true);
    try {
      const result = await importSpotVideo();
      if (result.kind !== "ready") {
        onMessage(videoImportMessage(result));
        return;
      }
      router.push({ pathname: "/spot/lancer", params: { source: "video" } });
    } finally {
      setImporting(false);
    }
  }

  return { importing, importVideo };
}
