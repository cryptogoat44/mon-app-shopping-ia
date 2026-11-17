// Erreurs de yt-dlp et de ffmpeg (faux programmes) → codes et statuts du
// contrat ; second essai sur une erreur passagère ; durée vérifiée avant le
// décodage. Aucun appel au réseau.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { instagram, startWorker, tiktok } from "./helpers.js";

/** @type {Awaited<ReturnType<typeof startWorker>>} */
let service;
before(async () => {
  service = await startWorker();
});
after(async () => {
  await service.stop();
});

describe("erreurs → codes du contrat", () => {
  const cases = [
    { name: "vidéo privée", body: tiktok("private"), status: 404, error: "private" },
    { name: "vidéo supprimée", body: tiktok("removed"), status: 404, error: "not_found" },
    { name: "adresse IP du service bloquée", body: tiktok("ipblocked"), status: 451, error: "blocked" },
    { name: "vidéo limitée à certains pays", body: tiktok("geo"), status: 451, error: "blocked" },
    { name: "Instagram : connexion demandée ou limite anonyme", body: instagram("scn_login"), status: 451, error: "blocked" },
    { name: "Instagram : page bloquée derrière la connexion", body: instagram("scn_wall"), status: 451, error: "blocked" },
    { name: "adresse non prise en charge", body: tiktok("unsupported"), status: 422, error: "unsupported" },
    { name: "diaporama sans vidéo", body: tiktok("photo"), status: 422, error: "unsupported" },
    { name: "direct", body: tiktok("live"), status: 422, error: "unsupported" },
    { name: "JSON illisible", body: tiktok("badjson"), status: 502, error: "unavailable" },
    { name: "vidéo de plus de 90 s (durée de yt-dlp)", body: tiktok("toolong"), status: 413, error: "too_long" },
    { name: "fichier refusé à yt-dlp par son serveur (403)", body: tiktok("media403"), status: 451, error: "blocked" },
    { name: "fichier vide (plus gros que la limite, arrêté par yt-dlp)", body: tiktok("dlempty"), status: 502, error: "unavailable" },
    { name: "fichier introuvable chez le serveur de fichiers (404 au téléchargement)", body: tiktok("dl404"), status: 502, error: "unavailable" },
    { name: "format disparu au second passage", body: tiktok("dlformat"), status: 502, error: "unavailable" },
    { name: "ffmpeg ne rend aucune image", body: tiktok("ffgarbage"), status: 502, error: "unavailable" },
  ];
  for (const { name, body, status, error } of cases) {
    it(`${name} : ${status} ${error}`, async () => {
      const result = await service.frames(body);
      assert.equal(result.status, status);
      assert.deepEqual(result.body, { error });
    });
  }

  it("vidéo de plus de 90 s : ffmpeg n'est jamais lancé", async () => {
    const before = service.records("ffmpeg").length;
    await service.frames(tiktok("toolong"));
    assert.equal(service.records("ffmpeg").length, before);
  });

  it("durée absente chez yt-dlp mais annoncée à 120 s par ffmpeg : arrêt aussitôt, too_long", async () => {
    const startedAt = Date.now();
    const result = await service.frames(tiktok("nodur"));
    assert.equal(result.status, 413);
    assert.deepEqual(result.body, { error: "too_long" });
    assert.ok(Date.now() - startedAt < 5_000);
  });
});

describe("second essai", () => {
  it("erreur passagère de l'extracteur : un seul nouvel essai, puis unavailable", async () => {
    const before = service.records("yt-dlp").filter((entry) => entry.scenario === "broken").length;
    const result = await service.frames(tiktok("broken"));
    assert.equal(result.status, 502);
    assert.deepEqual(result.body, { error: "unavailable" });
    assert.equal(service.records("yt-dlp").filter((entry) => entry.scenario === "broken").length - before, 2);
  });

  it("erreur passagère puis réussite : les images sont rendues", async () => {
    const result = await service.frames(tiktok("flaky"));
    assert.equal(result.status, 200);
    assert.ok(result.body.frames.length >= 6);
    assert.ok(service.logs.some((entry) => entry.event === "frames" && entry.result === "ok" && entry.attempts === 2));
  });

  it("téléchargement : erreur passagère puis réussite, un seul nouvel essai du téléchargement", async () => {
    const before = service.records("yt-dlp").filter((entry) => entry.scenario === "dlflaky").length;
    const result = await service.frames(tiktok("dlflaky"));
    assert.equal(result.status, 200);
    assert.ok(result.body.frames.length >= 6);
    // Une lecture des informations, puis deux téléchargements.
    assert.equal(service.records("yt-dlp").filter((entry) => entry.scenario === "dlflaky").length - before, 3);
    assert.ok(service.logs.some((entry) => entry.event === "frames" && entry.result === "ok" && entry.downloadAttempts === 2));
  });

  it("fichier refusé (403) puis accepté : le second essai demande un autre fichier de la même vidéo", async () => {
    const downloads = () => service.records("yt-dlp").filter((entry) => entry.scenario === "media403once" && entry.args.includes("--output"));
    const result = await service.frames(tiktok("media403once"));
    assert.equal(result.status, 200);
    assert.ok(result.body.frames.length >= 6);
    const formats = downloads().map((entry) => entry.args[entry.args.indexOf("--format") + 1]);
    assert.equal(formats.length, 2);
    assert.ok(formats[0].startsWith("h264_720p/"), formats[0]);
    // Un autre fichier d'abord (petit de préférence), le format refusé seulement en dernier.
    assert.ok(formats[1].startsWith("best[ext=mp4][vcodec^=h264][protocol=https][format_id!=h264_720p][height<=1280]/"), formats[1]);
    assert.ok(formats[1].endsWith("/h264_720p"), formats[1]);
    assert.ok(service.logs.some((entry) => entry.event === "frames" && entry.result === "ok" && entry.downloadAttempts === 2));
  });

  it("fichier toujours refusé (403) : un seul nouvel essai, puis blocked", async () => {
    const downloads = () => service.records("yt-dlp").filter((entry) => entry.scenario === "media403" && entry.args.includes("--output")).length;
    const before = downloads();
    const result = await service.frames(tiktok("media403"));
    assert.equal(result.status, 451);
    assert.deepEqual(result.body, { error: "blocked" });
    assert.equal(downloads() - before, 2);
  });

  it("erreur définitive (vidéo privée) : aucun nouvel essai", async () => {
    const before = service.records("yt-dlp").filter((entry) => entry.scenario === "private").length;
    await service.frames(tiktok("private"));
    assert.equal(service.records("yt-dlp").filter((entry) => entry.scenario === "private").length - before, 1);
  });
});

describe("journal des erreurs", () => {
  it("le code et un détail fixe, jamais le message de yt-dlp", () => {
    const failures = service.logs.filter((entry) => entry.event === "frames" && entry.result !== "ok");
    assert.ok(failures.some((entry) => entry.result === "blocked" && entry.detail === "ip_blocked"));
    assert.ok(failures.some((entry) => entry.result === "blocked" && entry.detail === "geo_restricted"));
    assert.ok(failures.some((entry) => entry.result === "too_long" && entry.detail === "too_long_metadata"));
    assert.ok(failures.some((entry) => entry.result === "blocked" && entry.detail === "media_forbidden"));
    assert.ok(failures.some((entry) => entry.result === "unavailable" && entry.detail === "media_empty"));
    assert.ok(failures.some((entry) => entry.result === "unavailable" && entry.detail === "media_not_found"));
    assert.ok(failures.some((entry) => entry.result === "unavailable" && entry.detail === "format_unavailable"));
    const text = JSON.stringify(service.logs);
    for (const forbidden of ["ERROR", "Your IP address", "status code", "7000000000000000001"]) assert.ok(!text.includes(forbidden), forbidden);
  });
});
