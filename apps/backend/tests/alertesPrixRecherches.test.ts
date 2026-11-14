import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Alertes prix et stock (lot 2) : QUAND le serveur observe les résultats, aux
// cinq endroits où une recherche rend des propositions (lancement voie C avec
// ou sans boutiques ensuite, lancement d'avant la voie C, boutiques ensuite,
// « Que cherchez-vous ? »). SANS base ni réseau : une fausse base en mémoire,
// Lens, l'IA et Google Shopping simulés, et l'observation elle-même remplacée
// par un espion (sa logique : alertesPrixObservation.test.ts).
// Règles vérifiées : seulement APRÈS la réponse, seulement les réponses
// fraîches (jamais le cache), seulement les nouvelles propositions pour les
// boutiques ensuite et « Que cherchez-vous ? », rien quand l'enregistrement a échoué.

vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, VOIE_C_ENABLED: true, VOIE_C_AI_ENABLED: true, ANTHROPIC_API_KEY: "faux-anthropic", ANTHROPIC_PHOTO_ENABLED: false } };
});
vi.mock("../src/services/visualSearch.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/visualSearch.js")>();
  return { ...original, searchProductsByImageUrl: vi.fn() };
});
vi.mock("../src/services/serpapi.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/serpapi.js")>();
  return { ...original, serpApiTextProvider: { name: "serpapi", searchByText: vi.fn() } };
});
vi.mock("../src/services/shoppingQueryAi.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/shoppingQueryAi.js")>();
  return { ...original, askShoppingQuery: vi.fn() };
});
vi.mock("../src/lib/searchCapacity.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/searchCapacity.js")>();
  return { ...original, reserveSearch: vi.fn(), releaseReservation: vi.fn(), searchCapacityBeforeComplementAi: vi.fn() };
});
vi.mock("../src/lib/aiQuota.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/aiQuota.js")>();
  return { ...original, aiQuotaFor: vi.fn() };
});
vi.mock("../src/lib/searchBreaker.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/searchBreaker.js")>();
  return { ...original, breakerPause: vi.fn(async () => null), observeBreakerAfter: vi.fn(async () => undefined) };
});
vi.mock("../src/lib/searchCache.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/searchCache.js")>();
  return { ...original, readCache: vi.fn(async () => null), writeCache: vi.fn(async () => undefined), purgeExpiredCache: vi.fn(async () => undefined) };
});
vi.mock("../src/lib/wishObserve.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/wishObserve.js")>();
  return { ...original, observeResults: vi.fn() };
});

import { env } from "../src/env.js";
import searchesRoutes from "../src/routes/searches.js";
import { searchProductsByImageUrl, type VisualMatch } from "../src/services/visualSearch.js";
import { serpApiTextProvider } from "../src/services/serpapi.js";
import { askShoppingQuery } from "../src/services/shoppingQueryAi.js";
import { reserveSearch, releaseReservation, searchCapacityBeforeComplementAi } from "../src/lib/searchCapacity.js";
import { aiQuotaFor } from "../src/lib/aiQuota.js";
import { readCache } from "../src/lib/searchCache.js";
import { LENS_CACHE_PAYLOAD, SHOPPING_CACHE_PAYLOAD, resetVoieCSchemaProbe, type LensAnswer } from "../src/lib/voieC.js";
import { resetDeferredSchemaProbe } from "../src/lib/deferredComplement.js";
import { observeResults } from "../src/lib/wishObserve.js";
import type { LensMeasure } from "../src/services/lensMeasure.js";
import type { TextSearchResponse } from "../src/services/searchProvider.js";

const lensMock = vi.mocked(searchProductsByImageUrl);
const shoppingMock = vi.mocked(serpApiTextProvider.searchByText);
const aiMock = vi.mocked(askShoppingQuery);
const reserveMock = vi.mocked(reserveSearch);
const releaseMock = vi.mocked(releaseReservation);
const capacityMock = vi.mocked(searchCapacityBeforeComplementAi);
const aiQuotaMock = vi.mocked(aiQuotaFor);
const readCacheMock = vi.mocked(readCache);
const observeMock = vi.mocked(observeResults);

const USER = "11111111-1111-4111-8111-111111111111";

// ---- Fausse base en mémoire (chaque instruction appliquée d'un bloc) ----

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code: string; message: string } | null };

function compare(value: unknown, other: unknown): number {
  const a = typeof value === "string" ? Date.parse(value) : Number(value);
  const b = typeof other === "string" ? Date.parse(other) : Number(other);
  return a - b;
}

const DEFAULTS: Record<string, () => Row> = {
  product_matches: () => ({ id: randomUUID(), origin: "lens", brand: null, lens_rank: null, created_at: new Date().toISOString() }),
  affiliate_links: () => ({ id: randomUUID() }),
};

class FakeDb {
  readonly tables = new Map<string, Row[]>();
  /** Les propositions sont refusées par la base (enregistrement en panne). */
  failMatchInserts = false;

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }

  readonly storage = {
    from: () => ({
      upload: async () => ({ error: null }),
      createSignedUrl: async () => ({ data: { signedUrl: "https://stockage.example/analyse-signee.jpg" }, error: null }),
      remove: async () => ({ error: null }),
    }),
  };
}

class FakeQuery implements PromiseLike<Result> {
  private action: "select" | "insert" | "update" | "delete" = "select";
  private values: unknown = null;
  private returning = false;
  private readonly filters: ((row: Row) => boolean)[] = [];
  private mode: "many" | "single" | "maybeSingle" = "many";

  constructor(
    private readonly db: FakeDb,
    private readonly table: string
  ) {}

  select() {
    if (this.action !== "select") this.returning = true;
    return this;
  }
  insert(values: unknown) {
    this.action = "insert";
    this.values = values;
    return this;
  }
  update(values: unknown) {
    this.action = "update";
    this.values = values;
    return this;
  }
  delete() {
    this.action = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  is(column: string, value: unknown) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  gte(column: string, value: unknown) {
    this.filters.push((row) => row[column] != null && compare(row[column], value) >= 0);
    return this;
  }
  gt(column: string, value: unknown) {
    this.filters.push((row) => row[column] != null && compare(row[column], value) > 0);
    return this;
  }
  lt(column: string, value: unknown) {
    this.filters.push((row) => row[column] != null && compare(row[column], value) < 0);
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybeSingle";
    return this;
  }

  then<A = Result, B = never>(resolve?: ((value: Result) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(resolve, reject);
  }

  private run(): Result {
    const table = this.db.rows(this.table);
    let affected: Row[];
    if (this.action === "insert") {
      if (this.table === "product_matches" && this.db.failMatchInserts) return { data: null, error: { code: "23514", message: "refusée" } };
      const list = (Array.isArray(this.values) ? this.values : [this.values]) as Row[];
      affected = list.map((values) => ({ ...(DEFAULTS[this.table]?.() ?? {}), ...values }));
      table.push(...affected);
      if (!this.returning) return { data: null, error: null };
    } else {
      affected = table.filter((row) => this.filters.every((keep) => keep(row)));
      if (this.action === "update") for (const row of affected) Object.assign(row, this.values);
      if (this.action === "delete") for (const row of affected) table.splice(table.indexOf(row), 1);
      if (this.action !== "select" && !this.returning) return { data: null, error: null };
    }
    const rows = affected.map((row) => structuredClone(row));
    if (this.mode === "many") return { data: rows, error: null };
    if (rows.length === 1) return { data: rows[0], error: null };
    if (this.mode === "maybeSingle" && rows.length === 0) return { data: null, error: null };
    return { data: null, error: { code: "PGRST116", message: "pas exactement une ligne" } };
  }
}

// ---- Réponses simulées ----

const lensMatch = (rank: number, productName: string, merchantUrl: string): VisualMatch => ({
  rank,
  productName,
  imageUrl: `https://images.lens.example/${rank}.jpg`,
  imageHdUrl: null,
  merchantName: "Marchand Exemple",
  merchantUrl,
  priceValue: 59 + rank,
  currency: "€",
  inStock: true,
});
const LENS: VisualMatch[] = [lensMatch(1, "Exemplor veste Nuage 07", "https://www.lens-exemple.fr/a"), lensMatch(2, "Veste Exemplor Nuage 07", "https://autre-lens.fr/b")];
const LENS_MEASURE: LensMeasure = {
  removedIncomplete: 0,
  removedSocial: 0,
  removedProfessional: 0,
  removedDuplicates: 0,
  received: 2,
  kept: 2,
  keptWithPrice: 2,
  keptOtherCurrency: 0,
  distinctSites: 2,
  sections: ["visual_matches"],
  googleState: null,
};
const shoppingItem = (position: number, title: string, link: string) => ({
  position,
  title,
  link,
  product_link: `https://www.google.fr/shopping/product/${position}`,
  source: "Boutique Exemple",
  price: "49,99 €",
  extracted_price: 49.99,
  thumbnail: `https://images.boutique.example/${position}.jpg`,
});
const SHOPPING: TextSearchResponse = {
  items: [shoppingItem(1, "Exemplor veste Nuage 07", "https://boutique-a.fr/1"), shoppingItem(2, "Veste bleue", "https://boutique-b.fr/2")],
  received: 2,
  statusCode: 200,
};

let app: FastifyInstance | null = null;
let db: FakeDb;

afterEach(async () => {
  await app?.close();
  app = null;
});

beforeEach(() => {
  Object.assign(env, { VOIE_C_ENABLED: true, VOIE_C_AI_ENABLED: true });
  resetVoieCSchemaProbe();
  resetDeferredSchemaProbe();
  db = new FakeDb();
  observeMock.mockReset();
  readCacheMock.mockReset();
  readCacheMock.mockResolvedValue(null);
  lensMock.mockReset();
  lensMock.mockResolvedValue({ matches: structuredClone(LENS), measure: LENS_MEASURE, addedRanks: [], statusCode: 200 });
  shoppingMock.mockReset();
  shoppingMock.mockResolvedValue(SHOPPING);
  aiMock.mockReset();
  aiMock.mockResolvedValue({ kind: "query", value: { query: "Exemplor veste Nuage 07", brand: "Exemplor", model: "Nuage 07" }, usage: { inputTokens: 900, outputTokens: 40 } });
  let reservation = 100;
  reserveMock.mockReset();
  reserveMock.mockImplementation(async () => ({ allowed: true, reservationId: (reservation += 1) }));
  releaseMock.mockReset();
  releaseMock.mockResolvedValue(true);
  capacityMock.mockReset();
  capacityMock.mockResolvedValue({ allowed: true });
  aiQuotaMock.mockReset();
  aiQuotaMock.mockResolvedValue({ allowed: true });
});

async function buildApp(): Promise<FastifyInstance> {
  app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
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

function preparedSearch(fields: Row = {}): string {
  const id = randomUUID();
  db.rows("product_searches").push({
    id,
    user_id: USER,
    source_url: null,
    source_platform: "photo",
    method: "manual_screenshot",
    thumbnail_url: null,
    screenshot_url: null,
    status: "pending",
    error_message: null,
    query: null,
    created_at: new Date().toISOString(),
    refused_before_call: 0,
    failure_kind: null,
    provider: null,
    run_started_at: null,
    complement_status: null,
    shopping_calls: 0,
    lens_from_cache: false,
    served_from_cache: false,
    text_suggested: false,
    text_requested_at: null,
    text_status: null,
    total_seconds: null,
    complement_deferred: null,
    complement_deferred_at: null,
    ...fields,
  });
  return id;
}

const PHOTO = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#806040" } }).jpeg().toBuffer();

function launch(target: FastifyInstance, id: string, fields: Record<string, string> = {}, language = "fr-FR") {
  const boundary = "limiteDeTest";
  const parts: Buffer[] = Object.entries(fields).map(([name, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), PHOTO, Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return target.inject({ method: "POST", url: `/api/searches/${id}/run`, payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "accept-language": language } });
}

/** Ce qui a été observé : la source, les adresses et le pays. */
const observed = () => observeMock.mock.calls.map(([, input]) => ({ source: input.source, urls: input.rows.map((row) => row.merchantUrl), country: input.country }));
const LENS_URLS = LENS.map((match) => match.merchantUrl);
const SHOP_URLS = ["https://boutique-a.fr/1", "https://boutique-b.fr/2"];

/** Le cache rend la réponse de Lens et/ou celle de Google Shopping. */
function cacheServes(options: { lens?: boolean; shopping?: boolean }) {
  const lensAnswer: LensAnswer = { matches: structuredClone(LENS), measure: LENS_MEASURE, addedRanks: [] };
  readCacheMock.mockImplementation((async (_db: unknown, _key: string, schema: unknown) => {
    if (options.lens && schema === LENS_CACHE_PAYLOAD) return lensAnswer;
    if (options.shopping && schema === SHOPPING_CACHE_PAYLOAD) {
      return { matches: SHOP_URLS.map((link, index) => ({ ...lensMatch(index + 1, `Pièce ${index}`, link), priceHidden: false })), received: 2, droppedDataThumbnails: 0 };
    }
    return null;
  }) as typeof readCache);
}

describe("lancement avec la voie C (tout en une fois)", () => {
  it("baisse de prix possible : Lens frais et boutiques fraîches sont observés, après la réponse, avec le pays de la recherche", async () => {
    const target = await buildApp();
    const res = await launch(target, preparedSearch());
    expect(res.statusCode).toBe(200);
    expect(observed()).toEqual([
      { source: "lens", urls: LENS_URLS, country: "fr" },
      { source: "shopping", urls: SHOP_URLS, country: "fr" },
    ]);
    // Le membre qui cherche part avec l'observation (pour son réglage « Aider les autres membres », 0041).
    expect(observeMock.mock.calls.map(([, input]) => input.observerId)).toEqual([USER, USER]);
    // Anglais (région de l'appareil) : le pays de la recherche est celui de l'appareil.
    observeMock.mockReset();
    await launch(target, preparedSearch(), {}, "en-GB");
    expect(observed().map((call) => call.country)).toEqual(["gb", "gb"]);
  });

  it("réponses servies par le cache de 24 h : jamais observées (elles peuvent rejouer d'anciens prix)", async () => {
    cacheServes({ lens: true, shopping: true });
    const target = await buildApp();
    expect((await launch(target, preparedSearch())).statusCode).toBe(200);
    expect(observed()).toEqual([]);
    // Lens du cache, mais Google Shopping appelé : seules les boutiques sont observées.
    cacheServes({ lens: true });
    await launch(target, preparedSearch());
    expect(observed()).toEqual([{ source: "shopping", urls: SHOP_URLS, country: "fr" }]);
  });

  it("enregistrement en panne (SAVE_FAILED) : rien n'est observé", async () => {
    db.failMatchInserts = true;
    const target = await buildApp();
    const res = await launch(target, preparedSearch());
    expect(res.json()).toMatchObject({ status: "failed" });
    expect(observed()).toEqual([]);
  });
});

describe("boutiques ensuite", () => {
  it("le lancement observe Lens ; POST /complement observe SEULEMENT les nouvelles propositions des boutiques", async () => {
    const target = await buildApp();
    const id = preparedSearch();
    expect((await launch(target, id, { complement: "deferred" })).statusCode).toBe(200);
    expect(observed()).toEqual([{ source: "lens", urls: LENS_URLS, country: "fr" }]);
    observeMock.mockReset();
    const res = await target.inject({ method: "POST", url: `/api/searches/${id}/complement`, headers: { "accept-language": "fr-FR" } });
    expect(res.statusCode).toBe(200);
    expect(observed()).toEqual([{ source: "shopping", urls: SHOP_URLS, country: "fr" }]);
    // Redemandée : l'issue enregistrée, rien de neuf, rien d'observé.
    observeMock.mockReset();
    await target.inject({ method: "POST", url: `/api/searches/${id}/complement`, headers: { "accept-language": "fr-FR" } });
    expect(observed()).toEqual([]);
  });

  it("boutiques lues dans le cache : rien n'est observé", async () => {
    const target = await buildApp();
    const id = preparedSearch();
    await launch(target, id, { complement: "deferred" });
    observeMock.mockReset();
    cacheServes({ shopping: true });
    await target.inject({ method: "POST", url: `/api/searches/${id}/complement`, headers: { "accept-language": "fr-FR" } });
    expect(observed()).toEqual([]);
  });
});

describe("lancement d'avant la voie C (voie C coupée)", () => {
  it("toujours un vrai appel à Lens : observé ; enregistrement en panne : rien", async () => {
    env.VOIE_C_ENABLED = false;
    const target = await buildApp();
    expect((await launch(target, preparedSearch())).statusCode).toBe(200);
    expect(observed()).toEqual([{ source: "lens", urls: LENS_URLS, country: "fr" }]);
    observeMock.mockReset();
    db.failMatchInserts = true;
    const failed = await launch(target, preparedSearch());
    // Propositions refusées par la base : une panne annoncée, rien d'observé.
    expect(failed.json()).toMatchObject({ status: "failed" });
    expect(observed()).toEqual([]);
  });
});

describe("« Que cherchez-vous ? »", () => {
  it("jamais en cache : seulement les nouvelles propositions (vos mots), jamais celles déjà là", async () => {
    const target = await buildApp();
    const id = preparedSearch({ status: "completed", text_suggested: true, lens_from_cache: false, shopping_calls: 1 });
    db.rows("product_matches").push({ id: randomUUID(), search_id: id, rank: 1, origin: "lens", product_name: "Déjà là", image_url: "https://images.example/1.jpg", image_hd_url: null, price_min: 10, price_max: 10, currency: "EUR", merchant_name: "Marchand", merchant_url: "https://deja-la.fr/p", brand: null, lens_rank: null, created_at: new Date().toISOString() });
    const res = await target.inject({ method: "POST", url: `/api/searches/${id}/text`, payload: { words: "veste bleue" }, headers: { "accept-language": "fr-FR" } });
    expect(res.statusCode).toBe(200);
    expect(observed()).toEqual([{ source: "words", urls: SHOP_URLS, country: "fr" }]);
  });
});
