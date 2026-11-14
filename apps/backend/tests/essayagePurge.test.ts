import { randomUUID } from "node:crypto";
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Essayage virtuel : la purge des données de plus de 12 mois tourne QUEL QUE
// SOIT l'interrupteur de l'essayage (lib/tryon/purge.ts), au passage de la
// route des recherches, à côté des autres purges : la durée promise tient
// même fonction éteinte après usage. Sans base ni réseau : une fausse base
// en mémoire (tests/fakeSupabase.ts) dont les fonctions notent leurs appels ;
// aucun appel sortant (safeFetch simulé). Le comportement de tryon_purge
// lui-même : banc Postgres local et essayageBase.test.ts.
vi.mock("../src/lib/safeFetch.js", () => ({ safeFetch: vi.fn() }));
vi.mock("../src/lib/searchCache.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/searchCache.js")>();
  return { ...original, purgeExpiredCache: vi.fn(async () => undefined) };
});

import { env } from "../src/env.js";
import searchesRoutes from "../src/routes/searches.js";
import { safeFetch } from "../src/lib/safeFetch.js";
import { purgeTryonHistory, TRYON_RETENTION_MONTHS } from "../src/lib/tryon/purge.js";
import { resetTryonSchemaProbe } from "../src/lib/tryon/schema.js";
import { fakeSupabase, type Row } from "./fakeSupabase.js";

const USER = "00000000-0000-4000-8000-00000000b001";

type Calls = { fn: string; args: Record<string, unknown> }[];

/** Une fausse base : avec ou sans 0042 ; tryon_purge peut échouer ou lever. */
function database(options: { migrated: boolean; purge?: "ok" | "error" | "throws" }) {
  const calls: Calls = [];
  const fake = fakeSupabase({
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "tryon_version") return options.migrated ? { data: 1, error: null } : { data: null, error: { code: "PGRST202", message: "absente" } };
      if (fn === "tryon_purge") {
        if (options.purge === "throws") throw new Error("connexion perdue");
        if (options.purge === "error") return { data: null, error: { code: "57014", message: "délai dépassé" } };
        return { data: [{ events: 0, reports: 0, alerts: 0, grants: 0 }], error: null };
      }
      return { data: null, error: { code: "PGRST202", message: "absente" } };
    },
  });
  return { fake, calls, purges: () => calls.filter((call) => call.fn === "tryon_purge") };
}

/** Un journal qui garde ses lignes (champs et message). */
function recordingLog() {
  const lines: { fields: Record<string, unknown>; message: string }[] = [];
  const write = (fields: Record<string, unknown>, message: string) => lines.push({ fields, message });
  const log = { warn: write, error: write, info: write, debug: write, trace: write, fatal: write, child: () => log, level: "info", silent: () => {} };
  return { log: log as unknown as FastifyBaseLogger, lines };
}

let app: FastifyInstance | null = null;

beforeEach(() => {
  resetTryonSchemaProbe();
  vi.mocked(safeFetch).mockReset();
});

afterEach(async () => {
  await app?.close();
  app = null;
});

describe("purgeTryonHistory : 12 mois, sans jamais lever d'erreur", () => {
  it("avec 0042 : tryon_purge(12), quel que soit l'interrupteur", async () => {
    const { fake, purges } = database({ migrated: true });
    const { log } = recordingLog();
    await purgeTryonHistory({ supabaseAdmin: fake.db as unknown as FastifyInstance["supabaseAdmin"], log }, log);
    expect(TRYON_RETENTION_MONTHS).toBe(12);
    expect(purges()).toEqual([{ fn: "tryon_purge", args: { p_months: 12 } }]);
  });

  it("sans 0042 : rien n'est appelé", async () => {
    const { fake, purges } = database({ migrated: false });
    const { log } = recordingLog();
    await purgeTryonHistory({ supabaseAdmin: fake.db as unknown as FastifyInstance["supabaseAdmin"], log }, log);
    expect(purges()).toEqual([]);
  });

  it("purge refusée ou base injoignable : jamais d'erreur ; le journal ne garde que le code", async () => {
    for (const purge of ["error", "throws"] as const) {
      resetTryonSchemaProbe();
      const { fake } = database({ migrated: true, purge });
      const { log, lines } = recordingLog();
      await expect(purgeTryonHistory({ supabaseAdmin: fake.db as unknown as FastifyInstance["supabaseAdmin"], log }, log)).resolves.toBeUndefined();
      expect(lines).toEqual([{ fields: { code: purge === "error" ? "57014" : null }, message: "Essayage virtuel : purge impossible" }]);
    }
  });
});

describe("route des recherches : la purge de l'essayage part avec les autres, essayage éteint", () => {
  /** L'app réduite aux routes des recherches : connexion simulée, valeurs par défaut de la base à l'insertion. */
  async function searchesApp(fake: ReturnType<typeof fakeSupabase>): Promise<FastifyInstance> {
    const defaults = (): Row => ({
      id: randomUUID(),
      screenshot_url: null,
      error_message: null,
      query: null,
      created_at: new Date().toISOString(),
      refused_before_call: 0,
      failure_kind: null,
      provider: null,
      run_started_at: null,
    });
    const db = {
      ...fake.db,
      from(name: string) {
        const chain = fake.db.from(name);
        if (name !== "product_searches") return chain;
        const insert = chain.insert;
        chain.insert = (value) => insert(Array.isArray(value) ? value.map((row) => ({ ...defaults(), ...row })) : { ...defaults(), ...value });
        return chain;
      },
    };
    app = Fastify({ logger: false });
    app.decorate("supabaseAdmin", db as unknown as FastifyInstance["supabaseAdmin"]);
    app.decorateRequest("user", null);
    app.decorate("requireAuth", async (request: FastifyRequest) => {
      request.user = { id: USER, email: null };
    });
    app.decorate("requireActiveAccount", async () => {});
    app.decorate("rateLimit", () => async () => {});
    app.decorate("rateLimitCheck", () => async () => {});
    app.decorate("countRateLimitHit", () => {});
    await app.register(searchesRoutes);
    await app.ready();
    return app;
  }

  it("TRYON_ENABLED coupé, aucun drapeau : POST /api/searches/prepare lance tryon_purge(12)", async () => {
    expect(env.TRYON_ENABLED).toBe(false);
    const { fake, purges } = database({ migrated: true });
    const target = await searchesApp(fake);
    const response = await target.inject({ method: "POST", url: "/api/searches/prepare", payload: {} });
    expect(response.statusCode).toBe(200);
    expect(fake.table("feature_flags")).toEqual([]);
    expect(purges()).toEqual([{ fn: "tryon_purge", args: { p_months: 12 } }]);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("sans 0042 : aucune purge de l'essayage, la recherche est préparée comme avant", async () => {
    const { fake, purges } = database({ migrated: false });
    const target = await searchesApp(fake);
    const response = await target.inject({ method: "POST", url: "/api/searches/prepare", payload: {} });
    expect(response.statusCode).toBe(200);
    expect(purges()).toEqual([]);
  });

  it("purge en échec : la recherche est préparée quand même", async () => {
    const { fake, purges } = database({ migrated: true, purge: "throws" });
    const target = await searchesApp(fake);
    const response = await target.inject({ method: "POST", url: "/api/searches/prepare", payload: {} });
    expect(response.statusCode).toBe(200);
    expect(purges()).toHaveLength(1);
    expect(fake.table("product_searches")).toHaveLength(1);
  });
});
