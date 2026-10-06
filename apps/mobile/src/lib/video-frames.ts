// Images d'une vidéo, extraites sur l'iPhone (lot 4) : lecteur expo-video
// jamais affiché ni lancé, images générées par le système (tous les formats
// lus par l'iPhone, HEVC compris). Version site : video-frames.web.ts.
// La vidéo ne quitte pas l'appareil ; sa copie locale (faite par le
// sélecteur) est effacée dès qu'on n'en a plus besoin.
import { createVideoPlayer, type VideoPlayer } from "expo-video";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File } from "expo-file-system";
import { base64ToBytes, decodePngSample } from "./png-pixels";
import type { FrameSample } from "./frame-sample";
import type { FrameFile, FramePreview, OpenedVideo } from "./video-timeline";

/** Au-delà, la vidéo est considérée comme illisible. */
const OPEN_TIMEOUT_MS = 15_000;

/** Efface un fichier local : copie d'une vidéo choisie, image temporaire
 * (silencieux s'il est déjà effacé). */
export function discardLocalFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Copie déjà effacée par le système (dossier de cache) : rien à faire.
  }
}

function waitUntilReady(player: VideoPlayer): Promise<void> {
  if (player.status === "readyToPlay") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("video_open_timeout")), OPEN_TIMEOUT_MS);
    const subscription = player.addListener("statusChange", ({ status }) => {
      if (status === "readyToPlay") finish(null);
      if (status === "error") finish(new Error("video_unreadable"));
    });
    function finish(error: Error | null) {
      clearTimeout(timer);
      subscription.remove();
      if (error) reject(error);
      else resolve();
    }
  });
}

async function thumbnail(player: VideoPlayer, timeMs: number, maxEdge: number) {
  const [image] = await player.generateThumbnailsAsync(timeMs / 1000, { maxWidth: maxEdge, maxHeight: maxEdge });
  if (!image) throw new Error("video_frame_missing");
  return image;
}

/** Ouvre la vidéo choisie ; rejette si elle ne peut pas être lue. */
export async function openVideo(uri: string): Promise<OpenedVideo> {
  const player = createVideoPlayer({ uri });
  player.muted = true;
  try {
    await waitUntilReady(player);
  } catch (error) {
    player.release();
    throw error;
  }
  return {
    durationMs: player.duration * 1000,
    async filmstrip(timesMs, maxEdge): Promise<FramePreview[]> {
      return player.generateThumbnailsAsync(
        timesMs.map((time) => time / 1000),
        { maxWidth: maxEdge, maxHeight: maxEdge }
      );
    },
    preview: (timeMs, maxEdge): Promise<FramePreview> => thumbnail(player, timeMs, maxEdge),
    async frameFile(timeMs, maxEdge): Promise<FrameFile> {
      const rendered = await ImageManipulator.manipulate(await thumbnail(player, timeMs, maxEdge)).renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
      return { uri: saved.uri, width: saved.width, height: saved.height };
    },
    async sampleFrame(timeMs, maxEdge): Promise<FrameSample> {
      // Seul moyen simple de lire des pixels sur iPhone : une petite image PNG,
      // décodée dans l'app (png-pixels.ts) ; son fichier est aussitôt effacé.
      const rendered = await ImageManipulator.manipulate(await thumbnail(player, timeMs, maxEdge)).renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.PNG, base64: true });
      discardLocalFile(saved.uri);
      if (!saved.base64) throw new Error("video_frame_missing");
      return decodePngSample(base64ToBytes(saved.base64));
    },
    release() {
      player.release();
      discardLocalFile(uri);
    },
  };
}
