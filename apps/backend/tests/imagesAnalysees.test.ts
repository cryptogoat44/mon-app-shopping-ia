import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  ANALYSIS_FOLDER,
  ANALYSIS_IMAGE_MAX_AGE_MS,
  analysisImagePath,
  deleteUserStorageFiles,
  legacyAnalysisImagePath,
  purgeStaleAnalysisImages,
  type AnalysisFiles,
} from "../src/lib/storage.js";

// Images analysées (lot garde-fous) : sans le compte dans leur nom (le lien
// signé part chez SerpApi puis Google), et effacées quand elles restent plus
// d'une heure, à chaque préparation de recherche. Faux stockage, aucun réseau.

const USER = "11111111-2222-4333-8444-555555555555";
const SEARCH = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = Date.UTC(2026, 10, 6, 9, 0);
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function fakeFiles(entries: { name: string; id: string | null; created_at?: string | null }[], options: { listFails?: boolean; removeFails?: boolean } = {}) {
  const removed: string[][] = [];
  const files: AnalysisFiles = {
    list: vi.fn(async (path, { limit, sortBy }) => {
      expect(path).toBe(ANALYSIS_FOLDER);
      expect(sortBy).toEqual({ column: "created_at", order: "asc" });
      if (options.listFails) return { data: null, error: new Error("lecture impossible") };
      return { data: entries.slice(0, limit), error: null };
    }),
    remove: vi.fn(async (paths: string[]) => {
      removed.push(paths);
      return { error: options.removeFails ? new Error("effacement refusé") : null };
    }),
  };
  return { files, removed };
}

function fakeLog() {
  const lines: unknown[] = [];
  const push = (fields: Record<string, unknown>, message: string) => {
    lines.push([fields, message]);
  };
  return { lines, info: push, warn: push };
}

describe("nom de l'image analysée", () => {
  it("aucun identifiant de compte dans le chemin : un dossier fixe et la recherche", () => {
    expect(analysisImagePath(SEARCH)).toBe(`analyses/${SEARCH}.jpg`);
    expect(analysisImagePath(SEARCH)).not.toContain(USER);
    // L'ancien nom, seulement pour effacer une image restée d'avant.
    expect(legacyAnalysisImagePath(USER, SEARCH)).toBe(`${USER}/${SEARCH}.jpg`);
  });
});

describe("purge des images analysées restées plus d'une heure", () => {
  it("efface seulement celles de plus d'une heure ; garde les récentes, les dossiers et les dates illisibles", async () => {
    const { files, removed } = fakeFiles([
      { name: "a.jpg", id: "1", created_at: ago(180) },
      { name: "b.jpg", id: "2", created_at: ago(61) },
      { name: "c.jpg", id: "3", created_at: ago(59) },
      { name: "sous-dossier", id: null, created_at: null },
      { name: "d.jpg", id: "4", created_at: null },
      { name: "e.jpg", id: "5", created_at: ago(2) },
    ]);
    const log = fakeLog();
    expect(await purgeStaleAnalysisImages(files, log, NOW)).toBe(2);
    expect(removed).toEqual([["analyses/a.jpg", "analyses/b.jpg"]]);
    expect(ANALYSIS_IMAGE_MAX_AGE_MS).toBe(60 * 60_000);
    // Un nombre, jamais un chemin.
    expect(JSON.stringify(log.lines)).not.toContain(".jpg");
  });

  it("rien de vieux : aucun effacement demandé", async () => {
    const { files, removed } = fakeFiles([{ name: "c.jpg", id: "3", created_at: ago(5) }]);
    expect(await purgeStaleAnalysisImages(files, fakeLog(), NOW)).toBe(0);
    expect(removed).toEqual([]);
  });

  it("au plus 100 par passage, les plus anciennes d'abord (la suivante reprendra)", async () => {
    const entries = Array.from({ length: 150 }, (_, index) => ({ name: `${index}.jpg`, id: String(index), created_at: ago(500 - index) }));
    const { files, removed } = fakeFiles(entries);
    expect(await purgeStaleAnalysisImages(files, fakeLog(), NOW)).toBe(100);
    expect(removed[0]).toHaveLength(100);
  });

  it("stockage en panne : jamais d'erreur levée, la préparation de la recherche continue", async () => {
    const unreadable = fakeFiles([], { listFails: true });
    expect(await purgeStaleAnalysisImages(unreadable.files, fakeLog(), NOW)).toBe(0);
    const refused = fakeFiles([{ name: "a.jpg", id: "1", created_at: ago(120) }], { removeFails: true });
    expect(await purgeStaleAnalysisImages(refused.files, fakeLog(), NOW)).toBe(0);
    const throwing: AnalysisFiles = { list: () => Promise.reject(new Error("réseau")), remove: () => Promise.reject(new Error("réseau")) };
    expect(await purgeStaleAnalysisImages(throwing, fakeLog(), NOW)).toBe(0);
  });
});

/** Fausse base et faux stockage pour la suppression d'un compte : `searchIds`
 * sont ses recherches ; `stored` les fichiers de chaque bucket. */
function fakeAccountApp(searchIds: string[], stored: Record<string, string[]>, options: { readFails?: boolean; removeFails?: boolean } = {}) {
  const removed: { bucket: string; paths: string[] }[] = [];
  const query = {
    order: () => query,
    range: async (from: number, to: number) =>
      options.readFails
        ? { data: null, error: new Error("base injoignable"), count: null }
        : { data: searchIds.slice(from, to + 1).map((id) => ({ id })), error: null, count: searchIds.length },
  };
  const app = {
    supabaseAdmin: {
      from: (table: string) => {
        expect(table).toBe("product_searches");
        return { select: () => ({ eq: (column: string, value: string) => (expect([column, value]).toEqual(["user_id", USER]), query) }) };
      },
      storage: {
        from: (bucket: string) => ({
          list: async (path: string, { limit, offset }: { limit: number; offset: number }) => ({
            data: (stored[bucket] ?? [])
              .filter((name) => name.startsWith(`${path}/`))
              .slice(offset, offset + limit)
              .map((name) => ({ name: name.slice(path.length + 1), id: `id-${name}` })),
            error: null,
          }),
          remove: async (paths: string[]) => {
            removed.push({ bucket, paths });
            if (options.removeFails) return { error: new Error("effacement refusé") };
            stored[bucket] = (stored[bucket] ?? []).filter((name) => !paths.includes(name));
            return { error: null };
          },
        }),
      },
    },
  } as unknown as FastifyInstance;
  return { app, removed, stored };
}

describe("suppression d'un compte : ses images analysées, anciennes et nouvelles", () => {
  it("le dossier du compte (ancien nom) est vidé, et chaque recherche du compte efface son image « analyses/… »", async () => {
    const other = "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const { app, stored } = fakeAccountApp([SEARCH], {
      screenshots: [legacyAnalysisImagePath(USER, "ancienne"), analysisImagePath(SEARCH), analysisImagePath(other)],
    });
    const reports = await deleteUserStorageFiles(app, USER);
    // Il ne reste que l'image d'une recherche d'un autre compte.
    expect(stored.screenshots).toEqual([analysisImagePath(other)]);
    expect(reports.at(-1)).toEqual({ bucket: "screenshots", removed: 1, failed: 0, unreadable: false });
  });

  it("par lots de 100 chemins ; un lot refusé est compté comme resté ; recherches illisibles : signalé, sans erreur", async () => {
    const ids = Array.from({ length: 150 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    const many = fakeAccountApp(ids, {});
    expect((await deleteUserStorageFiles(many.app, USER)).at(-1)).toEqual({ bucket: "screenshots", removed: 150, failed: 0, unreadable: false });
    const analysisBatches = many.removed.filter((call) => call.paths.every((path) => path.startsWith(`${ANALYSIS_FOLDER}/`)));
    expect(analysisBatches.map((call) => call.paths.length)).toEqual([100, 50]);
    expect(analysisBatches.flatMap((call) => call.paths).some((path) => path.includes(USER))).toBe(false);

    const refused = fakeAccountApp(ids.slice(0, 3), {}, { removeFails: true });
    expect((await deleteUserStorageFiles(refused.app, USER)).at(-1)).toEqual({ bucket: "screenshots", removed: 0, failed: 3, unreadable: false });

    const unreadable = fakeAccountApp(ids, {}, { readFails: true });
    expect((await deleteUserStorageFiles(unreadable.app, USER)).at(-1)).toEqual({ bucket: "screenshots", removed: 0, failed: 0, unreadable: true });
  });
});
