// Site : un navigateur n'a pas accès à la galerie du téléphone — la vidéo se
// choisit avec « Ajouter une vidéo ». Version app iPhone : latest-video.ts.
import type { LatestVideo } from "./latest-video";

export async function latestVideoAllowed(): Promise<boolean> {
  return false;
}

export async function findLatestVideo(): Promise<LatestVideo | null> {
  return null;
}

export function latestVideoUri(): Promise<string> {
  return Promise.reject(new Error("latest_video_unavailable"));
}
