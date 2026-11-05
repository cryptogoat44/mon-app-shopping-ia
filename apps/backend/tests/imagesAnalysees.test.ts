import { describe, expect, it, vi } from "vitest";
import {
  ANALYSIS_FOLDER,
  ANALYSIS_IMAGE_MAX_AGE_MS,
  analysisImagePath,
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
