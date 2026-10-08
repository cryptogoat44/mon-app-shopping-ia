// Analyse automatique d'une vidéo (lot 4, temps 1 bis) — enchaînement dans
// l'app. Étage 1, sur l'appareil, gratuit : 8 à 12 images nettes et
// différentes, réduites à 512 px. Étage 2, par l'IA, seulement avec le
// consentement « analyse_video_ia » : ces images et quelques mots partent au
// serveur, qui renvoie jusqu'à 3 moments (image et cadre de la pièce). La
// vidéo entière ne quitte jamais l'appareil. Le meilleur moment est recadré
// et identifié aussitôt (1 crédit, comme une photo) ; les deux autres
// attendent un clic de l'utilisateur (« Essayer un autre moment »).
import { VIDEO_AI, type CropRect } from "@monapp/shared-types";
import { ApiError, findVideoMoments } from "./api";
import { track } from "./analytics";
import { SPOTTER_IMAGE_MAX_EDGE } from "./image-import";
import { capacityFailReason, type CapacityFailReason } from "./spot-capacity";
import { beginFromPhoto } from "./spot-flow";
import { updateDraft, type SpotDraft } from "./spot-draft";
import { discardLocalFile } from "./video-frames";
import { candidateTimes, differenceHash, SCORING_EDGE, selectFrames, sharpness, type FrameCandidate } from "./video-stage1";
import { durationSeconds, type FrameFile, type OpenedVideo } from "./video-timeline";

export interface AutoMoment {
  timeMs: number;
  /** Cadre de la pièce, en proportions de l'image (0–1). */
  box: CropRect;
}

interface AutoSession {
  video: OpenedVideo;
  query: string;
  moments: AutoMoment[];
  /** Rangs déjà essayés (0 = le meilleur). */
  tried: number[];
}

let session: AutoSession | null = null;

export type AutoFailure = "consent" | "disabled" | "user_limit" | "global_limit" | "unavailable" | "network" | "video";
export type AutoOutcome =
  | { kind: "found" }
  | { kind: "not_found" }
  | { kind: "cancelled" }
  | { kind: "failed"; reason: AutoFailure }
  /** Plafond des recherches atteint (lot 4 quater) : aucune image n'est partie à l'IA. */
  | { kind: "capacity"; reason: CapacityFailReason };
export type AutoStep = "frames" | "ai";

/** Session en cours, tant que sa vidéo est encore ouverte. */
function liveSession(video: OpenedVideo | null): AutoSession | null {
  return session && video && session.video === video ? session : null;
}

export function clearAutoSession(): void {
  session = null;
}

/** Étage 1 : moments des images nettes et différentes, sur l'appareil. */
export async function pickDistinctFrames(video: OpenedVideo, onProgress?: (done: number, total: number) => void): Promise<number[]> {
  const times = candidateTimes(video.durationMs);
  const candidates: FrameCandidate[] = [];
  for (const [index, timeMs] of times.entries()) {
    const image = await video.sampleFrame(timeMs, SCORING_EDGE);
    candidates.push({ timeMs, sharpness: sharpness(image), hash: differenceHash(image), colors: image.colors });
    onProgress?.(index + 1, times.length);
  }
  return selectFrames(candidates).map((candidate) => candidate.timeMs);
}

function failureOf(error: unknown): AutoFailure {
  if (error instanceof ApiError) {
    const code = error.body.error;
    if (code === "video_ai_consent_required") return "consent";
    if (code === "video_ai_disabled") return "disabled";
    if (code === "video_ai_user_limit") return "user_limit";
    if (code === "video_ai_global_limit") return "global_limit";
    return "unavailable";
  }
  // fetch échoue sans réponse : hors ligne, serveur injoignable.
  return error instanceof TypeError ? "network" : "unavailable";
}

/** Étages 1 et 2. Les images réduites sont effacées de l'appareil dès l'envoi. */
export async function analyzeVideo(
  video: OpenedVideo,
  query: string,
  onStep: (step: AutoStep) => void,
  signal?: AbortSignal
): Promise<AutoOutcome> {
  session = null;
  let times: number[];
  try {
    onStep("frames");
    times = await pickDistinctFrames(video);
  } catch {
    return { kind: "failed", reason: "video" };
  }
  const files: FrameFile[] = [];
  try {
    for (const timeMs of times) files.push(await video.frameFile(timeMs, VIDEO_AI.frameEdge));
    onStep("ai");
    track("video_ai_frames_sent", { frames_count: files.length, duration_s: durationSeconds(video.durationMs) });
    const moments = await findVideoMoments(
      files.map((file) => file.uri),
      query,
      signal
    );
    track("video_ai_result", { outcome: moments.length > 0 ? "found" : "not_found", moments_count: moments.length });
    if (moments.length === 0) return { kind: "not_found" };
    session = { video, query: query.trim(), moments: moments.map((moment) => ({ timeMs: times[moment.frame]!, box: moment.box })), tried: [] };
    return { kind: "found" };
  } catch (error) {
    // « Annuler » : la requête est abandonnée, rien à signaler.
    if (signal?.aborted) return { kind: "cancelled" };
    const capacity = error instanceof ApiError ? capacityFailReason(error.body) : null;
    if (capacity) {
      track("video_ai_result", { outcome: "limit", moments_count: 0 });
      return { kind: "capacity", reason: capacity };
    }
    const reason = failureOf(error);
    track("video_ai_result", { outcome: reason === "user_limit" || reason === "global_limit" ? "limit" : "unavailable", moments_count: 0 });
    return { kind: "failed", reason };
  } finally {
    for (const file of files) discardLocalFile(file.uri);
  }
}

/** Instant du dernier moment essayé (pour ouvrir le curseur au même endroit). */
export function lastTriedMoment(video: OpenedVideo | null): number | null {
  const live = liveSession(video);
  const rank = live?.tried.at(-1);
  return live && rank !== undefined ? (live.moments[rank]?.timeMs ?? null) : null;
}

/** Rangs des moments pas encore essayés (0 = le meilleur). */
export function remainingMoments(video: OpenedVideo | null): number[] {
  const live = liveSession(video);
  if (!live) return [];
  return live.moments.map((_, rank) => rank).filter((rank) => !live.tried.includes(rank));
}

/** Prépare l'identification d'un moment : image en pleine taille extraite sur
 * l'appareil, cadre de l'IA, mots de l'utilisateur — puis même chemin qu'une
 * photo (1 crédit au lancement). */
export async function prepareMoment(video: OpenedVideo, rank: number): Promise<SpotDraft> {
  const live = liveSession(video);
  const moment = live?.moments[rank];
  if (!live || !moment) throw new Error("video_moment_missing");
  const frame = await video.frameFile(moment.timeMs, SPOTTER_IMAGE_MAX_EDGE);
  const started = beginFromPhoto(frame.uri, { width: frame.width, height: frame.height });
  const draft = updateDraft({ crop: moment.box, query: live.query }) ?? started;
  live.tried.push(rank);
  track("video_ai_moment_tried", { rank: rank + 1 });
  return draft;
}
