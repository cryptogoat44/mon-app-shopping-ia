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

/** D'où vient la vidéo : sélecteur de la photothèque (app iPhone), fichier
 * choisi dans le navigateur (site), ou dernière vidéo de la galerie proposée
 * sur l'accueil (app iPhone, lot 4 ter). */
export type VideoSource = "library" | "file" | "latest";
const PICKER_SOURCE: VideoSource = Platform.OS === "web" ? "file" : "library";

let current: OpenedVideo | null = null;
let currentSource: VideoSource = PICKER_SOURCE;

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

function rejected(reason: VideoRejection, durationMs: number | null, sizeBytes: number | null, source: VideoSource): VideoImport {
  track("video_rejected", { reason, source, duration_s: durationMs === null ? undefined : durationSeconds(durationMs) });
  return { kind: "rejected", reason, durationMs, sizeBytes };
}

/** Contrôle des limites (60 s, 100 Mo) et ouverture de la vidéo, qui devient
 * celle du Spotter. La copie faite par le sélecteur est effacée dès qu'elle
 * ne sert plus ; la vidéo de la galerie, elle, n'est jamais touchée. */
export async function adoptSpotVideo(uri: string, sizeBytes: number | null, source: VideoSource): Promise<VideoImport> {
  const keepFile = source === "latest";
  const discard = () => {
    if (!keepFile) discardLocalFile(uri);
  };
  if (sizeBytes !== null && sizeBytes > VIDEO_MAX_BYTES) {
    discard();
    return rejected("too_large", null, sizeBytes, source);
  }
  let video: OpenedVideo;
  try {
    video = await openVideo(uri, { keepFile });
  } catch {
    discard();
    return rejected("unreadable", null, sizeBytes, source);
  }
  const rejection = videoRejection({ durationMs: video.durationMs, sizeBytes });
  if (rejection) {
    video.release();
    return rejected(rejection, video.durationMs, sizeBytes, source);
  }
  releaseSpotVideo();
  current = video;
  currentSource = source;
  track("video_imported", { duration_s: durationSeconds(video.durationMs), source });
  return { kind: "ready" };
}

/** Choix d'une vidéo dans le sélecteur du système, puis contrôle et ouverture. */
export async function importSpotVideo(): Promise<VideoImport> {
  let asset: ImagePicker.ImagePickerAsset | null;
  try {
    asset = await pickVideo();
  } catch {
    return { kind: "unavailable" };
  }
  if (!asset) return { kind: "cancelled" };
  return adoptSpotVideo(asset.uri, asset.fileSize ?? null, PICKER_SOURCE);
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
  const draft = beginFromPhoto(frame.uri, { width: frame.width, height: frame.height });
  track("video_frame_chosen", { duration_s: durationSeconds(current.durationMs), source: currentSource });
  return draft;
}
