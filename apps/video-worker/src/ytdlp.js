// yt-dlp, en deux temps :
// 1. les informations de la vidéo publique (durée, formats disponibles) :
//    --dump-single-json (-J), le JSON est écrit sur la sortie standard ;
// 2. le fichier du format choisi, téléchargé par yt-dlp lui-même et écrit
//    sur sa sortie standard (« -o - »), lu en mémoire avec un plafond
//    (LIMITS.maxMediaBytes). TikTok refuse le fichier à ffmpeg (« 403 »,
//    constaté le 16 novembre 2026) mais le donne à yt-dlp, qui envoie les
//    cookies et les en-têtes attendus.
// Dans les deux cas : --no-cache-dir, --no-part, --ignore-config (ni cache,
// ni fichier partiel, ni réglage lu sur le disque) ; l'adresse est passée
// après « -- », dans une liste d'arguments (jamais de shell, jamais --exec).
import { LIMITS, WorkerError } from "./contract.js";
import { runProgram } from "./run.js";

/** Arguments fixes, avant « -- <adresse> ». */
export function ytDlpArgs(/** @type {string} */ url) {
  return [
    "--ignore-config",
    "--no-cache-dir",
    "--no-part",
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--socket-timeout",
    String(LIMITS.networkTimeoutSeconds),
    "--retries",
    "1",
    "--extractor-retries",
    "1",
    "--dump-single-json",
    "--",
    url,
  ];
}

/**
 * Messages d'erreur de yt-dlp → code du contrat. Dans l'ordre : le premier
 * motif reconnu l'emporte. `detail` (fixe) part dans le journal, jamais le
 * message lui-même (il contient l'adresse ou l'identifiant de la vidéo).
 * @type {readonly { code: import("./contract.js").WorkerError["code"], detail: string, pattern: RegExp }[]}
 */
export const YT_DLP_ERRORS = [
  { code: "unsupported", detail: "unsupported_url", pattern: /unsupported url|is not a valid url/i },
  { code: "private", detail: "private", pattern: /\bprivate\b|status code (?:10216|10222)|only available (?:for|to) (?:followers|friends|registered)|(?:do not|don'?t) have permission to view|who follow this account/i },
  { code: "private", detail: "age_restricted", pattern: /age[- ]restricted|restricted video|inappropriate for some users|comfortable for some audiences|confirm your age|sensitive content/i },
  { code: "blocked", detail: "ip_blocked", pattern: /ip address is blocked|status code 10204|blocked from accessing/i },
  { code: "blocked", detail: "geo_restricted", pattern: /geo[- ]?restrict|not available in your (?:country|region|location)|from your (?:country|location)|in your country/i },
  { code: "blocked", detail: "rate_limited", pattern: /rate[- ]?limit|too many requests|http error 429/i },
  { code: "blocked", detail: "login_required", pattern: /log ?in|sign in|--cookies|cookies-from-browser|authenticat/i },
  { code: "blocked", detail: "forbidden", pattern: /http error 403|forbidden/i },
  { code: "not_found", detail: "not_found", pattern: /http error 404|\bnot found\b|does not exist|been (?:removed|deleted)|was (?:removed|deleted)|no longer available|video (?:is )?unavailable|video not available|post (?:is )?unavailable|isn'?t available|is not available|status code 10231|(?:could not|couldn't|unable to) find/i },
  { code: "unsupported", detail: "no_video", pattern: /no video formats found|no video could be found|there(?:'s| is) no video|does not contain (?:a )?video/i },
];

/**
 * Code du contrat pour une sortie d'erreur de yt-dlp (lignes « ERROR: »
 * d'abord, sinon tout le texte). Par défaut : « unavailable » (extracteur
 * cassé par un changement de la plateforme, réseau, réponse inattendue).
 * @param {string} stderr
 * @returns {{ code: import("./contract.js").WorkerError["code"], detail: string }}
 */
export function classifyYtDlpError(stderr) {
  const errorLines = stderr
    .split(/\r?\n/)
    .filter((line) => /^\s*ERROR:/.test(line))
    .join("\n");
  const text = errorLines || stderr;
  for (const rule of YT_DLP_ERRORS) if (rule.pattern.test(text)) return { code: rule.code, detail: rule.detail };
  if (/unable to (?:extract|download)|universal data|extractor error|timed out|connection|http error 5\d\d/i.test(text)) return { code: "unavailable", detail: "extractor_failed" };
  return { code: "unavailable", detail: "unknown_error" };
}

/**
 * @typedef {object} VideoInfo
 * @property {number | null} durationSeconds
 * @property {boolean} isLive
 * @property {Record<string, unknown>[]} formats
 */

/**
 * Le JSON de yt-dlp, réduit à ce qui sert. Une liste (carrousel Instagram)
 * donne sa première vidéo.
 * @param {unknown} json
 * @returns {VideoInfo | null}
 */
export function videoInfoFrom(json) {
  if (!isRecord(json)) return null;
  let info = json;
  if (json._type === "playlist" || Array.isArray(json.entries)) {
    const entries = Array.isArray(json.entries) ? json.entries.filter(isRecord) : [];
    const withVideo = entries.find((entry) => (Array.isArray(entry.formats) ? entry.formats : [entry]).some((format) => isRecord(format) && hasVideo(format)));
    if (!withVideo) return { durationSeconds: null, isLive: false, formats: [] };
    info = withVideo;
  }
  const duration = typeof info.duration === "number" && Number.isFinite(info.duration) && info.duration > 0 ? info.duration : null;
  const formats = Array.isArray(info.formats) ? info.formats.filter(isRecord) : typeof info.url === "string" ? [info] : [];
  return { durationSeconds: duration, isLive: info.is_live === true || info.live_status === "is_live" || info.live_status === "is_upcoming", formats };
}

/**
 * @typedef {object} ChosenFormat
 * @property {string} url Adresse du fichier (vérifiée avant le téléchargement).
 * @property {string | null} formatId Identifiant du format pour yt-dlp (« -f »).
 * @property {number | null} width
 * @property {number | null} height
 * @property {number | null} fps
 * @property {"h264" | "hevc" | "other" | "unknown"} codec
 */

const H264 = /^(?:avc\d?|h\.?264)/i;
/** Codec maison de TikTok (H.266), illisible par ffmpeg : jamais choisi. */
const UNPLAYABLE = /bytevc2|vvc|h\.?266/i;
const HEVC = /^(?:hvc1|hev1|h\.?265|hevc|bytevc1)/i;
/** Plus grand petit côté accepté (au-delà, décodage trop lourd). */
const MAX_SHORT_SIDE = 1080;
/** Identifiant de format repris dans « -f » : lettres, chiffres, « . _ - ». */
const FORMAT_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** @param {Record<string, unknown>} format */
function hasVideo(format) {
  return format.vcodec !== "none" && format.video_ext !== "none";
}

/** @param {Record<string, unknown>} format */
function codecOf(format) {
  const vcodec = typeof format.vcodec === "string" ? format.vcodec : "";
  const id = typeof format.format_id === "string" ? format.format_id : "";
  if (H264.test(vcodec) || (!vcodec && /h264/i.test(id))) return "h264";
  if (HEVC.test(vcodec) || (!vcodec && /bytevc1|h265/i.test(id))) return "hevc";
  return vcodec ? "other" : "unknown";
}

/** @param {unknown} value */
function dimension(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 16384 ? value : null;
}

/**
 * Le format à lire : un fichier MP4 en une seule pièce (jamais une liste de
 * lecture m3u8 ni des fragments), de préférence H.264 dont le petit côté
 * fait de 480 à 720 px (720p au plus), le plus grand possible ; à défaut le
 * plus proche (H.264 avant H.265). Null si aucun format vidéo n'existe.
 * @param {VideoInfo} info
 * @returns {ChosenFormat | null}
 */
export function chooseFormat(info) {
  const usable = info.formats.filter((format) => {
    if (typeof format.url !== "string" || !format.url.startsWith("https://")) return false;
    if (!hasVideo(format) || format.has_drm === true || Array.isArray(format.fragments)) return false;
    if (UNPLAYABLE.test(String(format.vcodec ?? "")) || format.format_note === "UNPLAYABLE") return false;
    const protocol = typeof format.protocol === "string" ? format.protocol : "https";
    if (protocol !== "https" && protocol !== "http") return false;
    const ext = typeof format.ext === "string" ? format.ext : "mp4";
    if (ext !== "mp4") return false;
    const width = dimension(format.width);
    const height = dimension(format.height);
    return !(width && height && Math.min(width, height) > MAX_SHORT_SIDE);
  });
  if (usable.length === 0) return null;
  const rank = (/** @type {Record<string, unknown>} */ format) => {
    const codec = codecOf(format);
    const width = dimension(format.width);
    const height = dimension(format.height);
    const short = width && height ? Math.min(width, height) : null;
    const inRange = short !== null && short >= 480 && short <= 720;
    const codecRank = { h264: 0, unknown: 1, hevc: 2, other: 3 }[codec];
    const sizeRank = inRange ? 0 : short === null ? 3 : short < 480 ? 1 : 2;
    const closeness = short === null ? 0 : inRange ? 720 - short : Math.abs(short - 720);
    const videoOnly = format.acodec === "none" ? 0 : 1;
    const bitrate = typeof format.tbr === "number" && Number.isFinite(format.tbr) ? format.tbr : 0;
    return [inRange && codec === "h264" ? 0 : 1, codecRank, sizeRank, closeness, videoOnly, bitrate];
  };
  const best = [...usable].sort((a, b) => compareRanks(rank(a), rank(b)))[0];
  const fps = typeof best.fps === "number" && Number.isFinite(best.fps) && best.fps > 0 && best.fps <= 120 ? best.fps : null;
  return {
    url: /** @type {string} */ (best.url),
    width: dimension(best.width),
    height: dimension(best.height),
    fps,
    codec: codecOf(best),
    formatId: typeof best.format_id === "string" && FORMAT_ID.test(best.format_id) ? best.format_id : null,
  };
}

/** @param {number[]} a @param {number[]} b */
function compareRanks(a, b) {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * Lance yt-dlp une fois et rend les informations de la vidéo.
 * @param {string} url Adresse acceptée (urls.js).
 * @param {{ env: Record<string, string>, signal: AbortSignal, timeoutMs: number, command?: string }} options
 * @returns {Promise<VideoInfo>}
 */
export async function probeVideo(url, { env, signal, timeoutMs, command = "yt-dlp" }) {
  const result = await runProgram(command, ytDlpArgs(url), { env, signal, timeoutMs, maxStdoutBytes: LIMITS.maxMetadataBytes });
  try {
    if (result.stopReason === "aborted") throw new WorkerError("timeout", "deadline");
    if (result.stopReason === "timeout") throw new WorkerError("timeout", "ytdlp_timeout");
    if (result.stopReason === "overflow") throw new WorkerError("unavailable", "ytdlp_output_too_large");
    if (result.spawnError) throw new WorkerError("unavailable", "ytdlp_missing");
    if (result.exitCode !== 0) {
      const { code, detail } = classifyYtDlpError(result.stderr);
      throw new WorkerError(code, detail);
    }
    let json;
    try {
      json = JSON.parse(result.stdout.toString("utf8"));
    } catch {
      throw new WorkerError("unavailable", "ytdlp_bad_json");
    }
    const info = videoInfoFrom(json);
    if (!info) throw new WorkerError("unavailable", "ytdlp_bad_json");
    return info;
  } finally {
    result.stdout.fill(0);
  }
}

/** Formats de secours, si l'identifiant choisi n'existe plus au second
 * passage : un MP4 H.264 (jamais le codec maison illisible de TikTok). */
export const DOWNLOAD_FALLBACK_FORMATS = "best[ext=mp4][vcodec^=avc]/best[ext=mp4][vcodec^=h264]";

/**
 * Arguments du téléchargement : le format choisi (puis les formats de
 * secours), écrit sur la sortie standard, plafonné en taille.
 * @param {string} url Adresse acceptée (urls.js).
 * @param {string | null} formatId
 */
export function ytDlpDownloadArgs(url, formatId) {
  const selector = formatId && FORMAT_ID.test(formatId) ? `${formatId}/${DOWNLOAD_FALLBACK_FORMATS}` : DOWNLOAD_FALLBACK_FORMATS;
  return [
    "--ignore-config",
    "--no-cache-dir",
    "--no-part",
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--socket-timeout",
    String(LIMITS.networkTimeoutSeconds),
    "--retries",
    "1",
    "--extractor-retries",
    "1",
    "--max-filesize",
    String(LIMITS.maxMediaBytes),
    "--format",
    selector,
    "--output",
    "-",
    "--",
    url,
  ];
}

/**
 * Télécharge le fichier vidéo en mémoire (jamais sur le disque). Le tampon
 * rendu appartient à l'appelant, qui l'efface (fill(0)) après usage.
 * @param {string} url
 * @param {string | null} formatId
 * @param {{ env: Record<string, string>, signal: AbortSignal, timeoutMs: number, command?: string }} options
 * @returns {Promise<Buffer>}
 */
export async function downloadMedia(url, formatId, { env, signal, timeoutMs, command = "yt-dlp" }) {
  const result = await runProgram(command, ytDlpDownloadArgs(url, formatId), { env, signal, timeoutMs, maxStdoutBytes: LIMITS.maxMediaBytes });
  let kept = false;
  try {
    if (result.stopReason === "aborted") throw new WorkerError("timeout", "deadline");
    if (result.stopReason === "timeout") throw new WorkerError("timeout", "download_timeout");
    if (result.stopReason === "overflow") throw new WorkerError("unavailable", "media_too_large");
    if (result.spawnError) throw new WorkerError("unavailable", "ytdlp_missing");
    if (result.exitCode !== 0) {
      const { code, detail } = classifyYtDlpError(result.stderr);
      if (code === "blocked" && detail === "forbidden") throw new WorkerError("blocked", "media_forbidden");
      throw new WorkerError(code, detail === "extractor_failed" || detail === "unknown_error" ? `download_${detail}` : detail);
    }
    // --max-filesize : yt-dlp s'arrête sans rien écrire (et sans erreur).
    if (result.stdout.length === 0) throw new WorkerError("unavailable", "media_empty");
    kept = true;
    return result.stdout;
  } finally {
    if (!kept) result.stdout.fill(0);
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
