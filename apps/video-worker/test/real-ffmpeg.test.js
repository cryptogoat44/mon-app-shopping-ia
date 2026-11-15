// Vérification avec le VRAI ffmpeg, seulement s'il est installé sur la
// machine (sinon ignorée) : une vidéo de synthèse (lavfi testsrc2, H.264,
// 8 s, 720 × 1280) est fabriquée en mémoire, puis envoyée à ffmpeg sur son
// entrée standard avec exactement le graphe de filtres du service. Aucun
// fichier, aucun réseau. Vérifie aussi que la liste blanche refuse un
// fichier local et http, sans rien ouvrir.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { LIMITS } from "../src/contract.js";
import { extractCandidates } from "../src/ffmpeg.js";
import { buildBody } from "../src/job.js";
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

const noInput = { url: "https://inutile.example.test/v.mp4", headers: {}, cookies: [] };

describe("vrai ffmpeg (vidéo de synthèse, sans fichier ni réseau)", { skip }, () => {
  it("décodage complet : images JPEG de 720 × 1280, instants croissants, 6 à 12 images choisies", async () => {
    const video = syntheticVideo(8);
    const extracted = await extractCandidates(
      { input: noInput, mode: "full", stepSeconds: 0.5, override: { url: "pipe:0", protocolWhitelist: "pipe", stdin: video } },
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
      { input: noInput, mode: "keyframes", stepSeconds: 0.5, override: { url: "pipe:0", protocolWhitelist: "pipe", stdin: video } },
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

  it("liste blanche : un fichier local ou une adresse http sont refusés par ffmpeg lui-même, sans rien ouvrir", async () => {
    for (const url of ["file:///etc/hostname", "http://127.0.0.1:9/v.mp4"]) {
      await assert.rejects(
        extractCandidates({ input: { url, headers: {}, cookies: [] }, mode: "full", stepSeconds: 0.5 }, { env, signal: new AbortController().signal, timeoutMs: 10_000 }),
        (/** @type {any} */ error) => error.code === "unavailable" && error.detail === "media_protocol_refused",
        url
      );
    }
  });
});
