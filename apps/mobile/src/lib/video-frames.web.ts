// Images d'une vidéo, extraites dans le navigateur (lot 4) : lecteur vidéo
// jamais affiché, image dessinée dans un canevas puis convertie en JPEG. La
// vidéo reste dans le navigateur (adresse locale « blob: ») : seule l'image
// choisie part, comme une photo. Version iPhone : video-frames.ts.
// Formats : ceux que le navigateur sait lire — MP4 (H.264) partout ; HEVC
// (format par défaut des iPhone) seulement dans Safari, et dans Chrome ou
// Edge quand l'ordinateur sait le décoder ; pas dans Firefox.
import { toFrameSample, type FrameSample } from "./frame-sample";
import type { FrameFile, FramePreview, OpenedVideo } from "./video-timeline";

const OPEN_TIMEOUT_MS = 15_000;
const SEEK_TIMEOUT_MS = 10_000;
/** Grandes images gardées en mémoire pendant qu'on fait glisser le curseur. */
const KEPT_PREVIEWS = 3;

/** Oublie une adresse locale : vidéo choisie, image temporaire. */
export function discardLocalFile(uri: string): void {
  if (uri.startsWith("blob:")) URL.revokeObjectURL(uri);
}

function waitFor(video: HTMLVideoElement, event: "loadedmetadata" | "seeked", timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("video_timeout")), timeoutMs);
    const onEvent = () => finish(null);
    const onError = () => finish(new Error("video_unreadable"));
    video.addEventListener(event, onEvent);
    video.addEventListener("error", onError);
    function finish(error: Error | null) {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      video.removeEventListener("error", onError);
      if (error) reject(error);
      else resolve();
    }
  });
}

async function seek(video: HTMLVideoElement, timeMs: number): Promise<void> {
  const target = timeMs / 1000;
  if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) return;
  const seeked = waitFor(video, "seeked", SEEK_TIMEOUT_MS);
  video.currentTime = target;
  await seeked;
}

/** Image en cours dessinée dans un canevas, réduite à `maxEdge`. */
function draw(video: HTMLVideoElement, maxEdge: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("canvas_unavailable");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

/** Étage 1 de l'analyse automatique : pixels lus directement dans le canevas. */
function grayCapture(video: HTMLVideoElement, maxEdge: number): FrameSample {
  const { canvas, context } = draw(video, maxEdge);
  return toFrameSample(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, 4);
}

function capture(video: HTMLVideoElement, maxEdge: number): Promise<{ blob: Blob; width: number; height: number }> {
  let canvas: HTMLCanvasElement;
  try {
    canvas = draw(video, maxEdge).canvas;
  } catch (error) {
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve({ blob, width: canvas.width, height: canvas.height }) : reject(new Error("video_frame_missing"))),
      "image/jpeg",
      0.85
    );
  });
}

/** Lecteur prêt à donner des images ; rejette si le navigateur ne sait pas lire la vidéo. */
async function loadVideo(uri: string): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const loaded = waitFor(video, "loadedmetadata", OPEN_TIMEOUT_MS);
  video.src = uri;
  try {
    await loaded;
    if (!video.videoWidth || !Number.isFinite(video.duration)) throw new Error("video_unreadable");
    // Safari (iPhone) ne charge les images qu'après une lecture : muette, aussitôt en pause.
    await video.play().catch(() => undefined);
    video.pause();
    return video;
  } catch (error) {
    video.removeAttribute("src");
    video.load();
    throw error;
  }
}

/** Ouvre la vidéo choisie ; rejette si elle ne peut pas être lue. */
export async function openVideo(uri: string): Promise<OpenedVideo> {
  const video = await loadVideo(uri);
  const strip = new Set<string>();
  const previews: string[] = [];
  // Un seul lecteur : les demandes d'images passent l'une après l'autre.
  let queue: Promise<unknown> = Promise.resolve();
  const at = <T>(timeMs: number, grab: (element: HTMLVideoElement) => T | Promise<T>): Promise<T> => {
    const task = queue.then(async () => {
      await seek(video, timeMs);
      return grab(video);
    });
    queue = task.catch(() => undefined);
    return task;
  };
  const frameAt = (timeMs: number, maxEdge: number) => at(timeMs, (element) => capture(element, maxEdge));
  return {
    durationMs: video.duration * 1000,
    async filmstrip(timesMs, maxEdge): Promise<FramePreview[]> {
      const images: string[] = [];
      for (const time of timesMs) {
        const url = URL.createObjectURL((await frameAt(time, maxEdge)).blob);
        strip.add(url);
        images.push(url);
      }
      return images;
    },
    async preview(timeMs, maxEdge): Promise<FramePreview> {
      const url = URL.createObjectURL((await frameAt(timeMs, maxEdge)).blob);
      previews.push(url);
      while (previews.length > KEPT_PREVIEWS) {
        const oldest = previews.shift();
        if (oldest) URL.revokeObjectURL(oldest);
      }
      return url;
    },
    async frameFile(timeMs, maxEdge): Promise<FrameFile> {
      // Adresse gardée : c'est l'image du brouillon, envoyée à l'identification.
      const { blob, width, height } = await frameAt(timeMs, maxEdge);
      return { uri: URL.createObjectURL(blob), width, height };
    },
    sampleFrame: (timeMs, maxEdge): Promise<FrameSample> => at(timeMs, (element) => grayCapture(element, maxEdge)),
    release() {
      [...strip, ...previews].forEach((url) => URL.revokeObjectURL(url));
      strip.clear();
      previews.length = 0;
      video.removeAttribute("src");
      video.load();
      discardLocalFile(uri);
    },
  };
}
