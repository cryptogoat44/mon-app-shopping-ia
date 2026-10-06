// Vidéo importée dans le Spotter (lot 4), gardée en mémoire le temps du
// choix de l'image, comme le brouillon. Elle n'est jamais envoyée ni
// conservée : libérée (copie effacée sur iPhone) dès qu'on quitte l'écran de
// choix. Seule l'image choisie part, comme une photo : même recherche, même
// coût (aucun crédit de plus).
import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { t } from "../i18n";
import { track } from "./analytics";
import { SPOTTER_IMAGE_MAX_EDGE } from "./image-import";
import { beginFromPhoto } from "./spot-flow";
import type { SpotDraft } from "./spot-draft";
import { discardLocalFile, openVideo } from "./video-frames";
import { durationSeconds, formatClock, megabytes, VIDEO_MAX_BYTES, videoRejection, type OpenedVideo, type VideoRejection } from "./video-timeline";

/** Photothèque (app iPhone) ou fichier choisi dans le navigateur (site). */
const SOURCE = Platform.OS === "web" ? "file" : "library";

let current: OpenedVideo | null = null;

export function getSpotVideo(): OpenedVideo | null {
  return current;
}

/** Libère la vidéo en cours (à la sortie de l'écran de choix). */
export function releaseSpotVideo(): void {
  current?.release();
  current = null;
}

// Écrans qui ont besoin de la vidéo (analyse automatique, choix de l'image) :
// chacun la garde ouverte tant qu'il est affiché ou empilé ; le dernier à
// partir la libère (copie effacée sur iPhone). Ainsi, après l'identification,
// « Essayer un autre moment » et le curseur restent possibles.
let holders = 0;

export function holdSpotVideo(): void {
  holders += 1;
}

export function letGoSpotVideo(): void {
  holders = Math.max(0, holders - 1);
  if (holders === 0) releaseSpotVideo();
}

export type VideoImport =
  | { kind: "ready" }
  | { kind: "cancelled" }
  // Le sélecteur n'a pas pu fournir la vidéo (iPhone : restée sur iCloud, sans connexion, par exemple).
  | { kind: "unavailable" }
  | { kind: "rejected"; reason: VideoRejection; durationMs: number | null; sizeBytes: number | null };

async function pickVideo(): Promise<ImagePicker.ImagePickerAsset | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["videos"],
    // iPhone : la vidéo d'origine, sans recompression (HEVC compris) ; c'est
    // plus rapide, et l'extraction des images sait la lire.
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
  });
  return picked.canceled ? null : (picked.assets[0] ?? null);
}

function rejected(reason: VideoRejection, durationMs: number | null, sizeBytes: number | null): VideoImport {
  track("video_rejected", { reason, source: SOURCE, duration_s: durationMs === null ? undefined : durationSeconds(durationMs) });
  return { kind: "rejected", reason, durationMs, sizeBytes };
}

/** Choix d'une vidéo, contrôle des limites (60 s, 100 Mo), ouverture. */
export async function importSpotVideo(): Promise<VideoImport> {
  let asset: ImagePicker.ImagePickerAsset | null;
  try {
    asset = await pickVideo();
  } catch {
    return { kind: "unavailable" };
  }
  if (!asset) return { kind: "cancelled" };
  const sizeBytes = asset.fileSize ?? null;
  if (sizeBytes !== null && sizeBytes > VIDEO_MAX_BYTES) {
    discardLocalFile(asset.uri);
    return rejected("too_large", null, sizeBytes);
  }
  let video: OpenedVideo;
  try {
    video = await openVideo(asset.uri);
  } catch {
    discardLocalFile(asset.uri);
    return rejected("unreadable", null, sizeBytes);
  }
  const rejection = videoRejection({ durationMs: video.durationMs, sizeBytes });
  if (rejection) {
    video.release();
    return rejected(rejection, video.durationMs, sizeBytes);
  }
  releaseSpotVideo();
  current = video;
  track("video_imported", { duration_s: durationSeconds(video.durationMs), source: SOURCE });
  return { kind: "ready" };
}

/** Message clair quand la vidéo est refusée ou indisponible ; aucun si elle est prête ou si le choix est annulé. */
export function videoImportMessage(result: VideoImport): string | null {
  if (result.kind === "unavailable") return t.video.unavailable;
  if (result.kind !== "rejected") return null;
  if (result.reason === "too_large" && result.sizeBytes !== null) return t.video.tooLarge(megabytes(result.sizeBytes));
  if (result.reason === "too_long" && result.durationMs !== null) return t.video.tooLong(formatClock(result.durationMs));
  return Platform.OS === "web" ? t.video.unreadableWeb : t.video.unreadable;
}

/** L'image choisie devient l'image de la recherche, exactement comme une photo importée. */
export async function startSearchFromFrame(timeMs: number): Promise<SpotDraft> {
  if (!current) throw new Error("video_missing");
  const frame = await current.frameFile(timeMs, SPOTTER_IMAGE_MAX_EDGE);
  const draft = await beginFromPhoto(frame.uri, { width: frame.width, height: frame.height });
  track("video_frame_chosen", { duration_s: durationSeconds(current.durationMs), source: SOURCE });
  return draft;
}
