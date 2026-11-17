// Démarrage réel (node src/main.js) avec les faux programmes : versions dans
// /health, une demande servie, arrêt propre sur SIGTERM, refus de tout sans
// secret valide. Boucle locale seulement.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { childEnvironment } from "../src/run.js";
import { PATH_WITH_FAKES, SECRET, tiktok } from "./helpers.js";

const MAIN = fileURLToPath(new URL("../src/main.js", import.meta.url));

/** Un port libre de la boucle locale. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

/**
 * Lance le service ; attend la ligne « listening ».
 * @param {Record<string, string>} env
 */
async function launch(env) {
  const child = spawn(process.execPath, [MAIN], { env: { PATH: PATH_WITH_FAKES, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  /** @type {Record<string, unknown>[]} */
  const lines = [];
  let buffer = "";
  let output = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text) => {
    output += text;
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`service non démarré : ${output}`)), 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text) => {
      output += text;
      buffer += text;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = JSON.parse(part);
        lines.push(line);
        if (line.event === "listening") {
          clearTimeout(timer);
          resolve(line);
        }
      }
    });
    child.once("exit", () => reject(new Error(`service arrêté : ${output}`)));
  });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  await ready;
  return { child, lines, exited, output: () => output };
}

describe("démarrage réel", () => {
  it("versions dans /health, demande servie, arrêt propre sur SIGTERM ; le secret n'apparaît jamais dans le journal", async () => {
    const port = await freePort();
    const service = await launch({ VIDEO_WORKER_SECRET: SECRET, PORT: String(port) });
    try {
      const listening = service.lines.find((line) => line.event === "listening");
      assert.equal(listening?.port, port);
      assert.equal(listening?.secretConfigured, true);
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { status: "ok", ytDlp: "2026.10.26", ffmpeg: "7.1.2-0+deb13u1" });
      const frames = await fetch(`http://127.0.0.1:${port}/frames`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
        body: JSON.stringify(tiktok("ok8")),
      });
      assert.equal(frames.status, 200);
      assert.ok((await frames.json()).frames.length >= 6);
    } finally {
      service.child.kill("SIGTERM");
    }
    assert.deepEqual(await service.exited, { code: 0, signal: null });
    assert.ok(service.lines.some((line) => line.event === "stopped"));
    assert.ok(!service.output().includes(SECRET));
    assert.ok(!service.output().includes("tiktok.com"));
  });

  it("secret absent ou trop court : /health en 503, toute demande d'images refusée (401), avertissement sans valeur", async () => {
    const port = await freePort();
    const service = await launch({ PORT: String(port), VIDEO_WORKER_SECRET: "trop-court" });
    try {
      assert.ok(service.lines.some((line) => line.event === "config" && String(line.problem).startsWith("VIDEO_WORKER_SECRET")));
      assert.ok(!service.output().includes("trop-court"));
      assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 503);
      const frames = await fetch(`http://127.0.0.1:${port}/frames`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer trop-court" },
        body: JSON.stringify(tiktok("ok8")),
      });
      assert.equal(frames.status, 401);
    } finally {
      service.child.kill("SIGTERM");
    }
    assert.equal((/** @type {{ code: number }} */ (await service.exited)).code, 0);
  });

  it("les programmes ne reçoivent jamais le secret (environnement réduit)", () => {
    const env = childEnvironment({ PATH: "/usr/bin", VIDEO_WORKER_SECRET: SECRET, PORT: "10000", AWS_SECRET_ACCESS_KEY: "x" });
    assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "LC_ALL", "NO_COLOR", "PATH", "PYTHONDONTWRITEBYTECODE", "PYTHONIOENCODING", "PYTHONUNBUFFERED", "TMPDIR"]);
    assert.ok(!JSON.stringify(env).includes(SECRET));
  });
});
