// Dernière vidéo de la galerie, proposée sur l'accueil du Spotter (lot 4 ter,
// app iPhone). Tout se passe sur le téléphone : Spotto lit seulement son
// aperçu et sa durée ; la vidéo n'est ouverte qu'au « Lancer », et la galerie
// n'est jamais modifiée. L'accès aux photos est demandé une seule fois, par
// la fenêtre du système (texte : app.json et locales/*.json) ; avec un accès
// limité, Spotto ne voit que les éléments choisis par la personne.
// Version site : latest-video.web.ts (un navigateur n'a pas accès à la galerie).
import { Platform } from "react-native";
import { Asset, AssetField, MediaType, Query, getPermissionsAsync, requestPermissionsAsync } from "expo-media-library";

export interface LatestVideo {
  /** Identifiant dans la photothèque (« ph://… ») ; il sert aussi d'aperçu (expo-image). */
  id: string;
  durationMs: number | null;
}

/** Accès accordé ? La première fois seulement, la fenêtre du système le
 * demande ; ensuite, la réponse donnée fait foi (modifiable dans Réglages). */
export async function latestVideoAllowed(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  // Lecture seule, vidéos seulement (la distinction ne compte que sur Android).
  const current = await getPermissionsAsync(false, ["video"]);
  if (current.granted) return true;
  if (current.status !== "undetermined" || !current.canAskAgain) return false;
  return (await requestPermissionsAsync(false, ["video"])).granted;
}

/** La vidéo la plus récente que Spotto peut voir, ou null. */
export async function findLatestVideo(): Promise<LatestVideo | null> {
  const [latest] = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.VIDEO)
    .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
    .limit(1)
    .exeForMetadata();
  return latest ? { id: latest.id, durationMs: latest.duration } : null;
}

/** Adresse du fichier, au « Lancer » (téléchargé depuis iCloud si besoin). */
export function latestVideoUri(id: string): Promise<string> {
  return new Asset(id).getUri();
}
