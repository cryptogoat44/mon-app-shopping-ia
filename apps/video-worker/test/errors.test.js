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
    { name: "fichier refusé par son serveur (403)", body: tiktok("media403"), status: 451, error: "blocked" },
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
    const text = JSON.stringify(service.logs);
    for (const forbidden of ["ERROR", "Your IP address", "status code", "7000000000000000001"]) assert.ok(!text.includes(forbidden), forbidden);
  });
});
