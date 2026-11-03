import { useState } from "react";
import { useRouter } from "expo-router";
import { adoptSpotVideo, importSpotVideo, videoImportMessage, type VideoImport } from "./spot-video";

/** « Ajouter une vidéo » (Spotter, lien collé) : choix dans le sélecteur du
 * système, puis l'écran unique — aperçu, quelques mots, « Lancer » (lot 4 ter).
 * Une vidéo partagée depuis une autre app suit le même chemin, avec les mêmes
 * contrôles (lot « partager vers Spotto »). `onMessage` reçoit le message clair
 * d'un refus (trop longue, trop lourde, illisible, indisponible). */
export function useVideoImport(onMessage: (message: string | null) => void) {
  const router = useRouter();
  const [importing, setImporting] = useState(false);

  async function run(importer: () => Promise<VideoImport>) {
    onMessage(null);
    setImporting(true);
    try {
      const result = await importer();
      if (result.kind !== "ready") {
        onMessage(videoImportMessage(result));
        return;
      }
      router.push({ pathname: "/spot/lancer", params: { source: "video" } });
    } finally {
      setImporting(false);
    }
  }

  return {
    importing,
    importVideo: () => run(importSpotVideo),
    /** Copie reçue, rangée dans le cache de Spotto : effacée si elle est refusée, et après usage. */
    importSharedVideo: (uri: string, sizeBytes: number | null) => run(() => adoptSpotVideo(uri, sizeBytes, "share")),
  };
}
