// Serveur HTTP du service vidéo : POST /frames (avec le secret) et GET
// /health (sans secret). Contrat : contract.js et README.md.
import http from "node:http";
import { finished } from "node:stream/promises";
import { createAuthorizer } from "./config.js";
import { LIMITS, WorkerError } from "./contract.js";
import { extractFrames } from "./job.js";
import { Limiter } from "./limiter.js";
import { createLogger, durationBucket } from "./log.js";
import { childEnvironment } from "./run.js";
import { acceptedVideoUrl } from "./urls.js";

const JSON_TYPE = /^application\/json\s*(?:;.*)?$/i;

/**
 * @typedef {object} WorkerOptions
 * @property {string | null} secret Secret valide (config.js) ; null : tout est refusé.
 * @property {{ ytDlp: string | null, ffmpeg: string | null }} [versions] Versions lues au démarrage.
 * @property {import("./log.js").Logger} [logger]
 * @property {Record<string, string>} [childEnv] Environnement des programmes.
 * @property {{ ytDlp: string, ffmpeg: string }} [tools] Noms des programmes (cherchés dans PATH).
 * @property {Partial<Pick<typeof LIMITS, "requestDeadlineMs" | "maxConcurrentJobs" | "maxQueuedJobs" | "maxQueueWaitMs">>} [limits] Tests seulement.
 */

/**
 * @param {WorkerOptions} options
 */
export function createWorker(options) {
  const { secret, versions = { ytDlp: null, ffmpeg: null }, logger = createLogger(), childEnv = childEnvironment(process.env), tools = { ytDlp: "yt-dlp", ffmpeg: "ffmpeg" } } = options;
  const limits = { ...LIMITS, ...options.limits };
  const authorize = createAuthorizer(secret);
  const limiter = new Limiter({ maxActive: limits.maxConcurrentJobs, maxQueued: limits.maxQueuedJobs, maxWaitMs: limits.maxQueueWaitMs });
  const totals = { served: 0, failed: 0 };
  /** @type {Set<Promise<void>>} */
  const running = new Set();
  let shuttingDown = false;

  const server = http.createServer((request, response) => {
    // Une demande compte jusqu'à la fin de l'ENVOI de sa réponse, pas
    // seulement jusqu'à response.end() : quelques Mo d'images partent encore
    // après, et un arrêt propre (close) ne doit pas couper ce transfert.
    const task = route(request, response)
      .catch(() => {
        send(response, 500, { error: "unavailable" }, { close: true });
      })
      .then(() => finished(response).catch(() => undefined));
    running.add(task);
    task.finally(() => running.delete(task));
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = limits.requestDeadlineMs + 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  server.maxConnections = 64;

  /** @param {http.IncomingMessage} request @param {http.ServerResponse} response */
  async function route(request, response) {
    const path = (request.url ?? "/").split("?")[0];
    if (path === "/health") {
      if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, { error: "bad_request" }, { allow: "GET, HEAD", close: true });
      return health(request, response);
    }
    if (path === "/frames") {
      if (request.method !== "POST") return send(response, 405, { error: "bad_request" }, { allow: "POST", close: true });
      return frames(request, response);
    }
    return send(response, 404, { error: "bad_request" }, { close: true });
  }

  /** @param {http.IncomingMessage} request @param {http.ServerResponse} response */
  function health(request, response) {
    request.resume();
    const ready = secret !== null && versions.ytDlp !== null && versions.ffmpeg !== null && !shuttingDown;
    send(response, ready ? 200 : 503, { status: ready ? "ok" : "unavailable", ytDlp: versions.ytDlp, ffmpeg: versions.ffmpeg }, { head: request.method === "HEAD" });
  }

  /** @param {http.IncomingMessage} request @param {http.ServerResponse} response */
  async function frames(request, response) {
    const startedAt = Date.now();
    const deadlineAt = startedAt + limits.requestDeadlineMs;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort("deadline"), limits.requestDeadlineMs);
    // La personne en face a raccroché : tout s'arrête (programmes compris).
    const onClose = () => {
      if (!response.writableFinished) controller.abort("client_gone");
    };
    response.on("close", onClose);
    /** @type {import("./job.js").JobStats} */
    const stats = { attempts: 0, ytDlpMs: 0, downloadMs: 0, downloadAttempts: 0, mediaKb: undefined, ffmpegMs: 0, mode: undefined, codec: undefined, candidates: undefined, frames: undefined, durationSeconds: undefined };
    /** @type {(() => void) | null} */
    let releaseSlot = null;
    /** @type {(() => void) | null} */
    let releaseImages = null;
    /** @type {string | undefined} */
    let platform;
    // Présence seulement du champ atSeconds dans le journal, jamais sa valeur.
    let moment = false;
    let result = "ok";
    let detail = "ok";
    let status = 200;
    try {
      if (shuttingDown) throw new WorkerError("busy", "shutting_down");
      if (!authorize(request.headers.authorization)) throw new WorkerError("unauthorized");
      const body = await readJsonBody(request, limits.maxBodyBytes, controller.signal);
      const url = isRecord(body) ? acceptedVideoUrl(body.url, body.platform, limits.maxUrlLength) : null;
      if (!url || !isRecord(body)) throw new WorkerError("bad_request", "url_refused");
      platform = String(body.platform);
      // Image du moment (retours du build 3) : `atSeconds` facultatif ; absent,
      // rien ne change. Refusé AVANT toute place prise dans le limiteur.
      const atSeconds = momentField(body.atSeconds, limits.maxVideoSeconds);
      moment = atSeconds !== undefined;
      releaseSlot = await limiter.acquire(controller.signal);
      const job = await extractFrames({ url, platform, atSeconds }, { env: childEnv, signal: controller.signal, deadlineAt, tools, stats });
      releaseImages = job.release;
      if (controller.signal.aborted) throw new WorkerError("timeout", "deadline");
      send(response, 200, job.body);
      totals.served += 1;
    } catch (error) {
      const failure = toWorkerError(error, controller.signal);
      result = failure.code;
      detail = failure.detail;
      status = failure.status;
      totals.failed += 1;
      // Erreur avant la lecture du corps : la connexion est fermée.
      send(response, failure.status, { error: failure.code }, { close: !request.complete });
    } finally {
      clearTimeout(deadline);
      response.off("close", onClose);
      releaseImages?.();
      releaseSlot?.();
      logger.info("frames", {
        result,
        detail,
        status,
        platform,
        moment,
        ms: Date.now() - startedAt,
        attempts: stats.attempts,
        ytDlpMs: stats.ytDlpMs,
        downloadMs: stats.downloadMs,
        downloadAttempts: stats.downloadAttempts,
        mediaKb: stats.mediaKb,
        ffmpegMs: stats.ffmpegMs,
        mode: stats.mode,
        codec: stats.codec,
        duration: durationBucket(stats.durationSeconds),
        candidates: stats.candidates,
        frames: stats.frames,
        active: limiter.active,
        queued: limiter.queued,
        served: totals.served,
        failed: totals.failed,
      });
    }
  }

  return {
    server,
    totals,
    limiter,
    /** @param {number} port @param {string} [host] */
    listen(port, host = "0.0.0.0") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const address = server.address();
          resolve(typeof address === "object" && address ? address.port : port);
        });
      });
    },
    /**
     * Arrêt propre : plus aucune nouvelle demande, celles en cours finissent
     * (25 s au plus, leur propre délai) et leur réponse part en entier, puis
     * les connexions sont fermées (au plus tard après `graceMs`).
     * @param {number} [graceMs]
     */
    async close(graceMs = limits.requestDeadlineMs + 2_000) {
      shuttingDown = true;
      const closed = new Promise((resolve) => server.close(() => resolve(undefined)));
      server.closeIdleConnections();
      await Promise.race([Promise.allSettled([...running]), new Promise((resolve) => setTimeout(resolve, graceMs).unref())]);
      server.closeAllConnections();
      await closed;
    },
  };
}

/**
 * Corps JSON de la demande, lu avec un plafond.
 * @param {http.IncomingMessage} request
 * @param {number} maxBytes
 * @param {AbortSignal} signal
 * @returns {Promise<unknown>}
 */
function readJsonBody(request, maxBytes, signal) {
  return new Promise((resolve, reject) => {
    const type = request.headers["content-type"];
    if (typeof type !== "string" || !JSON_TYPE.test(type)) {
      reject(new WorkerError("bad_request", "content_type"));
      return;
    }
    const declared = Number(request.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new WorkerError("bad_request", "body_too_large"));
      return;
    }
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (/** @type {() => void} */ action) => {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", onAbort);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      action();
    };
    const onAbort = () => finish(() => reject(new WorkerError("timeout", "deadline")));
    const onData = (/** @type {Buffer} */ chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        finish(() => reject(new WorkerError("bad_request", "body_too_large")));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () =>
      finish(() => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new WorkerError("bad_request", "bad_json"));
        }
      });
    const onError = () => finish(() => reject(new WorkerError("bad_request", "body_read")));
    signal.addEventListener("abort", onAbort, { once: true });
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}

/**
 * Toute erreur → erreur du contrat. Annulation : « timeout » (délai) ou
 * départ de la personne en face (rien n'est alors envoyé).
 * @param {unknown} error
 * @param {AbortSignal} signal
 */
function toWorkerError(error, signal) {
  if (signal.aborted && signal.reason === "client_gone") return new WorkerError("timeout", "client_gone");
  if (signal.aborted) return new WorkerError("timeout", "deadline");
  if (error instanceof WorkerError) return error;
  return new WorkerError("unavailable", "internal");
}

/**
 * @param {http.ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 * @param {{ allow?: string, close?: boolean, head?: boolean }} [extra]
 */
function send(response, status, body, extra = {}) {
  if (response.headersSent || response.destroyed || response.writableEnded) return;
  const json = JSON.stringify(body);
  /** @type {Record<string, string | number>} */
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  if (extra.allow) headers.allow = extra.allow;
  if (extra.close) headers.connection = "close";
  response.writeHead(status, headers);
  response.end(extra.head ? undefined : json);
}

/**
 * Champ facultatif `atSeconds` : absent → undefined ; sinon un nombre fini
 * de 0 à `maxSeconds` (un texte, NaN ou l'infini sont refusés).
 * @param {unknown} value
 * @param {number} maxSeconds
 * @returns {number | undefined}
 */
export function momentField(value, maxSeconds) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maxSeconds) throw new WorkerError("bad_request", "at_refused");
  return value;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

