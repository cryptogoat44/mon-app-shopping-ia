// Dernière vidéo de la galerie (app iPhone) — option décrite dans
// latest-video-state.ts. Aucune demande d'accès aux photos tant que la
// personne n'a pas répondu « oui » ; ensuite, la fenêtre d'iOS (texte :
// app.json et locales/*.json) n'apparaît qu'une fois. Spotto lit l'aperçu et
// la durée de la seule vidéo la plus récente ; elle n'est ouverte qu'au
// « Lancer », et la galerie n'est jamais modifiée.
// Version site : latest-video.web.ts (un navigateur n'a pas accès à la galerie).
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Asset, AssetField, MediaType, Query, getPermissionsAsync, requestPermissionsAsync } from "expo-media-library";
import {
  galleryAccessFrom,
  latestVideoChoiceKey,
  parseLatestVideoChoice,
  type GalleryAccess,
  type LatestVideo,
  type LatestVideoChoice,
  type LatestVideoState,
} from "./latest-video-state";

export type { LatestVideo } from "./latest-video-state";

/** Accès actuel, sans rien demander (vidéos seulement : la distinction ne compte que sur Android). */
async function currentAccess(): Promise<GalleryAccess> {
  return galleryAccessFrom(await getPermissionsAsync(false, ["video"]));
}

/** La vidéo la plus récente de la galerie, ou null. */
async function findLatestVideo(): Promise<LatestVideo | null> {
  const [latest] = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.VIDEO)
    .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
    .limit(1)
    .exeForMetadata();
  return latest ? { id: latest.id, durationMs: latest.duration } : null;
}

/** Réglages : la réponse donnée et l'accès accordé par iOS, sans rien demander. */
export async function latestVideoSettings(userId: string): Promise<{ choice: LatestVideoChoice | null; access: GalleryAccess }> {
  const [stored, access] = await Promise.all([AsyncStorage.getItem(latestVideoChoiceKey(userId)), currentAccess()]);
  return { choice: parseLatestVideoChoice(stored), access };
}

/** Ce que Spotter montre. L'accès n'est demandé à iOS qu'après un « oui ». */
export async function loadLatestVideo(userId: string | null): Promise<LatestVideoState> {
  if (Platform.OS !== "ios" || !userId) return { kind: "off" };
  const choice = parseLatestVideoChoice(await AsyncStorage.getItem(latestVideoChoiceKey(userId)));
  if (choice === null) return { kind: "ask" };
  if (choice === "no") return { kind: "off" };
  let access = await currentAccess();
  if (access === "undetermined") access = galleryAccessFrom(await requestPermissionsAsync(false, ["video"]));
  if (access !== "full") return { kind: "no_access", access: access === "limited" ? "limited" : "denied" };
  const video = await findLatestVideo();
  return video ? { kind: "ready", video } : { kind: "none" };
}

/** Enregistre la réponse (sur l'appareil, pour ce compte). Après un « oui »,
 * le chargement suivant (loadLatestVideo) fait demander l'accès par iOS. */
export async function saveLatestVideoChoice(userId: string, choice: LatestVideoChoice): Promise<void> {
  await AsyncStorage.setItem(latestVideoChoiceKey(userId), choice);
}

/** Adresse du fichier, au « Lancer » (téléchargé depuis iCloud si besoin). */
export function latestVideoUri(id: string): Promise<string> {
  return new Asset(id).getUri();
}
