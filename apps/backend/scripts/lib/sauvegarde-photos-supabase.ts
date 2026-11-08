// Copie des photos : le côté Supabase (lecture des buckets, téléchargement,
// dépôt sans remplacement pour la restauration). Voir sauvegarde-photos.ts.
import type { FileBody, PhotoBucket, PhotoSource, SourceFile } from "./sauvegarde-photos.js";

const PAGE_SIZE = 1000;
/** Garde-fou : au plus 1 000 pages (un million d'entrées) par dossier. */
const MAX_PAGES = 1000;
/** Profondeur maximale : « <compte>/<photo> » aujourd'hui ; une marge d'un niveau. */
const MAX_DEPTH = 3;
const ATTEMPTS = 3;

interface ListedEntry {
  name: string;
  id: string | null;
  updated_at?: string | null;
  metadata?: { size?: unknown; mimetype?: unknown } | null;
}

/** Ce dont la copie a besoin d'un bucket Supabase (le vrai client, ou un faux). */
export interface StorageBucketLike {
  list(
    path: string,
    options: { limit: number; offset: number; sortBy: { column: string; order: string } }
  ): PromiseLike<{ data: ListedEntry[] | null; error: unknown }>;
  download(path: string): PromiseLike<{ data: Blob | null; error: unknown }>;
  upload(path: string, body: Uint8Array, options: { contentType?: string; upsert: boolean }): PromiseLike<{ error: unknown }>;
}

export interface StorageLike {
  from(bucket: string): StorageBucketLike;
}

async function listPage(files: StorageBucketLike, path: string, offset: number): Promise<ListedEntry[]> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const { data, error } = await files.list(path, { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
      if (!error && data) return data;
    } catch {
      // Panne passagère : essai suivant.
    }
  }
  throw new Error("Lecture du stockage impossible.");
}

function toSourceFile(path: string, entry: ListedEntry): SourceFile {
  const size = typeof entry.metadata?.size === "number" ? entry.metadata.size : -1;
  const updated = entry.updated_at ? Date.parse(entry.updated_at) : Number.NaN;
  return {
    path,
    size,
    updatedAt: Number.isFinite(updated) ? updated : null,
    contentType: typeof entry.metadata?.mimetype === "string" ? entry.metadata.mimetype : null,
  };
}

/** Toutes les photos d'un bucket, dossiers compris. Lève une erreur au
 * moindre doute (page illisible, trop profond, trop grand) : une lecture
 * incomplète ne doit jamais faire effacer la copie. */
export async function listBucketFiles(files: StorageBucketLike): Promise<SourceFile[]> {
  const found = new Map<string, SourceFile>();
  const walk = async (folder: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) throw new Error("Stockage plus profond que prévu.");
    for (let page = 0; ; page += 1) {
      if (page >= MAX_PAGES) throw new Error("Dossier trop grand.");
      const entries = await listPage(files, folder, page * PAGE_SIZE);
      for (const entry of entries) {
        const path = folder ? `${folder}/${entry.name}` : entry.name;
        if (entry.id === null) await walk(path, depth + 1);
        else found.set(path, toSourceFile(path, entry));
      }
      if (entries.length < PAGE_SIZE) return;
    }
  };
  await walk("", 0);
  return [...found.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function createSupabasePhotoSource(storage: StorageLike): PhotoSource {
  return {
    listAll: (bucket: PhotoBucket) => listBucketFiles(storage.from(bucket)),
    async download(bucket: PhotoBucket, path: string): Promise<FileBody> {
      const { data, error } = await storage.from(bucket).download(path);
      if (error || !data) throw new Error("Téléchargement impossible.");
      return { body: new Uint8Array(await data.arrayBuffer()), contentType: data.type || null };
    },
    async uploadNew(bucket: PhotoBucket, path: string, file: FileBody): Promise<void> {
      const { error } = await storage.from(bucket).upload(path, file.body, {
        ...(file.contentType ? { contentType: file.contentType } : {}),
        upsert: false,
      });
      if (error) throw new Error("Dépôt impossible.");
    },
  };
}
