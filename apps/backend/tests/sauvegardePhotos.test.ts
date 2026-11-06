// Copie hebdomadaire des photos (scripts/sauvegarder-photos.ts) : la logique
// du miroir, les garde-fous de la purge, la restauration, et les deux
// adaptateurs (Supabase, S3) avec des faux. Aucun réseau, aucune base.
import { describe, expect, it } from "vitest";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { ANALYSIS_BUCKET, USER_STORAGE_BUCKETS } from "../src/lib/storage.js";
import {
  BUCKETS_NOT_BACKED_UP,
  PHOTO_BUCKETS,
  PURGE_ALWAYS_ALLOWED,
  argValue,
  backupExitCode,
  describeBackup,
  describeRestore,
  parseBucket,
  parseFolder,
  planBucket,
  restorablePath,
  restorableType,
  runBackup,
  runRestore,
  sameProject,
  type BackupFile,
  type BackupLog,
  type FileBody,
  type PhotoBackupStore,
  type PhotoBucket,
  type PhotoSource,
  type SourceFile,
} from "../scripts/lib/sauvegarde-photos.js";
import { createSupabasePhotoSource, listBucketFiles, type StorageBucketLike } from "../scripts/lib/sauvegarde-photos-supabase.js";
import { createS3BackupStore, type S3Like } from "../scripts/lib/sauvegarde-photos-s3.js";

const USER = "0f3c9a52-7d1e-4b8a-9c11-2e5f6a7b8c9d";
const T0 = Date.parse("2026-11-01T10:00:00Z");

function src(path: string, size = 100, updatedAt: number | null = T0): SourceFile {
  return { path, size, updatedAt, contentType: "image/jpeg" };
}
function bak(key: string, size = 100, lastModified = T0 + 1000): BackupFile {
  return { key, size, lastModified };
}

// --- Faux côtés, en mémoire ------------------------------------------------

interface Stored {
  body: Uint8Array;
  contentType: string | null;
  updatedAt: number;
}

class FakeSource implements PhotoSource {
  files = new Map<string, Stored>();
  failList = new Set<PhotoBucket>();
  failDownload = new Set<string>();
  uploads: string[] = [];
  add(bucket: PhotoBucket, path: string, text: string, updatedAt = T0): void {
    this.files.set(`${bucket}/${path}`, { body: new TextEncoder().encode(text), contentType: "image/jpeg", updatedAt });
  }
  async listAll(bucket: PhotoBucket): Promise<SourceFile[]> {
    if (this.failList.has(bucket)) throw new Error("illisible");
    return [...this.files.entries()]
      .filter(([key]) => key.startsWith(`${bucket}/`))
      .map(([key, file]) => ({ path: key.slice(bucket.length + 1), size: file.body.length, updatedAt: file.updatedAt, contentType: file.contentType }));
  }
  async download(bucket: PhotoBucket, path: string): Promise<FileBody> {
    const key = `${bucket}/${path}`;
    const file = this.files.get(key);
    if (!file || this.failDownload.has(key)) throw new Error("absent");
    return { body: file.body, contentType: file.contentType };
  }
  async uploadNew(bucket: PhotoBucket, path: string, file: FileBody): Promise<void> {
    const key = `${bucket}/${path}`;
    if (this.files.has(key)) throw new Error("déjà présent");
    this.uploads.push(key);
    this.files.set(key, { body: file.body, contentType: file.contentType, updatedAt: T0 });
  }
}

class FakeBackup implements PhotoBackupStore {
  files = new Map<string, Stored & { lastModified: number }>();
  failList = false;
  failDelete = new Set<string>();
  now = T0 + 60_000;
  puts: string[] = [];
  deletes: string[] = [];
  async listAll(prefix: string): Promise<BackupFile[]> {
    if (this.failList) throw new Error("illisible");
    return [...this.files.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, file]) => ({ key, size: file.body.length, lastModified: file.lastModified }));
  }
  async put(key: string, file: FileBody): Promise<void> {
    this.puts.push(key);
    this.files.set(key, { ...file, updatedAt: this.now, lastModified: this.now });
  }
  async get(key: string): Promise<FileBody> {
    const file = this.files.get(key);
    if (!file) throw new Error("absent");
    return { body: file.body, contentType: file.contentType };
  }
  async delete(key: string): Promise<void> {
    if (this.failDelete.has(key)) throw new Error("refusé");
    this.deletes.push(key);
    this.files.delete(key);
  }
}

function memoryLog(): BackupLog & { lines: string[] } {
  const lines: string[] = [];
  return { lines, info: (m) => lines.push(m), warn: (m) => lines.push(m) };
}

// --- Les buckets ------------------------------------------------------------

describe("buckets copiés", () => {
  it("chaque bucket des comptes est soit copié, soit volontairement exclu", () => {
    const decided = [...PHOTO_BUCKETS, ...BUCKETS_NOT_BACKED_UP].sort();
    expect(decided).toEqual([...USER_STORAGE_BUCKETS].sort());
  });

  it("les images analysées ne sont jamais copiées", () => {
    expect(BUCKETS_NOT_BACKED_UP).toContain(ANALYSIS_BUCKET);
    expect(PHOTO_BUCKETS as readonly string[]).not.toContain(ANALYSIS_BUCKET);
  });
});

// --- Le plan d'un bucket ---------------------------------------------------

describe("planBucket", () => {
  const open = { allowLargePurge: false };

  it("copie les nouvelles photos et laisse celles déjà à jour", () => {
    const plan = planBucket("vault-media", [src(`${USER}/a.jpg`), src(`${USER}/b.jpg`)], [bak(`vault-media/${USER}/a.jpg`)], open);
    expect(plan.toCopy.map((f) => f.path)).toEqual([`${USER}/b.jpg`]);
    expect(plan.unchanged).toBe(1);
    expect(plan.toDelete).toEqual([]);
  });

  it("recopie une photo de taille différente ou modifiée après sa copie (photo de profil remplacée)", () => {
    const plan = planBucket(
      "avatars",
      [src(`${USER}/avatar.jpg`, 200), src("autre/avatar.jpg", 100, T0 + 5000), src("trois/avatar.jpg", 100, null)],
      [bak(`avatars/${USER}/avatar.jpg`, 100), bak("avatars/autre/avatar.jpg", 100, T0 + 1000), bak("avatars/trois/avatar.jpg")],
      open
    );
    expect(plan.toCopy.map((f) => f.path)).toEqual([`${USER}/avatar.jpg`, "autre/avatar.jpg"]);
    expect(plan.unchanged).toBe(1);
  });

  it("efface de la copie les photos disparues de Supabase, et seulement celles de ce bucket", () => {
    const plan = planBucket(
      "post-media",
      [src(`${USER}/a.jpg`)],
      [bak(`post-media/${USER}/a.jpg`), bak("post-media/supprime/x.jpg"), bak("vault-media/supprime/x.jpg"), bak("autre-chose/y.jpg")],
      open
    );
    expect(plan.toDelete).toEqual(["post-media/supprime/x.jpg"]);
    expect(plan.purgeBlocked).toBeNull();
  });

  it("bloque la purge si Supabase est vide alors que la copie ne l'est pas", () => {
    const plan = planBucket("vault-media", [], [bak("vault-media/a/1.jpg")], open);
    expect(plan.toDelete).toEqual([]);
    expect(plan.wouldDelete).toBe(1);
    expect(plan.purgeBlocked).toMatch(/aucune photo/);
  });

  it("bloque une purge de plus de 50 photos et de plus de 10 % de la copie", () => {
    const kept = Array.from({ length: 40 }, (_, i) => src(`k/${i}.jpg`));
    const backup = [...kept.map((f) => bak(`vault-media/${f.path}`)), ...Array.from({ length: 60 }, (_, i) => bak(`vault-media/d/${i}.jpg`))];
    const plan = planBucket("vault-media", kept, backup, open);
    expect(plan.toDelete).toEqual([]);
    expect(plan.wouldDelete).toBe(60);
    expect(plan.purgeBlocked).toMatch(/60 photos sur 100/);
    expect(planBucket("vault-media", kept, backup, { allowLargePurge: true }).toDelete).toHaveLength(60);
  });

  it("laisse passer une purge de 50 photos au plus, ou de moins de 10 % de la copie", () => {
    const few = planBucket(
      "vault-media",
      [src("k/1.jpg")],
      [bak("vault-media/k/1.jpg"), ...Array.from({ length: PURGE_ALWAYS_ALLOWED }, (_, i) => bak(`vault-media/d/${i}.jpg`))],
      open
    );
    expect(few.toDelete).toHaveLength(PURGE_ALWAYS_ALLOWED);
    const kept = Array.from({ length: 940 }, (_, i) => src(`k/${i}.jpg`));
    const share = planBucket(
      "vault-media",
      kept,
      [...kept.map((f) => bak(`vault-media/${f.path}`)), ...Array.from({ length: 60 }, (_, i) => bak(`vault-media/d/${i}.jpg`))],
      open
    );
    expect(share.toDelete).toHaveLength(60);
    expect(share.purgeBlocked).toBeNull();
  });

  it("ne fait rien d'un bucket illisible", () => {
    const plan = planBucket("vault-media", null, [bak("vault-media/a/1.jpg")], open);
    expect(plan.toCopy).toEqual([]);
    expect(plan.toDelete).toEqual([]);
  });
});

// --- Le passage complet ----------------------------------------------------

describe("runBackup", () => {
  it("copie, efface les disparues, et un second passage ne fait plus rien", async () => {
    const source = new FakeSource();
    const backup = new FakeBackup();
    source.add("vault-media", `${USER}/a.jpg`, "aaa");
    source.add("post-media", `${USER}/p.jpg`, "ppp");
    source.add("avatars", `${USER}/avatar.jpg`, "av");
    backup.files.set("vault-media/supprime/z.jpg", { body: new Uint8Array(3), contentType: null, updatedAt: T0, lastModified: T0 });
    const log = memoryLog();

    const reports = await runBackup(source, backup, log, { dryRun: false, allowLargePurge: false });
    expect(backup.puts.sort()).toEqual([`avatars/${USER}/avatar.jpg`, `post-media/${USER}/p.jpg`, `vault-media/${USER}/a.jpg`]);
    expect(backup.deletes).toEqual(["vault-media/supprime/z.jpg"]);
    expect(new TextDecoder().decode(backup.files.get(`vault-media/${USER}/a.jpg`)!.body)).toBe("aaa");
    expect(backupExitCode(reports)).toBe(0);

    backup.puts = [];
    backup.deletes = [];
    const again = await runBackup(source, backup, log, { dryRun: false, allowLargePurge: false });
    expect(backup.puts).toEqual([]);
    expect(backup.deletes).toEqual([]);
    expect(again.map((r) => r.unchanged)).toEqual([1, 1, 1]);
  });

  it("en essai, compte sans rien écrire ni effacer", async () => {
    const source = new FakeSource();
    const backup = new FakeBackup();
    source.add("vault-media", `${USER}/a.jpg`, "aaa");
    backup.files.set("vault-media/supprime/z.jpg", { body: new Uint8Array(3), contentType: null, updatedAt: T0, lastModified: T0 });
    const reports = await runBackup(source, backup, memoryLog(), { dryRun: true, allowLargePurge: false });
    expect(backup.puts).toEqual([]);
    expect(backup.deletes).toEqual([]);
    expect(reports[0]).toMatchObject({ bucket: "vault-media", copied: 1, deleted: 1 });
    expect(describeBackup(reports, true)[0]).toBe("vault-media : 1 photos dans Supabase, 1 à copier, 0 déjà à jour, 1 à effacer.");
  });

  it("une lecture de Supabase incomplète n'efface rien et finit en échec", async () => {
    const source = new FakeSource();
    const backup = new FakeBackup();
    source.failList.add("vault-media");
    backup.files.set(`vault-media/${USER}/a.jpg`, { body: new Uint8Array(3), contentType: null, updatedAt: T0, lastModified: T0 });
    const reports = await runBackup(source, backup, memoryLog(), { dryRun: false, allowLargePurge: true });
    expect(backup.deletes).toEqual([]);
    expect(reports[0]!.sourceFiles).toBeNull();
    expect(backupExitCode(reports)).toBe(1);
  });

  it("une copie illisible fait sauter le bucket et finit en échec", async () => {
    const source = new FakeSource();
    const backup = new FakeBackup();
    source.add("vault-media", `${USER}/a.jpg`, "aaa");
    backup.failList = true;
    const reports = await runBackup(source, backup, memoryLog(), { dryRun: false, allowLargePurge: false });
    expect(backup.puts).toEqual([]);
    expect(reports.every((r) => r.backupUnreadable)).toBe(true);
    expect(backupExitCode(reports)).toBe(1);
  });

  it("compte les copies et effacements échoués, sans s'arrêter", async () => {
    const source = new FakeSource();
    const backup = new FakeBackup();
    source.add("vault-media", `${USER}/a.jpg`, "aaa");
    source.add("vault-media", `${USER}/b.jpg`, "bbb");
    source.failDownload.add(`vault-media/${USER}/a.jpg`);
    backup.files.set("vault-media/supprime/z.jpg", { body: new Uint8Array(3), contentType: null, updatedAt: T0, lastModified: T0 });
    backup.failDelete.add("vault-media/supprime/z.jpg");
    const reports = await runBackup(source, backup, memoryLog(), { dryRun: false, allowLargePurge: false });
    expect(reports[0]).toMatchObject({ copied: 1, copyFailed: 1, deleted: 0, deleteFailed: 1 });
    expect(backupExitCode(reports)).toBe(1);
  });

  it("une purge bloquée copie quand même, n'efface rien et sort avec le code 2", async () => {
    const source = new FakeSource();
    const backup = new FakeBackup();
    source.add("avatars", `${USER}/avatar.jpg`, "av");
    for (let i = 0; i < 80; i += 1) {
      backup.files.set(`avatars/parti-${i}/avatar.jpg`, { body: new Uint8Array(2), contentType: null, updatedAt: T0, lastModified: T0 });
    }
    const log = memoryLog();
    const reports = await runBackup(source, backup, log, { dryRun: false, allowLargePurge: false });
    expect(backup.puts).toEqual([`avatars/${USER}/avatar.jpg`]);
    expect(backup.deletes).toEqual([]);
    expect(backupExitCode(reports)).toBe(2);
    expect(log.lines.some((line) => line.includes("purge bloquée"))).toBe(true);
  });

  it("le journal et le bilan ne contiennent jamais un chemin ni un identifiant de compte", async () => {
    const source = new FakeSource();
    const backup = new FakeBackup();
    source.add("vault-media", `${USER}/a.jpg`, "aaa");
    source.failDownload.add(`vault-media/${USER}/a.jpg`);
    source.failList.add("post-media");
    for (let i = 0; i < 80; i += 1) {
      backup.files.set(`avatars/${USER}-${i}/avatar.jpg`, { body: new Uint8Array(2), contentType: null, updatedAt: T0, lastModified: T0 });
    }
    const log = memoryLog();
    const reports = await runBackup(source, backup, log, { dryRun: false, allowLargePurge: false });
    const text = [...log.lines, ...describeBackup(reports, false)].join("\n");
    expect(text).not.toContain(USER);
    expect(text).not.toContain(".jpg");
  });
});

// --- La restauration -------------------------------------------------------

describe("runRestore", () => {
  function setup(): { source: FakeSource; backup: FakeBackup } {
    const source = new FakeSource();
    const backup = new FakeBackup();
    source.add("vault-media", `${USER}/garde.jpg`, "supabase");
    for (const key of [`vault-media/${USER}/garde.jpg`, `vault-media/${USER}/perdue.jpg`, "vault-media/autre/perdue.jpg", `avatars/${USER}/avatar.jpg`]) {
      backup.files.set(key, { body: new TextEncoder().encode("copie"), contentType: "image/jpeg", updatedAt: T0, lastModified: T0 });
    }
    return { source, backup };
  }

  it("remet seulement les photos absentes, sans jamais en remplacer une", async () => {
    const { source, backup } = setup();
    const reports = await runRestore(source, backup, memoryLog(), { dryRun: false });
    expect(source.uploads.sort()).toEqual([`avatars/${USER}/avatar.jpg`, `vault-media/${USER}/perdue.jpg`, "vault-media/autre/perdue.jpg"]);
    expect(new TextDecoder().decode(source.files.get(`vault-media/${USER}/garde.jpg`)!.body)).toBe("supabase");
    expect(reports.find((r) => r.bucket === "vault-media")).toMatchObject({ inBackup: 3, missing: 2, restored: 2, failed: 0 });
  });

  it("se limite à un bucket et à un compte", async () => {
    const { source, backup } = setup();
    await runRestore(source, backup, memoryLog(), { dryRun: false, bucket: "vault-media", folder: USER });
    expect(source.uploads).toEqual([`vault-media/${USER}/perdue.jpg`]);
  });

  it("refuse un chemin ou un type inattendu (copie trafiquée), sans s'arrêter", async () => {
    const { source, backup } = setup();
    const evil = (key: string, contentType: string) =>
      backup.files.set(key, { body: new TextEncoder().encode("x"), contentType, updatedAt: T0, lastModified: T0 });
    evil("vault-media/a/../../avatars/b/avatar.jpg", "image/jpeg");
    evil("vault-media/a/b/c.jpg", "image/jpeg");
    evil("vault-media/a/page.html", "text/html");
    evil("vault-media/a/dessin.svg", "image/svg+xml");
    const log = memoryLog();
    const reports = await runRestore(source, backup, log, { dryRun: false, bucket: "vault-media" });
    expect(source.uploads.sort()).toEqual([`vault-media/${USER}/perdue.jpg`, "vault-media/autre/perdue.jpg"]);
    expect(reports[0]).toMatchObject({ restored: 2, rejected: 4, failed: 0 });
    expect(log.lines.join("\n")).not.toContain("page.html");
  });

  it("n'accepte que « <compte>/<fichier> » et des types d'image", () => {
    expect(restorablePath("avatars", `avatars/${USER}/avatar.jpg`)).toBe(`${USER}/avatar.jpg`);
    expect(restorablePath("avatars", "vault-media/a/b.jpg")).toBeNull();
    expect(restorablePath("avatars", "avatars/a/../b.jpg")).toBeNull();
    expect(restorablePath("avatars", "avatars/a/..")).toBeNull();
    expect(restorablePath("avatars", "avatars/a/.cache")).toBeNull();
    expect(restorablePath("avatars", "avatars/a.jpg")).toBeNull();
    expect(restorableType("image/jpeg")).toBe(true);
    expect(restorableType("IMAGE/PNG")).toBe(true);
    expect(restorableType("image/svg+xml")).toBe(false);
    expect(restorableType("text/html")).toBe(false);
    expect(restorableType(null)).toBe(false);
  });

  it("en essai, compte sans rien écrire", async () => {
    const { source, backup } = setup();
    const reports = await runRestore(source, backup, memoryLog(), { dryRun: true });
    expect(source.uploads).toEqual([]);
    expect(describeRestore(reports, true)).toContain("vault-media : 3 photos dans la copie, 2 absentes de Supabase, 2 à restaurer.");
  });
});

// --- Le côté Supabase ------------------------------------------------------

type Entry = { name: string; id: string | null; updated_at?: string | null; metadata?: { size?: unknown; mimetype?: unknown } | null };

function fakeBucket(tree: Record<string, Entry[]>, options: { failPaths?: Set<string>; failuresBeforeSuccess?: number } = {}): StorageBucketLike & { calls: string[] } {
  const calls: string[] = [];
  let failures = options.failuresBeforeSuccess ?? 0;
  return {
    calls,
    async list(path, opts) {
      calls.push(`${path}@${opts.offset}`);
      if (options.failPaths?.has(path)) return { data: null, error: new Error("panne") };
      if (failures > 0) {
        failures -= 1;
        return { data: null, error: new Error("passagère") };
      }
      const entries = tree[path] ?? [];
      return { data: entries.slice(opts.offset, opts.offset + opts.limit), error: null };
    },
    async download() {
      return { data: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), error: null };
    },
    async upload() {
      return { error: null };
    },
  };
}

function file(name: string, size = 10): Entry {
  return { name, id: `id-${name}`, updated_at: "2026-11-01T10:00:00Z", metadata: { size, mimetype: "image/jpeg" } };
}

describe("listBucketFiles", () => {
  it("parcourt les dossiers des comptes et lit taille, date et type", async () => {
    const bucket = fakeBucket({
      "": [{ name: USER, id: null }, { name: "autre", id: null }, file("racine.jpg")],
      [USER]: [file("a.jpg", 11), file("b.jpg", 12)],
      autre: [file("c.jpg")],
    });
    const files = await listBucketFiles(bucket);
    expect(files.map((f) => f.path)).toEqual([`${USER}/a.jpg`, `${USER}/b.jpg`, "autre/c.jpg", "racine.jpg"]);
    expect(files[0]).toEqual({ path: `${USER}/a.jpg`, size: 11, updatedAt: T0, contentType: "image/jpeg" });
  });

  it("lit toutes les pages d'un grand dossier", async () => {
    const many = Array.from({ length: 1500 }, (_, i) => file(`${String(i).padStart(4, "0")}.jpg`));
    const bucket = fakeBucket({ "": [{ name: USER, id: null }], [USER]: many });
    const files = await listBucketFiles(bucket);
    expect(files).toHaveLength(1500);
    expect(bucket.calls).toEqual(["@0", `${USER}@0`, `${USER}@1000`]);
  });

  it("réessaie une panne passagère", async () => {
    const bucket = fakeBucket({ "": [file("a.jpg")] }, { failuresBeforeSuccess: 2 });
    expect(await listBucketFiles(bucket)).toHaveLength(1);
  });

  it("lève une erreur si un dossier reste illisible (jamais une liste incomplète)", async () => {
    const bucket = fakeBucket({ "": [{ name: USER, id: null }, { name: "ok", id: null }], ok: [file("a.jpg")] }, { failPaths: new Set([USER]) });
    await expect(listBucketFiles(bucket)).rejects.toThrow();
  });

  it("lève une erreur au-delà de la profondeur prévue", async () => {
    const bucket = fakeBucket({ "": [{ name: "a", id: null }], a: [{ name: "b", id: null }], "a/b": [{ name: "c", id: null }], "a/b/c": [{ name: "d", id: null }] });
    await expect(listBucketFiles(bucket)).rejects.toThrow();
  });

  it("télécharge et dépose sans remplacement", async () => {
    const uploads: { path: string; upsert: boolean; contentType?: string }[] = [];
    const bucket = fakeBucket({});
    bucket.upload = async (path, _body, options) => {
      uploads.push({ path, ...options });
      return { error: null };
    };
    const source = createSupabasePhotoSource({ from: () => bucket });
    const downloaded = await source.download("vault-media", "x/a.jpg");
    expect([...downloaded.body]).toEqual([1, 2, 3]);
    expect(downloaded.contentType).toBe("image/jpeg");
    await source.uploadNew("vault-media", "x/a.jpg", downloaded);
    expect(uploads).toEqual([{ path: "x/a.jpg", upsert: false, contentType: "image/jpeg" }]);
  });
});

// --- Le côté S3 -------------------------------------------------------------

describe("createS3BackupStore", () => {
  function fakeS3(pages: { Contents: { Key?: string; Size?: number; LastModified?: Date }[]; IsTruncated?: boolean; NextContinuationToken?: string }[]) {
    const sent: unknown[] = [];
    let page = 0;
    const client = {
      send: async (command: unknown) => {
        sent.push(command);
        if (command instanceof ListObjectsV2Command) return pages[page++] ?? { Contents: [] };
        if (command instanceof GetObjectCommand) {
          return { Body: { transformToByteArray: async () => new Uint8Array([7, 8]) }, ContentType: "image/jpeg" };
        }
        return {};
      },
    };
    return { client: client as unknown as S3Like, sent };
  }

  it("lit toutes les pages et ignore les « dossiers »", async () => {
    const { client, sent } = fakeS3([
      { Contents: [{ Key: "vault-media/a/1.jpg", Size: 5, LastModified: new Date(T0) }, { Key: "vault-media/a/" }], IsTruncated: true, NextContinuationToken: "suite" },
      { Contents: [{ Key: "vault-media/b/2.jpg", Size: 6, LastModified: new Date(T0 + 1) }] },
    ]);
    const files = await createS3BackupStore(client, "copie").listAll("vault-media/");
    expect(files).toEqual([
      { key: "vault-media/a/1.jpg", size: 5, lastModified: T0 },
      { key: "vault-media/b/2.jpg", size: 6, lastModified: T0 + 1 },
    ]);
    const inputs = sent.map((command) => (command as ListObjectsV2Command).input);
    expect(inputs).toEqual([
      { Bucket: "copie", Prefix: "vault-media/", ContinuationToken: undefined },
      { Bucket: "copie", Prefix: "vault-media/", ContinuationToken: "suite" },
    ]);
  });

  it("lève une erreur si la liste est tronquée sans suite", async () => {
    const { client } = fakeS3([{ Contents: [], IsTruncated: true }]);
    await expect(createS3BackupStore(client, "copie").listAll("avatars/")).rejects.toThrow();
  });

  it("écrit, lit et efface avec les bonnes commandes", async () => {
    const { client, sent } = fakeS3([]);
    const store = createS3BackupStore(client, "copie");
    await store.put("avatars/a/avatar.jpg", { body: new Uint8Array([1]), contentType: "image/jpeg" });
    const got = await store.get("avatars/a/avatar.jpg");
    await store.delete("avatars/a/avatar.jpg");
    expect(sent[0]).toBeInstanceOf(PutObjectCommand);
    expect((sent[0] as PutObjectCommand).input).toMatchObject({ Bucket: "copie", Key: "avatars/a/avatar.jpg", ContentType: "image/jpeg" });
    expect([...got.body]).toEqual([7, 8]);
    expect(sent[2]).toBeInstanceOf(DeleteObjectCommand);
    expect((sent[2] as DeleteObjectCommand).input).toEqual({ Bucket: "copie", Key: "avatars/a/avatar.jpg" });
  });
});

// --- Petits outils du script -----------------------------------------------

describe("outils du script", () => {
  it("lit --nom valeur et --nom=valeur", () => {
    expect(argValue(["--restaurer", "--bucket", "avatars"], "--bucket")).toBe("avatars");
    expect(argValue(["--bucket=post-media"], "--bucket")).toBe("post-media");
    expect(argValue(["--restaurer"], "--bucket")).toBeNull();
    expect(argValue(["--bucket"], "--bucket")).toBe("");
  });

  it("refuse une copie dans le projet Supabase protégé", () => {
    expect(sameProject("https://selhqdqfrflsqivgxypf.supabase.co", "https://selhqdqfrflsqivgxypf.storage.supabase.co/storage/v1/s3")).toBe(true);
    expect(sameProject("https://selhqdqfrflsqivgxypf.supabase.co", "https://abc123.r2.cloudflarestorage.com")).toBe(false);
    expect(sameProject("https://selhqdqfrflsqivgxypf.supabase.co", "https://sedfepcpmhilaxbrgdif.storage.supabase.co/storage/v1/s3")).toBe(false);
  });

  it("n'accepte que les trois buckets et un dossier d'un seul niveau", () => {
    expect(parseBucket("vault-media")).toBe("vault-media");
    expect(parseBucket("screenshots")).toBeNull();
    expect(parseFolder(`${USER}/`)).toBe(USER);
    expect(parseFolder("../autre")).toBeNull();
    expect(parseFolder("a/b")).toBeNull();
    expect(parseFolder("")).toBeNull();
  });
});
