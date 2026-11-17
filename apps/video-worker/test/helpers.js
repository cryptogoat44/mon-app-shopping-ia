// Outils des tests : un service vidéo lancé sur 127.0.0.1 avec les faux
// yt-dlp et ffmpeg (test/fakes/bin, placés en tête de PATH). Aucun appel au
// réseau : seulement la boucle locale.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker } from "../src/app.js";
import { childEnvironment } from "../src/run.js";

export const FAKES_BIN = fileURLToPath(new URL("./fakes/bin", import.meta.url));
export const SECRET = "secret-de-test-0123456789-abcdefghijklmnop";
export const PATH_WITH_FAKES = `${FAKES_BIN}:${process.env.PATH ?? ""}`;

/** Adresse TikTok canonique dont le pseudo choisit le scénario du faux yt-dlp. */
export function tiktok(/** @type {string} */ scenario) {
  return { url: `https://www.tiktok.com/@${scenario}/video/7000000000000000001`, platform: "tiktok" };
}

export function instagram(/** @type {string} */ scenario) {
  return { url: `https://www.instagram.com/reel/${scenario}/`, platform: "instagram" };
}

/**
 * @param {{ limits?: Record<string, number>, secret?: string | null }} [options]
 */
export async function startWorker(options = {}) {
  const recordDir = mkdtempSync(join(tmpdir(), "video-worker-test-"));
  /** @type {Record<string, unknown>[]} */
  const logs = [];
  const logger = {
    info: (/** @type {string} */ event, /** @type {Record<string, unknown>} */ fields) => logs.push({ level: "info", event, ...fields }),
    warn: (/** @type {string} */ event, /** @type {Record<string, unknown>} */ fields) => logs.push({ level: "warn", event, ...fields }),
    error: (/** @type {string} */ event, /** @type {Record<string, unknown>} */ fields) => logs.push({ level: "error", event, ...fields }),
  };
  const worker = createWorker({
    secret: options.secret === undefined ? SECRET : options.secret,
    versions: { ytDlp: "2026.10.26", ffmpeg: "7.1.2-0+deb13u1" },
    logger,
    childEnv: { ...childEnvironment({ PATH: PATH_WITH_FAKES }), FAKE_RECORD_DIR: recordDir },
    limits: options.limits,
  });
  const port = await worker.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${port}`;
  return {
    worker,
    base,
    logs,
    recordDir,
    /** Arguments reçus par les faux programmes, dans l'ordre d'appel. */
    records(/** @type {"yt-dlp" | "ffmpeg"} */ tool) {
      return readdirSync(recordDir)
        .filter((name) => name.startsWith(`${tool}-`))
        .sort()
        .map((name) => JSON.parse(readFileSync(join(recordDir, name), "utf8")));
    },
    /**
     * @param {unknown} body
     * @param {{ auth?: string | null, contentType?: string }} [init]
     */
    async frames(body, init = {}) {
      /** @type {Record<string, string>} */
      const headers = { "content-type": init.contentType ?? "application/json" };
      const auth = init.auth === undefined ? `Bearer ${SECRET}` : init.auth;
      if (auth !== null) headers.authorization = auth;
      const response = await fetch(`${base}/frames`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
      const text = await response.text();
      return { status: response.status, body: JSON.parse(text), headers: response.headers };
    },
    async stop() {
      await worker.close(2_000);
      rmSync(recordDir, { recursive: true, force: true });
    },
  };
}

/** Le processus existe-t-il encore ? */
export function isAlive(/** @type {number} */ pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Numéro de l'image candidate, écrit par le faux ffmpeg dans un commentaire du JPEG. */
export function fakeIndexOf(/** @type {string} */ jpegBase64) {
  const match = /fake-index:(\d+)/.exec(Buffer.from(jpegBase64, "base64").toString("latin1"));
  if (!match) throw new Error("image sans numéro");
  return Number(match[1]);
}

/** Scénario « varied » du faux ffmpeg : plan d'une image candidate (null : noire ou floue). */
export function sceneOf(/** @type {number} */ index) {
  if (index === 0 || index % 5 === 4) return null;
  return Math.floor(index / 3);
}
