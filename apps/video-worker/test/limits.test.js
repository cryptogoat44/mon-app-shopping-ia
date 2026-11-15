// Limites : 2 demandes à la fois et petite file (sinon 503 busy), délai
// global (programmes tués, 504 timeout), départ de la personne en face, arrêt
// propre. Faux programmes, aucun appel au réseau.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { isAlive, SECRET, startWorker, tiktok } from "./helpers.js";

describe("2 demandes à la fois, petite file d'attente", () => {
  it("2 traitées, 1 en file (rejetée après l'attente), 1 refusée tout de suite : 503 busy", async () => {
    const service = await startWorker({ limits: { maxConcurrentJobs: 2, maxQueuedJobs: 1, maxQueueWaitMs: 300 } });
    try {
      const started = Date.now();
      const results = await Promise.all([0, 1, 2, 3].map((i) => sleep(i * 40).then(() => service.frames(tiktok("hold")))));
      const statuses = results.map((result) => result.status).sort();
      assert.deepEqual(statuses, [200, 200, 503, 503]);
      for (const result of results.filter((r) => r.status === 503)) assert.deepEqual(result.body, { error: "busy" });
      const details = service.logs.filter((entry) => entry.result === "busy").map((entry) => entry.detail).sort();
      assert.deepEqual(details, ["queue_full", "queue_wait"]);
      assert.ok(Date.now() - started < 10_000);
      // Les places sont rendues : une nouvelle demande passe.
      assert.equal(service.worker.limiter.active, 0);
      assert.equal((await service.frames(tiktok("ok8"))).status, 200);
    } finally {
      await service.stop();
    }
  });

  it("une demande en file passe dès qu'une place se libère", async () => {
    const service = await startWorker({ limits: { maxConcurrentJobs: 1, maxQueuedJobs: 1, maxQueueWaitMs: 5_000 } });
    try {
      const results = await Promise.all([service.frames(tiktok("hold")), sleep(50).then(() => service.frames(tiktok("ok8")))]);
      assert.deepEqual(
        results.map((result) => result.status),
        [200, 200]
      );
    } finally {
      await service.stop();
    }
  });
});

describe("délai global", () => {
  it("yt-dlp trop lent : 504 timeout à l'heure, programme tué", async () => {
    const service = await startWorker({ limits: { requestDeadlineMs: 1_500 } });
    try {
      const started = Date.now();
      const result = await service.frames(tiktok("slow"));
      const elapsed = Date.now() - started;
      assert.equal(result.status, 504);
      assert.deepEqual(result.body, { error: "timeout" });
      // yt-dlp a son propre délai (celui de la demande moins la part de ffmpeg, 1 s au moins).
      assert.ok(elapsed >= 900 && elapsed < 4_000, String(elapsed));
      await sleep(200);
      const { pid } = service.records("yt-dlp").at(-1);
      assert.equal(isAlive(pid), false, "yt-dlp tué");
      assert.equal(service.worker.limiter.active, 0);
    } finally {
      await service.stop();
    }
  });

  it("ffmpeg trop lent : 504 timeout, programme tué", async () => {
    const service = await startWorker({ limits: { requestDeadlineMs: 1_500 } });
    try {
      const result = await service.frames(tiktok("ffslow"));
      assert.equal(result.status, 504);
      assert.deepEqual(result.body, { error: "timeout" });
      await sleep(200);
      const { pid } = service.records("ffmpeg").at(-1);
      assert.equal(isAlive(pid), false, "ffmpeg tué");
    } finally {
      await service.stop();
    }
  });

  it("la personne en face raccroche : le programme est tué et la place rendue", async () => {
    const service = await startWorker();
    try {
      const controller = new AbortController();
      const pending = fetch(`${service.base}/frames`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
        body: JSON.stringify(tiktok("slow")),
        signal: controller.signal,
      }).catch(() => null);
      await sleep(400);
      assert.equal(service.worker.limiter.active, 1);
      controller.abort();
      await pending;
      await sleep(300);
      const { pid } = service.records("yt-dlp").at(-1);
      assert.equal(isAlive(pid), false);
      assert.equal(service.worker.limiter.active, 0);
      assert.ok(service.logs.some((entry) => entry.detail === "client_gone"));
    } finally {
      await service.stop();
    }
  });
});

describe("arrêt propre", () => {
  it("la demande en cours finit ; ensuite, plus rien n'est accepté", async () => {
    const service = await startWorker();
    const pending = service.frames(tiktok("hold"));
    await sleep(200);
    const closing = service.worker.close(5_000);
    const result = await pending;
    assert.equal(result.status, 200);
    await closing;
    await assert.rejects(fetch(`${service.base}/health`));
    await service.stop();
  });
});
