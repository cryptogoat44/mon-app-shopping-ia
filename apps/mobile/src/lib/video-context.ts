// Recherches associées à une vidéo TikTok ou Instagram (mission « liens
// vidéo »), vu de l'app :
// - le lien reçu reste « en attente » 10 minutes (lib/pending-video-link.ts,
//   stockage AsyncStorage) ;
// - une recherche d'image lancée hors du lecteur pendant ce temps lui est
//   associée (source « share », « visual_intelligence », « app » ou « web ») ;
// - après une recherche terminée avec des résultats, le spot est noté
//   (POST /api/video-links/spots ; mémoire absente côté serveur : ignoré) et
//   le lien en attente est oublié ;
// - l'image à ne pas garder (instantané du lecteur, capture de la recherche
//   d'image d'iOS) est effacée dès que la recherche est partie, ou quand le
//   parcours est abandonné (règle n° 4 : jamais gardée sur l'appareil).
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ProductSearch, VideoSpotSource } from "@monapp/shared-types";
import { recordVideoSpot } from "./api";
import { createPendingLinkStore, type PendingVideoLink } from "./pending-video-link";
import { beginFromPhoto } from "./spot-flow";
import { discardSearchedImage, getDraft, setDraftImageDiscarder, updateDraft, type DraftVideoContext, type SpotDraft } from "./spot-draft";
import { onSearchShown } from "./spot-identify";
import { discardLocalFile } from "./video-frames";

export const pendingVideoLinks = createPendingLinkStore(AsyncStorage, () => Date.now());

/** D'où vient une image cherchée hors du lecteur. */
export type PhotoOrigin = Extract<VideoSpotSource, "share" | "visual_intelligence" | "app" | "web">;

export function contextFromPending(pending: PendingVideoLink, source: VideoSpotSource): DraftVideoContext {
  return { url: pending.url, platform: pending.platform, creatorHandle: pending.creatorHandle, source, momentSeconds: null };
}

/** Image prête (photo choisie, image partagée, capture de la recherche
 * d'image d'iOS, image déposée sur le site) : le brouillon, associé au lien
 * en attente s'il y en a un. */
export async function beginPhotoSearch(
  picked: { uri: string; width: number; height: number },
  origin: PhotoOrigin,
  options: { discardImageAfterSearch?: boolean } = {}
): Promise<SpotDraft> {
  const pending = await pendingVideoLinks.read();
  return beginFromPhoto(picked.uri, { width: picked.width, height: picked.height }, {
    video: pending ? contextFromPending(pending, origin) : null,
    discardImageAfterSearch: options.discardImageAfterSearch ?? false,
  });
}

/** La croix de « Associée à la vidéo… » : la recherche n'est plus associée, et le lien est oublié. */
export async function detachVideoFromDraft(): Promise<void> {
  updateDraft({ video: null });
  await pendingVideoLinks.clear();
}

/** Recherche terminée avec des résultats : la mémoire collective peut en garder la trace. */
export function spotWorthRecording(search: ProductSearch): boolean {
  return search.status === "completed" && search.matches.length > 0;
}

function onShown(draft: SpotDraft, search: ProductSearch): void {
  // L'image est partie avec la recherche : elle n'a plus rien à faire sur l'appareil.
  discardSearchedImage(draft);
  const video = draft.video;
  if (!video || !spotWorthRecording(search)) return;
  void recordVideoSpot({ url: video.url, searchId: search.id, source: video.source, momentSeconds: video.momentSeconds })
    // 404 « video_memory_unavailable » (migration absente), réseau… : rien à dire à la personne.
    .catch(() => undefined);
  void pendingVideoLinks.clear();
}

// Branché une fois, dès que ce fichier est chargé (Spotter, écran vidéo,
// « Entourez la pièce » : toujours avant la première recherche).
setDraftImageDiscarder(discardLocalFile);
onSearchShown(onShown);

/** La vidéo associée au brouillon en cours (« Entourez la pièce »). */
export function draftVideo(): DraftVideoContext | null {
  return getDraft()?.video ?? null;
}
