// Versions de yt-dlp et de ffmpeg, relevées une fois au démarrage (affichées
// par GET /health, pour vérifier qu'une mise à jour est bien en ligne).
import { runProgram } from "./run.js";

const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+~:_-]{0,60}$/;

/**
 * Versions des deux programmes (null si l'un manque ou ne répond pas).
 * @param {Record<string, string>} env
 */
export async function detectVersions(env) {
  const signal = new AbortController().signal;
  const ytDlp = await runProgram("yt-dlp", ["--ignore-config", "--version"], { env, signal, timeoutMs: 20_000, maxStdoutBytes: 4096 });
  const ffmpeg = await runProgram("ffmpeg", ["-hide_banner", "-version"], { env, signal, timeoutMs: 10_000, maxStdoutBytes: 64 * 1024 });
  const ytDlpVersion = ytDlp.exitCode === 0 ? ytDlp.stdout.toString("utf8").trim().split(/\s+/)[0] ?? "" : "";
  const ffmpegVersion = ffmpeg.exitCode === 0 ? (/ffmpeg version (\S+)/.exec(ffmpeg.stdout.toString("utf8"))?.[1] ?? "") : "";
  return {
    ytDlp: VERSION.test(ytDlpVersion) ? ytDlpVersion : null,
    ffmpeg: VERSION.test(ffmpegVersion) ? ffmpegVersion : null,
  };
}
