// Site : un navigateur n'a pas accès à la galerie du téléphone — la vidéo se
// choisit avec « Ajouter une vidéo », et la question n'est jamais posée.
// Version app iPhone : latest-video.ts.
import type { GalleryAccess, LatestVideoChoice, LatestVideoState } from "./latest-video-state";

export type { LatestVideo } from "./latest-video-state";

export async function latestVideoSettings(): Promise<{ choice: LatestVideoChoice | null; access: GalleryAccess }> {
  return { choice: null, access: "denied" };
}

export async function loadLatestVideo(): Promise<LatestVideoState> {
  return { kind: "off" };
}

export function saveLatestVideoChoice(): Promise<void> {
  return Promise.reject(new Error("latest_video_unavailable"));
}

export function latestVideoUri(): Promise<string> {
  return Promise.reject(new Error("latest_video_unavailable"));
}
