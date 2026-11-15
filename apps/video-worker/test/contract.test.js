// Contrat HTTP du service vidéo, avec les faux yt-dlp et ffmpeg : secret,
// refus des adresses (SSRF), forme de la réponse, images choisies, arguments
// donnés aux programmes. Aucun appel au réseau (boucle locale seulement).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { fakeIndexOf, instagram, sceneOf, SECRET, startWorker, tiktok } from "./helpers.js";

/** @type {Awaited<ReturnType<typeof startWorker>>} */
let service;
before(async () => {
  service = await startWorker();
});
after(async () => {
  await service.stop();
});

describe("GET /health", () => {
  it("sans secret : statut et versions de yt-dlp et de ffmpeg", async () => {
    const response = await fetch(`${service.base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", ytDlp: "2026.10.26", ffmpeg: "7.1.2-0+deb13u1" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("service sans secret valide : /health répond 503 (à vérifier après chaque déploiement) et tout est refusé", async () => {
    const closed = await startWorker({ secret: null });
    try {
      const response = await fetch(`${closed.base}/health`);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).status, "unavailable");
      const frames = await closed.frames(tiktok("ok8"), { auth: "Bearer " });
      assert.equal(frames.status, 401);
      assert.deepEqual(frames.body, { error: "unauthorized" });
      const withAnything = await closed.frames(tiktok("ok8"), { auth: `Bearer ${SECRET}` });
      assert.equal(withAnything.status, 401);
      assert.equal(closed.records("yt-dlp").length, 0);
    } finally {
      await closed.stop();
    }
  });
});

describe("POST /frames : secret et corps de la demande", () => {
  it("sans secret, mauvais secret ou autre schéma : 401, aucun programme lancé", async () => {
    for (const auth of [null, "Bearer mauvais-secret-mais-assez-long-0123456789", `Basic ${SECRET}`, `Bearer ${SECRET}x`, `Bearer  ${SECRET}`, SECRET]) {
      const result = await service.frames(tiktok("ok8"), { auth });
      assert.equal(result.status, 401, String(auth));
      assert.deepEqual(result.body, { error: "unauthorized" });
    }
    assert.equal(service.records("yt-dlp").length, 0);
  });

  it("type, taille ou JSON invalides : 400 bad_request", async () => {
    assert.equal((await service.frames(tiktok("ok8"), { contentType: "text/plain" })).status, 400);
    assert.equal((await service.frames("{pas du json")).status, 400);
    assert.equal((await service.frames(JSON.stringify({ ...tiktok("ok8"), pad: "x".repeat(5000) }))).status, 400);
    assert.equal((await service.frames([tiktok("ok8")])).status, 400);
    assert.equal((await service.frames({ url: tiktok("ok8").url })).status, 400);
    assert.deepEqual((await service.frames("null")).body, { error: "bad_request" });
  });

  it("adresses refusées (SSRF) : jamais transmises à yt-dlp", async () => {
    const before = service.records("yt-dlp").length;
    const refused = [
      { url: "http://www.tiktok.com/@ok8/video/7000000000000000001", platform: "tiktok" },
      { url: "https://www.tiktok.com.evil.test/@ok8/video/7000000000000000001", platform: "tiktok" },
      { url: "https://169.254.169.254/latest/meta-data/", platform: "tiktok" },
      { url: "https://autre-service:10000/frames", platform: "tiktok" },
      { url: "file:///etc/passwd", platform: "tiktok" },
      { url: "https://www.youtube.com/watch?v=abc", platform: "tiktok" },
      { url: "https://www.tiktok.com/@ok8/video/7000000000000000001?redirect=http://x", platform: "tiktok" },
      { url: "https://www.instagram.com/reel/scn_login/", platform: "tiktok" },
      { url: "https://www.tiktok.com/@ok8/video/7000000000000000001", platform: "instagram" },
    ];
    for (const body of refused) {
      const result = await service.frames(body);
      assert.equal(result.status, 400, body.url);
      assert.deepEqual(result.body, { error: "bad_request" });
    }
    assert.equal(service.records("yt-dlp").length, before);
  });

  it("autre route ou autre méthode : refus, sans détail", async () => {
    assert.equal((await fetch(`${service.base}/`)).status, 404);
    assert.equal((await fetch(`${service.base}/frames`)).status, 405);
    assert.equal((await fetch(`${service.base}/health`, { method: "POST" })).status, 405);
  });
});

describe("POST /frames : réponse", () => {
  it("vidéo de 30 s : forme du contrat, 6 à 12 images distinctes, nettes, dans l'ordre, 1 280 px au plus", async () => {
    const result = await service.frames(tiktok("ok30"));
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(Object.keys(result.body).sort(), ["durationSeconds", "frames"]);
    assert.equal(result.body.durationSeconds, 30);
    const frames = result.body.frames;
    assert.ok(frames.length >= 6 && frames.length <= 12, String(frames.length));
    // Le faux ffmpeg numérote ses images : retrouve le plan de chaque image rendue.
    const scenes = frames.map((/** @type {any} */ frame) => sceneOf(fakeIndexOf(frame.jpegBase64)));
    assert.ok(scenes.every((scene) => scene !== null), "aucune image noire ni floue");
    assert.equal(new Set(scenes).size, frames.length, "aucun quasi-doublon");
    for (let i = 0; i < frames.length; i += 1) {
      const frame = frames[i];
      assert.deepEqual(Object.keys(frame).sort(), ["height", "jpegBase64", "timeSeconds", "width"]);
      assert.equal(frame.width, 72);
      assert.equal(frame.height, 128);
      assert.ok(frame.timeSeconds >= 0 && frame.timeSeconds <= 30);
      if (i > 0) assert.ok(frame.timeSeconds > frames[i - 1].timeSeconds);
      const jpeg = Buffer.from(frame.jpegBase64, "base64");
      assert.equal(jpeg.subarray(0, 2).toString("hex"), "ffd8");
      assert.equal(jpeg.subarray(-2).toString("hex"), "ffd9");
    }
    // Du début à la fin de la vidéo.
    assert.ok(frames[0].timeSeconds < 5);
    assert.ok(frames[frames.length - 1].timeSeconds > 24);
  });

  it("vidéo de 80 s : images clés seulement, jusqu'à 16 images", async () => {
    const result = await service.frames(tiktok("long80"));
    assert.equal(result.status, 200);
    assert.equal(result.body.durationSeconds, 80);
    assert.ok(result.body.frames.length >= 6 && result.body.frames.length <= 16);
    const ffmpeg = service.records("ffmpeg").at(-1);
    assert.equal(ffmpeg.args[ffmpeg.args.indexOf("-skip_frame") + 1], "nokey");
  });

  it("vidéo presque fixe : au moins 6 images quand même", async () => {
    const result = await service.frames(tiktok("static"));
    assert.equal(result.status, 200);
    assert.equal(result.body.frames.length, 6);
  });

  it("Instagram, carrousel : la vidéo du carrousel", async () => {
    const result = await service.frames(instagram("scn_carousel"));
    assert.equal(result.status, 200);
    assert.equal(result.body.durationSeconds, 12);
  });

  it("image de plus de 1 Mo écartée, les autres rendues", async () => {
    const result = await service.frames(tiktok("bigframes"));
    assert.equal(result.status, 200);
    assert.ok(result.body.frames.every((/** @type {any} */ frame) => Buffer.from(frame.jpegBase64, "base64").length < 1_000_000));
    assert.ok(result.body.frames.every((/** @type {any} */ frame) => fakeIndexOf(frame.jpegBase64) >= 3), "les trois premières (trop lourdes) sont écartées");
  });
});

describe("programmes lancés : rien sur le disque, adresse du fichier en https, en-têtes repris", () => {
  it("yt-dlp : -J, sans cache ni fichier partiel, l'adresse canonique après « -- », environnement sans le secret", async () => {
    await service.frames(tiktok("ok8"));
    const ytDlp = service.records("yt-dlp").at(-1);
    assert.deepEqual(ytDlp.args.slice(-2), ["--", tiktok("ok8").url]);
    for (const flag of ["--dump-single-json", "--no-cache-dir", "--no-part", "--ignore-config"]) assert.ok(ytDlp.args.includes(flag), flag);
    assert.ok(!JSON.stringify(ytDlp).includes(SECRET));
  });

  it("ffmpeg : lit l'adresse https du format H.264 720p, avec User-Agent, Referer et cookies, sortie dans deux tuyaux", async () => {
    await service.frames(tiktok("ok30"));
    const { args } = service.records("ffmpeg").at(-1);
    const at = (/** @type {string} */ flag) => args[args.indexOf(flag) + 1];
    assert.equal(at("-i"), "https://media.example-cdn.test/v720.mp4?s=varied&d=30");
    assert.equal(at("-protocol_whitelist"), "https,tls,tcp");
    assert.equal(at("-f"), "mp4");
    assert.equal(at("-user_agent"), "Mozilla/5.0 (essai)");
    assert.equal(at("-referer"), "https://www.tiktok.com/");
    assert.equal(at("-headers"), "Accept: */*\r\n");
    assert.equal(at("-cookies"), "tt_chain_token=abc123; path=/; domain=.example-cdn.test;\nsid=xyz; path=/; domain=media.example-cdn.test;");
    assert.ok(!args.join(" ").includes("jamais=repris"), "l'en-tête Cookie de yt-dlp n'est jamais repris tel quel");
    assert.deepEqual(
      args.filter((/** @type {string} */ arg) => arg.startsWith("pipe:")),
      ["pipe:1", "pipe:3"]
    );
  });

  it("adresse du fichier refusée (IP, nom interne, port) : ffmpeg n'est jamais lancé", async () => {
    const before = service.records("ffmpeg").length;
    for (const scenario of ["mediaip", "mediainternal"]) {
      const result = await service.frames(tiktok(scenario));
      assert.equal(result.status, 502, scenario);
      assert.deepEqual(result.body, { error: "unavailable" });
    }
    const http = await service.frames(tiktok("mediahttp"));
    assert.equal(http.status, 422);
    assert.equal(service.records("ffmpeg").length, before);
  });

  it("journal : des compteurs et des codes, jamais l'adresse, l'identifiant ni une image", async () => {
    await service.frames(tiktok("ok8"));
    const text = JSON.stringify(service.logs);
    assert.ok(service.logs.some((entry) => entry.event === "frames" && entry.result === "ok" && entry.frames !== undefined));
    for (const forbidden of ["tiktok.com", "instagram.com", "7000000000000000001", "example-cdn", "scn_", "/9j/", SECRET]) assert.ok(!text.includes(forbidden), forbidden);
  });
});
