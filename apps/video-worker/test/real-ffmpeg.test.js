// Vérification avec le VRAI ffmpeg, seulement s'il est installé sur la
// machine (sinon ignorée) : une vidéo de synthèse (lavfi testsrc2, H.264,
// 8 s, 720 × 1280) est fabriquée, puis lue par ffmpeg avec exactement le
// graphe de filtres du service : sur son entrée standard, et servie depuis
// la mémoire sur la boucle locale (memserve.js), y compris un MP4 dont
// l'index est à la fin (illisible depuis un tuyau). Seul réseau : 127.0.0.1.
// Vérifie aussi que la liste blanche refuse un fichier local et https.
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
