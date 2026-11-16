// Le fichier servi depuis la mémoire sur la boucle locale (memserve.js) :
// requêtes partielles, une seule ressource, fermeture. Seul réseau : 127.0.0.1.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serveInMemory } from "../src/memserve.js";

describe("fichier servi depuis la mémoire (boucle locale)", () => {
  const data = Buffer.from(Array.from({ length: 1000 }, (_, index) => index % 256));

  it("127.0.0.1 seulement, chemin aléatoire, fichier entier et requêtes partielles", async () => {
    const served = await serveInMemory(data);
    try {
      assert.match(served.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\.mp4$/);
      const whole = await fetch(served.url);
      assert.equal(whole.status, 200);
      assert.equal(whole.headers.get("accept-ranges"), "bytes");
      assert.deepEqual(Buffer.from(await whole.arrayBuffer()), data);

      const first = await fetch(served.url, { headers: { range: "bytes=0-99" } });
      assert.equal(first.status, 206);
      assert.equal(first.headers.get("content-range"), "bytes 0-99/1000");
      assert.deepEqual(Buffer.from(await first.arrayBuffer()), data.subarray(0, 100));

      const tail = await fetch(served.url, { headers: { range: "bytes=900-" } });
      assert.equal(tail.headers.get("content-range"), "bytes 900-999/1000");
      assert.deepEqual(Buffer.from(await tail.arrayBuffer()), data.subarray(900));

      const suffix = await fetch(served.url, { headers: { range: "bytes=-10" } });
      assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), data.subarray(990));

      const past = await fetch(served.url, { headers: { range: "bytes=1000-" } });
      assert.equal(past.status, 416);
      await past.arrayBuffer();

      const head = await fetch(served.url, { method: "HEAD" });
      assert.equal(head.headers.get("content-length"), "1000");
    } finally {
      await served.close();
    }
  });

  it("une autre adresse ou une autre méthode : 404 ; après fermeture : plus rien", async () => {
    const served = await serveInMemory(data);
    const other = served.url.replace(/[0-9a-f]{32}/, "0".repeat(32));
    const wrong = await fetch(other);
    assert.equal(wrong.status, 404);
    await wrong.arrayBuffer();
    const post = await fetch(served.url, { method: "POST", body: "x" });
    assert.equal(post.status, 404);
    await post.arrayBuffer();
    await served.close();
    await served.close();
    await assert.rejects(fetch(served.url));
  });
});
