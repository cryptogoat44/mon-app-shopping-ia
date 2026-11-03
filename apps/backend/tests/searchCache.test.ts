import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareImageForAnalysis } from "../src/lib/imageProcessing.js";
import {
  CACHE_PAYLOAD_MAX_BYTES,
  CACHE_TTL_MS,
  cacheKey,
  imageHash,
  payloadBytes,
  purgeExpiredCache,
  readCache,
  writeCache,
  type CacheDb,
  type CacheDbError,
  type CacheLog,
  type CacheRow,
} from "../src/lib/searchCache.js";

// Voie C (lot c, 2026-11-02) : cache des recherches (table search_cache,
// 0028). Faux client écrit à la main : aucune base, aucun réseau. Le cache
// n'empêche jamais une recherche : toute anomalie vaut « absent ».

type ReadResult = { data: unknown; error: CacheDbError | null };
type WriteResult = { error: CacheDbError | null };

function fakeDb(options: { read?: () => PromiseLike<ReadResult>; upsert?: () => PromiseLike<WriteResult>; remove?: () => PromiseLike<WriteResult> } = {}) {
  const calls = {
    tables: [] as string[],
    selects: [] as string[],
    filters: [] as [string, string, string][],
    signals: [] as AbortSignal[],
    upserts: [] as { row: CacheRow; options: { onConflict: string } }[],
    deletes: [] as [string, string, string][],
  };
  const read = options.read ?? (async () => ({ data: null, error: null }));
  const upsert = options.upsert ?? (async () => ({ error: null }));
  const remove = options.remove ?? (async () => ({ error: null }));
  const db: CacheDb = {
    from(table) {
      calls.tables.push(table);
      return {
        select(columns) {
          calls.selects.push(columns);
          return {
            filter(column, operator, value) {
              calls.filters.push([column, operator, value]);
              return {
                filter(column2, operator2, value2) {
                  calls.filters.push([column2, operator2, value2]);
                  return {
                    abortSignal(signal) {
                      calls.signals.push(signal);
                      return { maybeSingle: () => read() };
                    },
                  };
                },
              };
            },
          };
        },
        upsert(row, upsertOptions) {
          calls.upserts.push({ row, options: upsertOptions });
          return upsert();
        },
        delete() {
          return {
            filter(column, operator, value) {
              calls.deletes.push([column, operator, value]);
              return remove();
            },
          };
        },
      };
    },
  };
  return { db, calls };
}

function fakeLog() {
  const warn = vi.fn();
  const log: CacheLog = { warn };
  return { log, warn };
}

const KEY = "a".repeat(64);
const SCHEMA = z.object({ matches: z.array(z.string()) }).strict();
const LATER = () => new Date(Date.now() + 60_000).toISOString();
const signal = () => new AbortController().signal;

afterEach(() => {
  vi.useRealTimers();
});

describe("cache — clés", () => {
  const parts = ["v1", "google_shopping_light", "marque exemple x-200", "fr", "fr", "google.fr"];

  it("déterministes, en hexadécimal minuscule de 64 caractères", () => {
    expect(cacheKey("shopping", parts)).toBe(cacheKey("shopping", [...parts]));
    expect(cacheKey("shopping", parts)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changent avec la version, le moteur, la requête, le pays, la langue, le domaine ou l'étape", () => {
    const base = cacheKey("shopping", parts);
    const variants = [
      ["v2", ...parts.slice(1)],
      ["v1", "google_shopping", ...parts.slice(2)],
      ["v1", "google_shopping_light", "marque exemple x-300", "fr", "fr", "google.fr"],
      ["v1", "google_shopping_light", "marque exemple x-200", "gb", "fr", "google.fr"],
      ["v1", "google_shopping_light", "marque exemple x-200", "fr", "en", "google.fr"],
      ["v1", "google_shopping_light", "marque exemple x-200", "fr", "fr", "google.com"],
    ];
    const keys = new Set([base, ...variants.map((variant) => cacheKey("shopping", variant)), cacheKey("lens", parts), cacheKey("query", parts)]);
    expect(keys.size).toBe(variants.length + 3);
  });

  it("sans ambiguïté entre les parties", () => {
    expect(cacheKey("lens", ["a|b", "c"])).not.toBe(cacheKey("lens", ["a", "b|c"]));
  });

  it("image : même image et même cadre passés deux fois par prepareImageForAnalysis → même empreinte ; autre cadre → autre empreinte", async () => {
    // Dégradé (et non une couleur unie : deux cadres d'une image unie donneraient les mêmes octets).
    const width = 240;
    const height = 180;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 3;
        raw[offset] = x % 256;
        raw[offset + 1] = y % 256;
        raw[offset + 2] = (x * y) % 256;
      }
    }
    const photo = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const crop = { x: 0.1, y: 0.1, width: 0.5, height: 0.6 };
    const first = imageHash(await prepareImageForAnalysis(photo, crop));
    const second = imageHash(await prepareImageForAnalysis(Buffer.from(photo), { ...crop }));
    const otherCrop = imageHash(await prepareImageForAnalysis(photo, { ...crop, x: 0.3 }));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(otherCrop).not.toBe(first);
  });
});

describe("cache — lecture", () => {
  it("entrée valable : contenu validé ; requête sur la clé, non expirée, avec le signal", async () => {
    const { db, calls } = fakeDb({ read: async () => ({ data: { payload: { matches: ["Produit 1"] }, expires_at: LATER() }, error: null }) });
    const { log, warn } = fakeLog();
    const controller = new AbortController();
    expect(await readCache(db, KEY, SCHEMA, log, controller.signal)).toEqual({ matches: ["Produit 1"] });
    expect(calls.tables).toEqual(["search_cache"]);
    expect(calls.filters[0]).toEqual(["key", "eq", KEY]);
    expect(calls.filters[1]?.[0]).toBe("expires_at");
    expect(calls.filters[1]?.[1]).toBe("gt");
    expect(calls.signals).toEqual([controller.signal]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("aucune entrée : absent, sans avertissement", async () => {
    const { db } = fakeDb();
    const { log, warn } = fakeLog();
    expect(await readCache(db, KEY, SCHEMA, log, signal())).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("entrée expirée (même si la base la renvoyait) : absent", async () => {
    const { db } = fakeDb({ read: async () => ({ data: { payload: { matches: [] }, expires_at: new Date(Date.now() - 1000).toISOString() }, error: null }) });
    const { log } = fakeLog();
    expect(await readCache(db, KEY, SCHEMA, log, signal())).toBeNull();
  });

  it("contenu invalide (forme inattendue ou champ en trop) : absent, avertissement sans la clé", async () => {
    for (const payload of [{ matches: "pas une liste" }, { matches: [], autre: 1 }, null]) {
      const { db } = fakeDb({ read: async () => ({ data: { payload, expires_at: LATER() }, error: null }) });
      const { log, warn } = fakeLog();
      expect(await readCache(db, KEY, SCHEMA, log, signal())).toBeNull();
      expect(warn).toHaveBeenCalledOnce();
      expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
    }
  });

  it.each(["42P01", "PGRST205", "XX000"])("erreur de la base (%s, dont table absente) : absent, jamais d'exception", async (code) => {
    const { db } = fakeDb({ read: async () => ({ data: null, error: { code } }) });
    const { log, warn } = fakeLog();
    expect(await readCache(db, KEY, SCHEMA, log, signal())).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ reason: code === "XX000" ? "error" : "missing_table", code });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
  });

  it("lecture plus lente que le signal (800 ms en vrai) : absent, même si le client n'écoute pas le signal", async () => {
    const { db } = fakeDb({ read: () => new Promise<ReadResult>(() => undefined) });
    const { log, warn } = fakeLog();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    expect(await readCache(db, KEY, SCHEMA, log, controller.signal)).toBeNull();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ reason: "timeout" });
  });

  it("client qui lève une exception : absent, jamais d'exception", async () => {
    const { db } = fakeDb({
      read: () => {
        throw new Error(`panne ${KEY}`);
      },
    });
    const { log, warn } = fakeLog();
    expect(await readCache(db, KEY, SCHEMA, log, signal())).toBeNull();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
  });
});

describe("cache — écriture", () => {
  it("upsert sur la clé, valable 24 h à partir de maintenant", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T10:00:00.000Z"));
    const { db, calls } = fakeDb();
    const { log, warn } = fakeLog();
    await writeCache(db, KEY, "lens", { matches: ["Produit 1"] }, log);
    expect(calls.upserts).toEqual([
      {
        row: { key: KEY, step: "lens", payload: { matches: ["Produit 1"] }, created_at: "2026-11-02T10:00:00.000Z", expires_at: "2026-11-03T10:00:00.000Z" },
        options: { onConflict: "key" },
      },
    ]);
    expect(CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(warn).not.toHaveBeenCalled();
  });

  it("contenu de plus de 256 Ko : rien d'écrit, avertissement (étape et taille seulement)", async () => {
    const { db, calls } = fakeDb();
    const { log, warn } = fakeLog();
    await writeCache(db, KEY, "shopping", { matches: ["x".repeat(CACHE_PAYLOAD_MAX_BYTES)] }, log);
    expect(calls.upserts).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ step: "shopping" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
  });

  it("taille mesurée comme la base (payload::text, espaces après « : » et « , ») : un contenu juste sous la limite en JSON compact peut la dépasser", async () => {
    expect(payloadBytes({ a: 1, b: [1, 2] })).toBe(Buffer.byteLength('{"a": 1, "b": [1, 2]}'));
    expect(payloadBytes({ nom: "é" })).toBe(Buffer.byteLength('{"nom": "é"}'));
    expect(payloadBytes(undefined)).toBeNull();
    // 100 000 fois « 1 » : ≈ 200 Ko en JSON compact, ≈ 300 Ko comme la base le compte.
    const many = Array.from({ length: 100_000 }, () => 1);
    expect(Buffer.byteLength(JSON.stringify(many))).toBeLessThan(CACHE_PAYLOAD_MAX_BYTES);
    const { db, calls } = fakeDb();
    await writeCache(db, KEY, "lens", many, fakeLog().log);
    expect(calls.upserts).toEqual([]);
  });

  it("échec de la base ou exception du client : avertissement, jamais d'exception", async () => {
    const failing = fakeDb({ upsert: async () => ({ error: { code: "23514" } }) });
    const first = fakeLog();
    await expect(writeCache(failing.db, KEY, "query", { query: "x" }, first.log)).resolves.toBeUndefined();
    expect(first.warn.mock.calls[0]?.[0]).toMatchObject({ step: "query", code: "23514" });
    const throwing = fakeDb({
      upsert: () => {
        throw new Error("panne");
      },
    });
    const second = fakeLog();
    await expect(writeCache(throwing.db, KEY, "query", { query: "x" }, second.log)).resolves.toBeUndefined();
    expect(second.warn).toHaveBeenCalledOnce();
  });
});

describe("cache — purge des entrées expirées", () => {
  it("supprime ce qui a expiré avant maintenant", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T10:00:00.000Z"));
    const { db, calls } = fakeDb();
    const { log, warn } = fakeLog();
    await purgeExpiredCache(db, log);
    expect(calls.deletes).toEqual([["expires_at", "lt", "2026-11-02T10:00:00.000Z"]]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["42P01", "PGRST205"])("table absente (%s, 0028 pas appliquée) : ignoré sans bruit", async (code) => {
    const { db } = fakeDb({ remove: async () => ({ error: { code } }) });
    const { log, warn } = fakeLog();
    await expect(purgeExpiredCache(db, log)).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("autre échec : un avertissement, jamais d'exception", async () => {
    const { db } = fakeDb({ remove: async () => ({ error: { code: "57014" } }) });
    const { log, warn } = fakeLog();
    await expect(purgeExpiredCache(db, log)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    const throwing = fakeDb({
      remove: () => {
        throw new Error("panne");
      },
    });
    await expect(purgeExpiredCache(throwing.db, log)).resolves.toBeUndefined();
  });
});

describe("cache — client", () => {
  it("le client Supabase du serveur correspond au client minimal (contrôle fait par le typage des tests)", () => {
    const client = null as unknown as SupabaseClient;
    const db: CacheDb = client;
    expect(db).toBeNull();
  });
});
