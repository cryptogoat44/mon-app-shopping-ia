// ffmpeg : lecture du fichier vidéo directement à son adresse (requêtes HTTP
// partielles, rien n'est écrit sur le disque) et images candidates écrites
// dans deux tuyaux :
// - sortie standard (pipe:1) : les images JPEG, 1 280 px au plus sur le
//   grand côté (image2pipe, mjpeg, -q:v 4 ≈ qualité 82) ;
// - descripteur 3 (pipe:3) : les mêmes images en 96 × 96 px, rouge-vert-bleu
//   brut, pour juger netteté et doublons sans décoder un JPEG en JavaScript.
// Le filtre showinfo écrit l'instant de chaque image sur la sortie d'erreur.
//
// Sécurité : -protocol_whitelist https,tls,tcp (jamais un fichier local, ni
// http, ni une liste de lecture), certificat du serveur vérifié
// (-tls_verify 1), -f mp4 (démultiplexeur imposé), lecture plafonnée à 91 s
// de vidéo, arrêt net au délai.
import { existsSync } from "node:fs";
import { LIMITS, WorkerError } from "./contract.js";
import { splitJpegStream } from "./jpeg.js";
import { runProgram } from "./run.js";
import { SCORING_BYTES, SCORING_EDGE, scoreFrame } from "./selection.js";

/** Certificats des autorités (paquet ca-certificates de l'image Docker) :
 * ffmpeg vérifie le certificat du serveur du fichier (-tls_verify 1). */
export const CA_FILE = "/etc/ssl/certs/ca-certificates.crt";
const HAS_CA_FILE = existsSync(CA_FILE);

/**
 * @typedef {"full" | "keyframes"} DecodeMode
 * « full » : toutes les images sont décodées, une candidate toutes les
 * `stepSeconds` ; « keyframes » : seules les images clés sont décodées
 * (-skip_frame nokey), beaucoup plus rapide pour une longue vidéo.
 */

/**
 * @typedef {object} FfmpegInput
 * @property {string} url Adresse https du fichier (déjà vérifiée).
 * @property {Record<string, string>} headers
 * @property {{ name: string, value: string, domain: string | null, path: string | null }[]} cookies
 */

/**
 * @typedef {object} InputOverride Tests seulement : vidéo envoyée sur l'entrée standard.
 * @property {string} url Ex. « pipe:0 ».
 * @property {string} protocolWhitelist Ex. « pipe ».
 * @property {Buffer} stdin
 */

/**
 * Mode de décodage et écart entre deux candidates.
 * @param {number | null} durationSeconds
 * @param {number | null} fps
 * @returns {{ mode: DecodeMode, stepSeconds: number }}
 */
export function decodePlan(durationSeconds, fps) {
  const duration = durationSeconds ?? LIMITS.maxVideoSeconds;
  const stepSeconds = Math.max(LIMITS.minCandidateSpacingSeconds, duration / LIMITS.maxCandidates);
  const frames = duration * (fps ?? 30);
  const mode = durationSeconds !== null && frames <= LIMITS.fullDecodeMaxFrames ? "full" : "keyframes";
  return { mode, stepSeconds: Math.round(stepSeconds * 1000) / 1000 };
}

/**
 * Arguments de ffmpeg. Aucune sortie n'est un fichier : pipe:1 et pipe:3.
 * @param {{ input: FfmpegInput, mode: DecodeMode, stepSeconds: number, override?: InputOverride }} plan
 * @returns {string[]}
 */
export function ffmpegArgs({ input, mode, stepSeconds, override }) {
  const maxFrames = String(LIMITS.maxCandidates + 2);
  const edge = LIMITS.maxFrameEdge;
  const args = ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "info", "-filter_complex_threads", "1"];
  if (override) {
    args.push("-protocol_whitelist", override.protocolWhitelist);
  } else {
    args.push("-protocol_whitelist", "https,tls,tcp", "-rw_timeout", String(LIMITS.networkTimeoutSeconds * 1_000_000), "-tls_verify", "1");
    if (HAS_CA_FILE) args.push("-ca_file", CA_FILE);
    const headers = { ...input.headers };
    const userAgent = takeHeader(headers, "user-agent");
    const referer = takeHeader(headers, "referer");
    if (userAgent) args.push("-user_agent", userAgent);
    if (referer) args.push("-referer", referer);
    const extra = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`);
    if (extra.length > 0) args.push("-headers", extra.join(""));
    if (input.cookies.length > 0) {
      const host = new URL(input.url).hostname;
      args.push("-cookies", input.cookies.map((cookie) => `${cookie.name}=${cookie.value}; path=${cookie.path ?? "/"}; domain=${cookie.domain ?? host};`).join("\n"));
    }
  }
  if (mode === "keyframes") args.push("-skip_frame", "nokey");
  args.push("-threads", "1", "-t", String(LIMITS.maxVideoSeconds + 1), "-f", "mp4", "-i", override ? override.url : input.url);
  const graph = [
    `[0:v:0]select='isnan(prev_selected_t)+gte(t-prev_selected_t,${stepSeconds})',showinfo,split=2[big][small]`,
    `[big]scale=w='min(${edge},iw)':h='min(${edge},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2[bigout]`,
    `[small]scale=${SCORING_EDGE}:${SCORING_EDGE}:flags=area,format=rgb24[smallout]`,
  ].join(";");
  args.push("-filter_complex", graph);
  args.push("-map", "[bigout]", "-an", "-sn", "-dn", "-fps_mode", "passthrough", "-frames:v", maxFrames, "-c:v", "mjpeg", "-q:v", String(LIMITS.jpegQscale), "-f", "image2pipe", "pipe:1");
  args.push("-map", "[smallout]", "-an", "-sn", "-dn", "-fps_mode", "passthrough", "-frames:v", maxFrames, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:3");
  return args;
}

/** @param {Record<string, string>} headers @param {string} wanted */
function takeHeader(headers, wanted) {
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === wanted) {
      const value = headers[name];
      delete headers[name];
      return value;
    }
  }
  return null;
}

const SHOWINFO = /\bn:\s*\d+\s+pts:\s*-?\d+\s+pts_time:\s*(-?[0-9.]+(?:e[-+]?\d+)?)/;
const DURATION = /^\s*Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;

/** Durée annoncée par ffmpeg (« Duration: 00:01:02.50 »), en secondes, ou null. */
export function parseDurationLine(/** @type {string} */ line) {
  const match = DURATION.exec(line);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** Instant d'une image (ligne du filtre showinfo), ou null. */
export function parseShowinfoLine(/** @type {string} */ line) {
  if (!line.includes("showinfo")) return null;
  const match = SHOWINFO.exec(line);
  if (!match) return null;
  const time = Number(match[1]);
  return Number.isFinite(time) ? Math.max(0, time) : null;
}

/**
 * Erreurs de ffmpeg → code du contrat.
 * @param {string} stderr
 */
export function classifyFfmpegError(stderr) {
  if (/403 Forbidden|Server returned 401|Server returned 451/i.test(stderr)) return new WorkerError("blocked", "media_forbidden");
  if (/404 Not Found|Server returned 410/i.test(stderr)) return new WorkerError("unavailable", "media_not_found");
  if (/Protocol not on whitelist|not on whitelist/i.test(stderr)) return new WorkerError("unavailable", "media_protocol_refused");
  return new WorkerError("unavailable", "ffmpeg_failed");
}

/**
 * @typedef {object} Candidate
 * @property {number} timeSeconds
 * @property {Buffer} jpeg Vue sur la sortie de ffmpeg (effacée avec elle).
 * @property {number} width
 * @property {number} height
 * @property {number} sharpness
 * @property {string} hash
 * @property {number[]} colors
 */

/**
 * Lance ffmpeg et rend les images candidates. `release()` efface toutes les
 * images (à appeler dès qu'elles ne servent plus).
 * @param {{ input: FfmpegInput, mode: DecodeMode, stepSeconds: number, override?: InputOverride }} plan
 * @param {{ env: Record<string, string>, signal: AbortSignal, timeoutMs: number, command?: string }} options
 * @returns {Promise<{ candidates: Candidate[], durationSeconds: number | null, release: () => void }>}
 */
export async function extractCandidates(plan, { env, signal, timeoutMs, command = "ffmpeg" }) {
  /** @type {number[]} */
  const times = [];
  /** @type {number | null} */
  let durationSeconds = null;
  const result = await runProgram(command, ffmpegArgs(plan), {
    env,
    signal,
    timeoutMs,
    maxStdoutBytes: LIMITS.maxFfmpegOutputBytes,
    extraOutputFd: 3,
    maxExtraBytes: (LIMITS.maxCandidates + 2) * SCORING_BYTES,
    maxStderrBytes: 32 * 1024,
    stdin: plan.override?.stdin,
    onStderrLine(line) {
      const time = parseShowinfoLine(line);
      if (time !== null) {
        times.push(time);
        return;
      }
      const duration = durationSeconds === null ? parseDurationLine(line) : null;
      if (duration !== null) {
        durationSeconds = duration;
        // Seconde vérification de la durée (yt-dlp ne la donne pas toujours),
        // avec une seconde de tolérance pour les arrondis des deux outils.
        if (duration > LIMITS.maxVideoSeconds + 1) return "too_long";
      }
    },
  });
  const release = () => {
    result.stdout.fill(0);
    result.extra.fill(0);
  };
  try {
    if (result.stopReason === "aborted") throw new WorkerError("timeout", "deadline");
    if (result.stopReason === "timeout") throw new WorkerError("timeout", "ffmpeg_timeout");
    if (result.stopReason === "too_long") throw new WorkerError("too_long", "too_long_ffmpeg");
    if (result.stopReason === "overflow") throw new WorkerError("unavailable", "ffmpeg_output_too_large");
    if (result.spawnError) throw new WorkerError("unavailable", "ffmpeg_missing");
    if (result.exitCode !== 0) throw classifyFfmpegError(result.stderr);

    const images = splitJpegStream(result.stdout);
    const smallCount = Math.floor(result.extra.length / SCORING_BYTES);
    const count = Math.min(images.length, smallCount);
    /** @type {Candidate[]} */
    const candidates = [];
    for (let index = 0; index < count; index += 1) {
      const small = result.extra.subarray(index * SCORING_BYTES, (index + 1) * SCORING_BYTES);
      const image = images[index];
      // Instant lu par showinfo ; à défaut, déduit de l'écart demandé.
      const timeSeconds = times[index] ?? index * plan.stepSeconds;
      candidates.push({ timeSeconds, jpeg: image.data, width: image.width, height: image.height, ...scoreFrame(small) });
    }
    return { candidates, durationSeconds, release };
  } catch (error) {
    release();
    throw error;
  }
}
