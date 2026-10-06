import { useState } from "react";
import { useRouter } from "expo-router";
import { fetchVideoAiEnabled } from "./api";
import { importSpotVideo, videoImportMessage } from "./spot-video";

/** Analyse automatique active sur le serveur ? Serveur injoignable : non —
 * le choix de l'image au curseur fonctionne sans lui. */
async function videoAiEnabled(): Promise<boolean> {
  try {
    return await fetchVideoAiEnabled();
  } catch {
    return false;
  }
}

/** Importer une vidéo (Spotter, aperçu d'un lien, résultat), puis ouvrir
 * l'analyse automatique si elle est active (lot 4, temps 1 bis), sinon le
 * choix de l'image au curseur (temps 1). `onMessage` reçoit le message clair
 * d'un refus (trop longue, trop lourde, illisible, indisponible). */
export function useVideoImport(onMessage: (message: string | null) => void) {
  const router = useRouter();
  const [importing, setImporting] = useState(false);

  async function importVideo(query?: string) {
    onMessage(null);
    setImporting(true);
    try {
      const result = await importSpotVideo();
      if (result.kind !== "ready") {
        onMessage(videoImportMessage(result));
        return;
      }
      if (await videoAiEnabled()) router.push({ pathname: "/spot/video-auto", params: query ? { query } : {} });
      else router.push("/spot/video");
    } finally {
      setImporting(false);
    }
  }

  return { importing, importVideo };
}
