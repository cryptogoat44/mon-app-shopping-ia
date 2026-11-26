// Une demande d'images, de bout en bout : yt-dlp (informations), contrôles
// (direct, durée, format, adresse du fichier), yt-dlp (le fichier, en
// mémoire), ffmpeg (images candidates, lues sur la boucle locale), choix des
// images rendues (ou, avec `atSeconds`, l'image du moment). Rien n'est écrit sur le disque ; le fichier est effacé dès
// l'extraction finie, les images par `release()` après la réponse.
import { LIMITS, WorkerError } from "./contract.js";
import { decodePlan, extractCandidates } from "./ffmpeg.js";
import { serveInMemory } from "./memserve.js";
import { pickMoment, selectFrames } from "./selection.js";
import { isAcceptableMediaUrl } from "./urls.js";
import { chooseFormat, downloadMedia, probeVideo } from "./ytdlp.js";

/** Erreurs de yt-dlp qui méritent un second essai (défi anti-robot, réponse
 * passagère) : une seule fois, après une courte pause. */
const RETRYABLE = new Set(["extractor_failed", "unknown_error", "ytdlp_bad_json"]);
const RETRY_PAUSE_MS = 800;
/** Second essai de lecture seulement s'il reste au moins ce temps (second
 * passage, téléchargement et ffmpeg doivent encore tenir). */
const RETRY_MIN_REMAINING_MS = 18_000;
/** Téléchargement : erreurs passagères qui méritent un second essai, s'il
 * reste au moins ce temps. « media_forbidden » (403 du serveur de fichiers,
 * constaté une fois sur trois le 17 novembre 2026) : le second essai demande
 * un autre fichier de la même vidéo. */
const DOWNLOAD_RETRYABLE = new Set(["download_extractor_failed", "download_unknown_error", "media_forbidden"]);
const DOWNLOAD_RETRY_MIN_REMAINING_MS = 10_000;
/** Temps laissé au téléchargement, à ffmpeg et à la réponse : la lecture
 * des informations ne peut pas tout prendre. */
const RESERVED_AFTER_YTDLP_MS = 10_000;
/** Temps laissé à ffmpeg et à la réponse après le téléchargement. */
const RESERVED_AFTER_DOWNLOAD_MS = 5_000;
const RESPONSE_MARGIN_MS = 300;

/**
 * @typedef {object} JobStats
 * @property {number} attempts
 * @property {number} ytDlpMs
 * @property {number} downloadMs
 * @property {number} downloadAttempts
 * @property {number | undefined} mediaKb Taille du fichier téléchargé, en Ko.
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

/** Mode « moment » : un temps au-delà de la durée connue prend la dernière
 * image (0,05 s avant la fin, jamais avant 0). */
const MOMENT_END_MARGIN_SECONDS = 0.05;

/**
 * @param {{ url: string, platform: string, atSeconds?: number }} request
 *   `atSeconds` (facultatif) : mode « moment », UNE image de cet instant.
 * @param {{ env: Record<string, string>, signal: AbortSignal, deadlineAt: number, tools: { ytDlp: string, ffmpeg: string }, stats: JobStats }} context
 * @returns {Promise<{ body: FramesBody, release: () => void }>}
 */
export async function extractFrames({ url, atSeconds }, { env, signal, deadlineAt, tools, stats }) {
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

  // 3. Le fichier, téléchargé par yt-dlp en mémoire (seulement l'entrée
  //    choisie d'un carrousel), un second essai sur une erreur passagère.
  const downloadStartedAt = Date.now();
  const choice = { formatId: format.formatId, playlistIndex: info.playlistIndex, avoidFormat: false };
  let media;
  try {
    for (let attempt = 1; ; attempt += 1) {
      stats.downloadAttempts = attempt;
      try {
        media = await downloadMedia(url, choice, {
          env,
          signal,
          timeoutMs: Math.max(Math.min(remaining(), 1000), remaining() - RESERVED_AFTER_DOWNLOAD_MS),
          command: tools.ytDlp,
        });
        break;
      } catch (error) {
        if (attempt === 1 && error instanceof WorkerError && DOWNLOAD_RETRYABLE.has(error.detail) && remaining() > DOWNLOAD_RETRY_MIN_REMAINING_MS) {
          // Fichier refusé : le second essai en demande un autre.
          choice.avoidFormat = error.detail === "media_forbidden";
          await pause(RETRY_PAUSE_MS, signal);
          continue;
        }
        throw error;
      }
    }
  } finally {
    stats.downloadMs = Date.now() - downloadStartedAt;
  }
  stats.mediaKb = Math.round(media.length / 1024);

  // 4. Images candidates (ffmpeg lit le fichier sur la boucle locale) :
  //    réparties sur toute la vidéo, ou, en mode « moment », toutes celles
  //    de la seconde autour du moment demandé (décodage complet).
  const at = atSeconds === undefined ? undefined : momentTime(atSeconds, info.durationSeconds);
  const plan = at === undefined ? decodePlan(info.durationSeconds, format.fps) : null;
  stats.mode = plan ? plan.mode : "moment";
  let extracted;
  try {
    const served = await serveInMemory(media);
    try {
      const startedAt = Date.now();
      const input = { url: served.url, protocolWhitelist: "http,tcp" };
      extracted = await extractCandidates(
        plan ? { input, mode: plan.mode, stepSeconds: plan.stepSeconds } : { input, mode: "moment", atSeconds: /** @type {number} */ (at) },
        { env, signal, timeoutMs: Math.max(1, remaining() - RESPONSE_MARGIN_MS), command: tools.ffmpeg }
      );
      stats.ffmpegMs = Date.now() - startedAt;
    } finally {
      await served.close();
    }
  } finally {
    media.fill(0);
    media = Buffer.alloc(0);
  }
  try {
    return { body: buildBody(info.durationSeconds, extracted, stats, at), release: extracted.release };
  } catch (error) {
    extracted.release();
    throw error;
  }
}

/**
 * Instant demandé, borné à la vidéo : un temps au-delà de la durée connue
 * prend la dernière image.
 * @param {number} atSeconds
 * @param {number | null} durationSeconds
 */
export function momentTime(atSeconds, durationSeconds) {
  if (durationSeconds === null) return round3(Math.max(0, atSeconds));
  const end = Math.max(0, durationSeconds - MOMENT_END_MARGIN_SECONDS);
  return round3(Math.max(0, Math.min(atSeconds, end)));
}

/**
 * Choix des images et corps de la réponse. Avec `atSeconds` (mode
 * « moment ») : le même contrat, avec UNE seule image (pickMoment).
 * @param {number | null} metadataDuration
 * @param {{ candidates: import("./ffmpeg.js").Candidate[], durationSeconds: number | null }} extracted
 * @param {JobStats} stats
 * @param {number} [atSeconds]
 * @returns {FramesBody}
 */
export function buildBody(metadataDuration, extracted, stats, atSeconds) {
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
  const selected = atSeconds === undefined ? selectFrames(usable, { minFrames: LIMITS.minFrames, maxFrames }) : [pickMoment(usable, atSeconds)];
  // Taille totale bornée (le client lit 12 Mio au plus, 16 Mio depuis les retours du build 2) : les plus lourdes partent d'abord.
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
