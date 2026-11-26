// Vérification avec le VRAI ffmpeg, seulement s'il est installé sur la
// machine (sinon ignorée) : une vidéo de synthèse (lavfi testsrc2, H.264,
// 8 s, 720 × 1280) est fabriquée, puis lue par ffmpeg avec exactement le
// graphe de filtres du service : sur son entrée standard, et servie depuis
// la mémoire sur la boucle locale (memserve.js), y compris un MP4 dont
// l'index est à la fin (illisible depuis un tuyau). Seul réseau : 127.0.0.1.
// Vérifie aussi que la liste blanche refuse un fichier local et https, et
// l'image du moment : une vidéo dont une barre blanche avance d'un pixel par
// image dit, dans l'image rendue, de quel instant elle vient.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { LIMITS } from "../src/contract.js";
import { extractCandidates } from "../src/ffmpeg.js";
import { buildBody } from "../src/job.js";
import { serveInMemory } from "../src/memserve.js";
import { childEnvironment } from "../src/run.js";

const env = childEnvironment(process.env);
const probe = spawnSync("ffmpeg", ["-hide_banner", "-version"], { env, encoding: "utf8" });
const hasFfmpeg = probe.status === 0;
const encoders = hasFfmpeg ? spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { env, encoding: "utf8" }).stdout : "";
const videoCodec = encoders.includes("libx264") ? ["-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-pix_fmt", "yuv420p"] : ["-c:v", "mpeg4", "-g", "30", "-q:v", "5"];
const skip = hasFfmpeg ? false : "ffmpeg n'est pas installé sur cette machine";

/** Vidéo de synthèse en MP4 fragmenté (lisible depuis un tuyau), en mémoire. */
function syntheticVideo(/** @type {number} */ seconds) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=duration=${seconds}:size=720x1280:rate=30`, ...videoCodec, "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"],
    { env, maxBuffer: 64 * 1024 * 1024 }
  );
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
}

/** MP4 ordinaire (index « moov » à la fin, comme beaucoup de fichiers
 * publiés), passé par un dossier temporaire du test puis lu en mémoire. */
function plainMp4(/** @type {number} */ seconds) {
  const dir = mkdtempSync(join(tmpdir(), "video-worker-mp4-"));
  try {
    const file = join(dir, "v.mp4");
    const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=duration=${seconds}:size=720x1280:rate=30`, ...videoCodec, file], { env, encoding: "utf8" });
    assert.equal(result.status, 0, String(result.stderr));
    return readFileSync(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Vidéo « compteur » (MP4 ordinaire, index à la fin) : une barre blanche
 * verticale à x = 20 + n (n = numéro de l'image, 30 images/s), sur un fond
 * en damier de 8 px (net, stable après réduction à 96 px). */
function counterMp4(/** @type {number} */ seconds) {
  const dir = mkdtempSync(join(tmpdir(), "video-worker-moment-"));
  try {
    const file = join(dir, "v.mp4");
    const lum = "if(lt(abs(X-(N+20)),2),255,40+40*mod(floor(X/8)+floor(Y/8),2))";
    const result = spawnSync(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=black:s=320x576:r=30:d=${seconds},format=gray,geq=lum='${lum}',format=yuv420p`, ...videoCodec, file],
      { env, encoding: "utf8" }
    );
    assert.equal(result.status, 0, String(result.stderr));
    return readFileSync(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Numéro de l'image lu dans un JPEG rendu : colonne la plus claire de la ligne du milieu, moins 20. */
function counterOf(/** @type {string} */ jpegBase64, /** @type {number} */ width, /** @type {number} */ height) {
  const gray = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], {
    env,
    input: Buffer.from(jpegBase64, "base64"),
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(gray.status, 0, String(gray.stderr));
  const row = gray.stdout.subarray(Math.floor(height / 2) * width, Math.floor(height / 2) * width + width);
  let brightest = 0;
  for (let x = 1; x < width; x += 1) if (row[x] > row[brightest]) brightest = x;
  return brightest - 20;
}

/** @param {Buffer} video */
const stdinInput = (video) => ({ url: "pipe:0", protocolWhitelist: "pipe", stdin: video });

describe("vrai ffmpeg (vidéo de synthèse, sans fichier ni réseau)", { skip }, () => {
  it("décodage complet : images JPEG de 720 × 1280, instants croissants, 6 à 12 images choisies", async () => {
    const video = syntheticVideo(8);
    const extracted = await extractCandidates(
      { input: stdinInput(video), mode: "full", stepSeconds: 0.5 },
      { env, signal: new AbortController().signal, timeoutMs: 20_000 }
    );
    try {
      assert.equal(extracted.candidates.length, 16);
      for (const [index, candidate] of extracted.candidates.entries()) {
        assert.equal(candidate.width, 720);
        assert.equal(candidate.height, 1280);
        assert.equal(candidate.jpeg.subarray(0, 2).toString("hex"), "ffd8");
        assert.equal(candidate.jpeg.subarray(-2).toString("hex"), "ffd9");
        assert.ok(candidate.jpeg.length < LIMITS.maxFrameBytes);
        assert.ok(Math.abs(candidate.timeSeconds - index * 0.5) < 0.05, `${index} : ${candidate.timeSeconds}`);
        assert.ok(candidate.sharpness > 0);
      }
      const stats = /** @type {any} */ ({});
      const body = buildBody(8, extracted, stats);
      assert.ok(body.frames.length >= 6 && body.frames.length <= 12, String(body.frames.length));
      for (let i = 1; i < body.frames.length; i += 1) assert.ok(body.frames[i].timeSeconds > body.frames[i - 1].timeSeconds);
    } finally {
      extracted.release();
    }
  });

  it("images clés seulement (-skip_frame nokey) : une image par seconde (images clés toutes les 30 images)", async () => {
    const video = syntheticVideo(8);
    const extracted = await extractCandidates(
      { input: stdinInput(video), mode: "keyframes", stepSeconds: 0.5 },
      { env, signal: new AbortController().signal, timeoutMs: 20_000 }
    );
    try {
      assert.equal(extracted.candidates.length, 8);
      assert.deepEqual(
        extracted.candidates.map((candidate) => Math.round(candidate.timeSeconds)),
        [0, 1, 2, 3, 4, 5, 6, 7]
      );
    } finally {
      extracted.release();
    }
  });

  it("fichier en mémoire servi sur la boucle locale : un MP4 à index final se lit comme un fichier", async () => {
    const video = plainMp4(8);
    // L'index est bien à la fin (« moov » après « mdat ») : depuis un tuyau, ffmpeg échouerait.
    assert.ok(video.indexOf("moov") > video.indexOf("mdat"));
    const served = await serveInMemory(video);
    let extracted;
    try {
      extracted = await extractCandidates({ input: { url: served.url, protocolWhitelist: "http,tcp" }, mode: "full", stepSeconds: 0.5 }, { env, signal: new AbortController().signal, timeoutMs: 20_000 });
    } finally {
      await served.close();
    }
    try {
      assert.equal(extracted.candidates.length, 16);
      assert.equal(extracted.candidates[0].width, 720);
      assert.ok(Math.abs((extracted.durationSeconds ?? 0) - 8) < 0.1);
    } finally {
      extracted.release();
    }
  });

  it("image du moment (fichier servi sur la boucle locale, -ss avant -i) : l'image de 3,2 s à une image près, et son instant vaut 3,2 s", async () => {
    const video = counterMp4(8);
    const served = await serveInMemory(video);
    let extracted;
    try {
      extracted = await extractCandidates({ input: { url: served.url, protocolWhitelist: "http,tcp" }, mode: "moment", atSeconds: 3.2 }, { env, signal: new AbortController().signal, timeoutMs: 20_000 });
    } finally {
      await served.close();
    }
    try {
      // Toute la seconde autour du moment (de 2,7 à 3,7 s), décodée en entier.
      assert.equal(extracted.candidates.length, 30);
      // Les instants de showinfo repartent de 0 après -ss : le point de départ (2,7 s) leur est ajouté.
      assert.ok(Math.abs(extracted.candidates[0].timeSeconds - 2.7) < 0.02, String(extracted.candidates[0].timeSeconds));
      const stats = /** @type {any} */ ({});
      const body = buildBody(8, extracted, stats, 3.2);
      assert.equal(body.frames.length, 1);
      const [frame] = body.frames;
      assert.ok(Math.abs(frame.timeSeconds - 3.2) <= 1 / 30 + 0.001, String(frame.timeSeconds));
      assert.equal(frame.width, 320);
      assert.equal(frame.height, 576);
      // L'image elle-même : la barre est à la position de l'image n° 96 (3,2 s × 30), à une image près.
      const counter = counterOf(frame.jpegBase64, frame.width, frame.height);
      assert.ok(Math.abs(counter - 96) <= 1, `image n° ${counter}`);
    } finally {
      extracted.release();
    }
  });

  it("image du moment tout au début (0 s) : départ à 0, la toute première image", async () => {
    const video = counterMp4(3);
    const served = await serveInMemory(video);
    let extracted;
    try {
      extracted = await extractCandidates({ input: { url: served.url, protocolWhitelist: "http,tcp" }, mode: "moment", atSeconds: 0 }, { env, signal: new AbortController().signal, timeoutMs: 20_000 });
    } finally {
      await served.close();
    }
    try {
      const body = buildBody(3, extracted, /** @type {any} */ ({}), 0);
      assert.equal(body.frames[0].timeSeconds, 0);
      assert.ok(Math.abs(counterOf(body.frames[0].jpegBase64, body.frames[0].width, body.frames[0].height)) <= 1);
    } finally {
      extracted.release();
    }
  });

  it("liste blanche : un fichier local ou une adresse https sont refusés par ffmpeg lui-même, sans rien ouvrir", async () => {
    for (const url of ["file:///etc/hostname", "https://127.0.0.1:9/v.mp4"]) {
      await assert.rejects(
        extractCandidates({ input: { url, protocolWhitelist: "http,tcp" }, mode: "full", stepSeconds: 0.5 }, { env, signal: new AbortController().signal, timeoutMs: 10_000 }),
        (/** @type {any} */ error) => error.code === "unavailable" && error.detail === "media_protocol_refused",
        url
      );
    }
  });
});
