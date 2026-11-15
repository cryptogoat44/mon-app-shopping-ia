// Lancement d'un programme (yt-dlp, ffmpeg) : liste d'arguments, jamais de
// shell ; environnement réduit (jamais le secret du service) ; sorties lues
// en mémoire avec un plafond ; arrêt net (SIGKILL, tout le groupe de
// processus) au délai, à l'annulation ou au dépassement du plafond.
import { spawn } from "node:child_process";

/**
 * Environnement donné aux programmes : le strict nécessaire.
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string>}
 */
export function childEnvironment(env) {
  return {
    PATH: env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: "/tmp",
    TMPDIR: "/tmp",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
    NO_COLOR: "1",
  };
}

/**
 * @typedef {object} RunOptions
 * @property {Record<string, string>} env
 * @property {AbortSignal} [signal] Annulation (délai global de la demande).
 * @property {number} timeoutMs Délai propre à ce programme.
 * @property {number} maxStdoutBytes
 * @property {number} [maxStderrBytes] Fin de la sortie d'erreur gardée (texte).
 * @property {number} [extraOutputFd] Descripteur de sortie supplémentaire (ex. 3).
 * @property {number} [maxExtraBytes]
 * @property {Buffer} [stdin] Données envoyées sur l'entrée (tests seulement).
 * @property {(line: string) => (string | void)} [onStderrLine] Lu au fil de
 *   l'eau ; une chaîne rendue arrête le programme (raison).
 */

/**
 * @typedef {object} RunResult
 * @property {number | null} exitCode
 * @property {Buffer} stdout
 * @property {Buffer} extra
 * @property {string} stderr
 * @property {"aborted" | "timeout" | "overflow" | string | null} stopReason
 * @property {string | null} spawnError Code système si le programme n'a pas pu être lancé (ex. ENOENT).
 */

/**
 * @param {string} command
 * @param {string[]} args
 * @param {RunOptions} options
 * @returns {Promise<RunResult>}
 */
export function runProgram(command, args, options) {
  const { env, signal, timeoutMs, maxStdoutBytes, maxStderrBytes = 64 * 1024, extraOutputFd, maxExtraBytes = 0, stdin, onStderrLine } = options;
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ exitCode: null, stdout: Buffer.alloc(0), extra: Buffer.alloc(0), stderr: "", stopReason: "aborted", spawnError: null });
      return;
    }
    /** @type {("ignore" | "pipe")[]} */
    const stdio = [stdin ? "pipe" : "ignore", "pipe", "pipe"];
    if (extraOutputFd !== undefined) {
      while (stdio.length < extraOutputFd) stdio.push("ignore");
      stdio.push("pipe");
    }
    let child;
    try {
      // Groupe de processus à part : un arrêt tue aussi ce que le programme
      // aurait lancé lui-même.
      child = spawn(command, args, { env, stdio, shell: false, detached: true, windowsHide: true });
    } catch (error) {
      resolve({ exitCode: null, stdout: Buffer.alloc(0), extra: Buffer.alloc(0), stderr: "", stopReason: null, spawnError: errorCode(error) });
      return;
    }

    /** @type {Buffer[]} */
    const outChunks = [];
    /** @type {Buffer[]} */
    const extraChunks = [];
    let outBytes = 0;
    let extraBytes = 0;
    let stderrText = "";
    let pendingLine = "";
    /** @type {string | null} */
    let stopReason = null;
    /** @type {string | null} */
    let spawnError = null;
    let settled = false;

    const stop = (/** @type {string} */ reason) => {
      if (stopReason === null) stopReason = reason;
      killGroup(child);
    };
    const onAbort = () => stop("aborted");
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => stop("timeout"), Math.max(1, timeoutMs));

    child.stdout?.on("data", (/** @type {Buffer} */ chunk) => {
      outBytes += chunk.length;
      if (outBytes > maxStdoutBytes) {
        chunk.fill(0);
        stop("overflow");
        return;
      }
      outChunks.push(chunk);
    });
    if (extraOutputFd !== undefined) {
      const extraStream = /** @type {import("node:stream").Readable | null} */ (child.stdio[extraOutputFd]);
      extraStream?.on("data", (/** @type {Buffer} */ chunk) => {
        extraBytes += chunk.length;
        if (extraBytes > maxExtraBytes) {
          chunk.fill(0);
          stop("overflow");
          return;
        }
        extraChunks.push(chunk);
      });
    }
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (/** @type {string} */ text) => {
      stderrText += text;
      if (stderrText.length > maxStderrBytes) stderrText = stderrText.slice(-maxStderrBytes);
      if (!onStderrLine) return;
      pendingLine += text;
      const lines = pendingLine.split(/\r?\n|\r/);
      pendingLine = lines.pop() ?? "";
      if (pendingLine.length > 16 * 1024) pendingLine = pendingLine.slice(-16 * 1024);
      for (const line of lines) {
        const reason = onStderrLine(line);
        if (typeof reason === "string") stop(reason);
      }
    });
    if (stdin && child.stdin) {
      child.stdin.on("error", () => undefined);
      child.stdin.end(stdin);
    }

    const finish = (/** @type {number | null} */ code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (onStderrLine && pendingLine) {
        const reason = onStderrLine(pendingLine);
        if (typeof reason === "string" && stopReason === null) stopReason = reason;
      }
      const stdout = Buffer.concat(outChunks);
      const extra = Buffer.concat(extraChunks);
      for (const chunk of outChunks) chunk.fill(0);
      for (const chunk of extraChunks) chunk.fill(0);
      resolve({ exitCode: code, stdout, extra, stderr: stderrText, stopReason, spawnError });
    };
    child.on("error", (error) => {
      spawnError = errorCode(error);
      // Programme introuvable : jamais lancé, rien à attendre.
      if (child.pid === undefined) finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

/** @param {import("node:child_process").ChildProcess} child */
function killGroup(child) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // Déjà terminé.
    }
  }
}

/** @param {unknown} error */
function errorCode(error) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "spawn_failed";
}
