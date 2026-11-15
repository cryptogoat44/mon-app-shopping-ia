// Une demande d'images, de bout en bout : yt-dlp (informations), contrôles
// (direct, durée, format, adresse du fichier), ffmpeg (images candidates),
// choix des images rendues. Rien n'est écrit sur le disque ; les images
// restent en mémoire et sont effacées par `release()` après la réponse.
import { LIMITS, WorkerError } from "./contract.js";
import { decodePlan, extractCandidates } from "./ffmpeg.js";
import { selectFrames } from "./selection.js";
import { isAcceptableMediaUrl } from "./urls.js";
import { chooseFormat, probeVideo } from "./ytdlp.js";

/** Erreurs de yt-dlp qui méritent un second essai (défi anti-robot, réponse
 * passagère) : une seule fois, après une courte pause. */
const RETRYABLE = new Set(["extractor_failed", "unknown_error", "ytdlp_bad_json"]);
const RETRY_PAUSE_MS = 800;
/** Second essai seulement s'il reste au moins ce temps. */
const RETRY_MIN_REMAINING_MS = 14_000;
/** Temps laissé à ffmpeg et à la réponse : yt-dlp ne peut pas tout prendre. */
const RESERVED_AFTER_YTDLP_MS = 4_000;
const RESPONSE_MARGIN_MS = 300;

/**
 * @typedef {object} JobStats
 * @property {number} attempts
 * @property {number} ytDlpMs
 * @property {number} ffmpegMs
 * @property {string | undefined} mode
 * @property {string | undefined} codec
 * @property {number | undefined} candidates
 * @property {number | undefined} frames
 * @property {number | null | undefined} durationSeconds
 */

/**
 * @typedef {object} FramesBody
 * @property {number} durationSeconds
 * @property {{ timeSeconds: number, width: number, height: number, jpegBase64: string }[]} frames
 */

/**
 * @param {{ url: string, platform: string }} request
 * @param {{ env: Record<string, string>, signal: AbortSignal, deadlineAt: number, tools: { ytDlp: string, ffmpeg: string }, stats: JobStats }} context
 * @returns {Promise<{ body: FramesBody, release: () => void }>}
 */
export async function extractFrames({ url }, { env, signal, deadlineAt, tools, stats }) {
  const remaining = () => deadlineAt - Date.now();

  // 1. Informations de la vidéo (yt-dlp), un second essai sur une erreur passagère.
  let info;
  for (let attempt = 1; ; attempt += 1) {
    stats.attempts = attempt;
    const startedAt = Date.now();
    try {
      info = await probeVideo(url, { env, signal, timeoutMs: Math.max(Math.min(remaining(), 1000), remaining() - RESERVED_AFTER_YTDLP_MS), command: tools.ytDlp });
      stats.ytDlpMs += Date.now() - startedAt;
      break;
    } catch (error) {
      stats.ytDlpMs += Date.now() - startedAt;
      if (attempt === 1 && error instanceof WorkerError && RETRYABLE.has(error.detail) && remaining() > RETRY_MIN_REMAINING_MS) {
        await pause(RETRY_PAUSE_MS, signal);
        continue;
      }
      throw error;
    }
  }

  // 2. Contrôles avant tout décodage.
  if (info.isLive) throw new WorkerError("unsupported", "live");
  if (info.durationSeconds !== null && info.durationSeconds > LIMITS.maxVideoSeconds) throw new WorkerError("too_long", "too_long_metadata");
  const format = chooseFormat(info);
  if (!format) throw new WorkerError("unsupported", "no_video_format");
  if (!isAcceptableMediaUrl(format.url)) throw new WorkerError("unavailable", "media_url_refused");
  stats.codec = format.codec;

  // 3. Images candidates (ffmpeg).
  const plan = decodePlan(info.durationSeconds, format.fps);
  stats.mode = plan.mode;
  const startedAt = Date.now();
  const extracted = await extractCandidates(
    { input: { url: format.url, headers: format.headers, cookies: format.cookies }, mode: plan.mode, stepSeconds: plan.stepSeconds },
    { env, signal, timeoutMs: Math.max(1, remaining() - RESPONSE_MARGIN_MS), command: tools.ffmpeg }
  );
  stats.ffmpegMs = Date.now() - startedAt;
  try {
    return { body: buildBody(info.durationSeconds, extracted, stats), release: extracted.release };
  } catch (error) {
    extracted.release();
    throw error;
  }
}

/**
 * Choix des images et corps de la réponse.
 * @param {number | null} metadataDuration
 * @param {{ candidates: import("./ffmpeg.js").Candidate[], durationSeconds: number | null }} extracted
 * @param {JobStats} stats
 * @returns {FramesBody}
 */
export function buildBody(metadataDuration, extracted, stats) {
  const usable = extracted.candidates.filter(
    (candidate) => candidate.jpeg.length > 0 && candidate.jpeg.length <= LIMITS.maxFrameBytes && candidate.width >= 1 && candidate.height >= 1 && Math.max(candidate.width, candidate.height) <= LIMITS.maxFrameEdge
  );
  stats.candidates = extracted.candidates.length;
  const lastTime = extracted.candidates.reduce((latest, candidate) => Math.max(latest, candidate.timeSeconds), 0);
  const duration = metadataDuration ?? extracted.durationSeconds ?? lastTime;
  stats.durationSeconds = duration;
  if (duration > LIMITS.maxVideoSeconds + 1) throw new WorkerError("too_long", "too_long_frames");
  if (usable.length === 0) throw new WorkerError("unavailable", "no_frames");

  const maxFrames = duration > LIMITS.longVideoSeconds ? LIMITS.maxFrames : LIMITS.maxFramesShort;
  const selected = selectFrames(usable, { minFrames: LIMITS.minFrames, maxFrames });
  // Taille totale bornée (le client lit 12 Mo au plus) : les plus lourdes partent d'abord.
  let total = selected.reduce((sum, candidate) => sum + candidate.jpeg.length, 0);
  while (total > LIMITS.maxTotalFrameBytes && selected.length > 1) {
    let heaviest = 0;
    for (let index = 1; index < selected.length; index += 1) if (selected[index].jpeg.length > selected[heaviest].jpeg.length) heaviest = index;
    total -= selected[heaviest].jpeg.length;
    selected.splice(heaviest, 1);
  }
  stats.frames = selected.length;
  const roundedDuration = round3(duration);
  return {
    durationSeconds: roundedDuration,
    frames: selected.map((candidate) => ({
      timeSeconds: Math.min(round3(candidate.timeSeconds), roundedDuration),
      width: candidate.width,
      height: candidate.height,
      jpegBase64: candidate.jpeg.toString("base64"),
    })),
  };
}

function round3(/** @type {number} */ value) {
  return Math.round(value * 1000) / 1000;
}

/** Pause interrompue par l'annulation. */
function pause(/** @type {number} */ ms, /** @type {AbortSignal} */ signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new WorkerError("timeout", "deadline"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(undefined);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new WorkerError("timeout", "deadline"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
