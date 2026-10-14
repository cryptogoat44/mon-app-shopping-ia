// Effacement des fichiers d'un compte (lot 5, décisions du fondateur du
// 2026-10-15) : un fichier qui refuse de s'effacer est compté, jamais ignoré,
// et ne bloque jamais la suite — même dans un dossier de plus de 100
// fichiers, où l'ancien code relisait sans fin les mêmes 100 fichiers.
// Faux stockage en mémoire : aucun appel réseau.
import { describe, expect, it } from "vitest";
import { emptyUserFolder, storageLeftovers, STORAGE_ATTEMPTS, type BucketFiles } from "../src/lib/storage.js";

const USER = "11111111-2222-3333-4444-555555555555";

interface FakeOptions {
  /** Nombre d'appels à `remove` qui échouent avant le premier succès (Infinity : toujours). */
  removeFailures?: number;
  /** `remove` répond « effacé » sans rien effacer. */
  lyingRemove?: boolean;
  /** Toute lecture échoue. */
  listFails?: boolean;
  /** Noms de sous-dossiers (id null) dans le dossier. */
  folders?: string[];
}

function fakeBucket(fileCount: number, options: FakeOptions = {}) {
  const names = Array.from({ length: fileCount }, (_, index) => `photo-${String(index).padStart(4, "0")}.jpg`);
  const stored = new Map<string, string | null>([...names.map((name): [string, string] => [name, `id-${name}`]), ...(options.folders ?? []).map((name): [string, null] => [name, null])]);
  const calls = { list: 0, remove: 0 };
  let failuresLeft = options.removeFailures ?? 0;
  const files: BucketFiles = {
    async list(path, { limit, offset, sortBy }) {
      calls.list += 1;
      expect(path).toBe(USER);
      expect(sortBy).toEqual({ column: "name", order: "asc" });
      if (options.listFails) return { data: null, error: new Error("lecture impossible") };
      const sorted = [...stored.keys()].sort();
      return { data: sorted.slice(offset, offset + limit).map((name) => ({ name, id: stored.get(name) ?? null })), error: null };
    },
    async remove(paths) {
      calls.remove += 1;
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        return { error: new Error("effacement refusé") };
      }
      if (!options.lyingRemove) for (const path of paths) stored.delete(path.slice(USER.length + 1));
      return { error: null };
    },
  };
  return { files, calls, remaining: () => stored.size };
}

describe("effacement du dossier d'un compte", () => {
  it("efface tout, page après page", async () => {
    const bucket = fakeBucket(250);
    const report = await emptyUserFolder(bucket.files, "post-media", USER);
    expect(report).toEqual({ bucket: "post-media", removed: 250, failed: 0, unreadable: false });
    expect(bucket.remaining()).toBe(0);
  });

  it("dossier vide : rien à faire", async () => {
    const report = await emptyUserFolder(fakeBucket(0).files, "avatars", USER);
    expect(report).toEqual({ bucket: "avatars", removed: 0, failed: 0, unreadable: false });
  });

  it("réessaie un effacement refusé une fois, puis réussit", async () => {
    const bucket = fakeBucket(3, { removeFailures: 1 });
    const report = await emptyUserFolder(bucket.files, "post-media", USER);
    expect(report.removed).toBe(3);
    expect(report.failed).toBe(0);
    expect(bucket.calls.remove).toBe(2);
  });

  it("un fichier qui refuse toujours de s'effacer est compté, avec un nombre borné d'essais", async () => {
    const bucket = fakeBucket(1, { removeFailures: Infinity });
    const report = await emptyUserFolder(bucket.files, "post-media", USER);
    expect(report).toEqual({ bucket: "post-media", removed: 0, failed: 1, unreadable: false });
    expect(bucket.calls.remove).toBe(STORAGE_ATTEMPTS);
    expect(storageLeftovers([report])).toEqual([{ bucket: "post-media", failed: 1, unreadable: false }]);
  });

  it("ne reste jamais bloqué dans un dossier de plus de 100 fichiers impossibles à effacer", async () => {
    const bucket = fakeBucket(150, { removeFailures: Infinity });
    const report = await emptyUserFolder(bucket.files, "post-media", USER);
    expect(report).toEqual({ bucket: "post-media", removed: 0, failed: 150, unreadable: false });
    // Deux pages, trois essais chacune : jamais la même page relue sans fin.
    expect(bucket.calls.remove).toBe(2 * STORAGE_ATTEMPTS);
    expect(bucket.calls.list).toBeLessThanOrEqual(3);
  });

  it("une page refusée n'empêche pas d'effacer les suivantes", async () => {
    const bucket = fakeBucket(200, { removeFailures: STORAGE_ATTEMPTS });
    const report = await emptyUserFolder(bucket.files, "vault-media", USER);
    expect(report).toEqual({ bucket: "vault-media", removed: 100, failed: 100, unreadable: false });
    expect(bucket.remaining()).toBe(100);
  });

  it("stockage qui dit « effacé » sans effacer : compté comme resté, sans boucle", async () => {
    const bucket = fakeBucket(120, { lyingRemove: true });
    const report = await emptyUserFolder(bucket.files, "post-media", USER);
    expect(report.failed + report.removed).toBe(220); // première page « effacée », relue puis comptée restée, puis la seconde
    expect(bucket.calls.list).toBeLessThanOrEqual(4);
  });

  it("dossier illisible : signalé, sans boucle", async () => {
    const bucket = fakeBucket(10, { listFails: true });
    const report = await emptyUserFolder(bucket.files, "screenshots", USER);
    expect(report).toEqual({ bucket: "screenshots", removed: 0, failed: 0, unreadable: true });
    expect(bucket.calls.list).toBe(STORAGE_ATTEMPTS);
    expect(storageLeftovers([report])).toEqual([{ bucket: "screenshots", failed: 0, unreadable: true }]);
  });

  it("un sous-dossier n'est pas effacé comme un fichier : compté comme resté", async () => {
    const bucket = fakeBucket(2, { folders: ["ancien-dossier"] });
    const report = await emptyUserFolder(bucket.files, "post-media", USER);
    expect(report).toEqual({ bucket: "post-media", removed: 2, failed: 1, unreadable: false });
  });

  it("le bilan pour le journal ne contient que des nombres par bucket", () => {
    const leftovers = storageLeftovers([
      { bucket: "avatars", removed: 1, failed: 0, unreadable: false },
      { bucket: "post-media", removed: 4, failed: 2, unreadable: false },
    ]);
    expect(leftovers).toEqual([{ bucket: "post-media", failed: 2, unreadable: false }]);
    expect(JSON.stringify(leftovers)).not.toContain(USER);
  });
});
