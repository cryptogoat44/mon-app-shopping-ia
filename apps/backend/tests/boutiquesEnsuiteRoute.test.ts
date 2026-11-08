import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Boutiques ensuite (2026-11-08, migration 0031), partie sans base (aucun
// réseau) : le lancement POST /api/searches/:id/run et la nouvelle route
// POST /api/searches/:id/complement, sur une fausse base EN MÉMOIRE (chaque
// instruction est appliquée d'un bloc, comme une instruction de Postgres).
// Google Lens, l'IA et Google Shopping sont simulés ; le plafond des
// recherches, la limite de l'IA, le disjoncteur et le cache aussi (leurs
// fonctions réelles ont leurs propres tests). Le même verrou sur la vraie base
// de développement : boutiquesEnsuite.test.ts (à lancer sur le Mac).
// Marques, boutiques et mots fictifs.
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

import { env } from "../src/env.js";
import searchesRoutes from "../src/routes/searches.js";
import { searchProductsByImageUrl, type VisualMatch } from "../src/services/visualSearch.js";
import { serpApiTextProvider } from "../src/services/serpapi.js";
import { askShoppingQuery } from "../src/services/shoppingQueryAi.js";
import { reserveSearch, releaseReservation, searchCapacityBeforeComplementAi } from "../src/lib/searchCapacity.js";
import { aiQuotaFor } from "../src/lib/aiQuota.js";
import { assertNoUserImage } from "../src/lib/aiSwitches.js";
import { resetVoieCSchemaProbe } from "../src/lib/voieC.js";
import { COMPLEMENT_PENDING_MAX_MS, COMPLEMENT_RUNNING_MAX_MS, resetDeferredSchemaProbe } from "../src/lib/deferredComplement.js";
import type { LensMeasure } from "../src/services/lensMeasure.js";
import type { TextSearchResponse } from "../src/services/searchProvider.js";

const lensMock = vi.mocked(searchProductsByImageUrl);
const shoppingMock = vi.mocked(serpApiTextProvider.searchByText);
const aiMock = vi.mocked(askShoppingQuery);
const reserveMock = vi.mocked(reserveSearch);
const releaseMock = vi.mocked(releaseReservation);
const capacityMock = vi.mocked(searchCapacityBeforeComplementAi);
const aiQuotaMock = vi.mocked(aiQuotaFor);

const USER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const QUERY = "Exemplor veste Nuage 07";
// Les mots tapés sous la photo : « rouge » trie (il est dans le titre de la 3ᵉ
// proposition Lens), « zéphyrine » n'est dans aucun titre. Ni l'un ni
// l'autre ne doivent partir vers l'IA ou Google Shopping en dehors des titres.
const WORDS = "rouge zéphyrine";

// ---- Fausse base en mémoire ----

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
  /** Colonnes absentes (base sans 0031) : une lecture qui les nomme échoue. */
  missingColumns = new Set<string>();

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
  private columns = "*";
  private returning = false;
  private readonly filters: ((row: Row) => boolean)[] = [];
  private sort: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private mode: "many" | "single" | "maybeSingle" = "many";

  constructor(
    private readonly db: FakeDb,
    private readonly table: string
  ) {}

  select(columns = "*") {
    if (this.action === "select") this.columns = columns;
    else this.returning = true;
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
  order(column: string, options?: { ascending?: boolean }) {
    this.sort = { column, ascending: options?.ascending !== false };
    return this;
  }
  limit(count: number) {
    this.max = count;
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

  /** Une instruction, appliquée d'un bloc. */
  private run(): Result {
    const missing = [...this.db.missingColumns].find((column) => this.columns.includes(column));
    if (this.action === "select" && missing) return { data: null, error: { code: "42703", message: "colonne absente" } };
    const table = this.db.rows(this.table);
    let affected: Row[];
    if (this.action === "insert") {
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
    let rows = affected.map((row) => structuredClone(row));
    if (this.sort) {
      const { column, ascending } = this.sort;
      rows.sort((a, b) => compare(a[column], b[column]) * (ascending ? 1 : -1));
    }
    if (this.max !== null) rows = rows.slice(0, this.max);
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
});

/** L'ordre de Google. Le tri par les mots met la 3ᵉ en tête. */
const LENS: VisualMatch[] = [
  lensMatch(1, "Exemplor veste Nuage 07 bleue", "https://www.lens-exemple.fr/a"),
  lensMatch(2, "Veste Exemplor Nuage 07", "https://autre-lens.fr/b"),
  lensMatch(3, "Veste rouge brodée", "https://troisieme-lens.fr/c"),
];

const LENS_MEASURE: LensMeasure = {
  removedIncomplete: 0,
  removedSocial: 0,
  removedProfessional: 0,
  removedDuplicates: 0,
  received: 3,
  kept: 3,
  keptWithPrice: 3,
  keptOtherCurrency: 0,
  distinctSites: 3,
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
  items: [shoppingItem(1, "Exemplor veste Nuage 07", "https://boutique-a.fr/1"), shoppingItem(2, "Veste bleue sans marque", "https://boutique-b.fr/2")],
  received: 2,
  statusCode: 200,
};

// ---- L'app réduite aux routes des recherches ----

let app: FastifyInstance | null = null;
let db: FakeDb;
let logs: string[];
let rateHits: string[];

afterEach(async () => {
  await app?.close();
  app = null;
});

beforeEach(() => {
  Object.assign(env, { VOIE_C_ENABLED: true, VOIE_C_AI_ENABLED: true });
  resetVoieCSchemaProbe();
  resetDeferredSchemaProbe();
  db = new FakeDb();
  logs = [];
  rateHits = [];
  lensMock.mockReset();
  lensMock.mockResolvedValue({ matches: structuredClone(LENS), measure: LENS_MEASURE, addedRanks: [], statusCode: 200 });
  shoppingMock.mockReset();
  shoppingMock.mockResolvedValue(SHOPPING);
  aiMock.mockReset();
  aiMock.mockResolvedValue({ kind: "query", value: { query: QUERY, brand: "Exemplor", model: "Nuage 07" }, usage: { inputTokens: 900, outputTokens: 40 } });
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
  app = Fastify({ logger: { level: "info", stream: { write: (line: string) => void logs.push(line) } } });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  app.decorate("supabaseAdmin", db as unknown as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  // La personne connectée : l'en-tête « x-compte » des tests (le titulaire par défaut).
  app.decorate("requireAuth", async (request: FastifyRequest) => {
    request.user = { id: String(request.headers["x-compte"] ?? USER), email: null };
  });
  app.decorate("requireActiveAccount", async () => {});
  app.decorate("rateLimit", () => async () => {});
  app.decorate("rateLimitCheck", () => async () => {});
  app.decorate("countRateLimitHit", (_request: FastifyRequest, name: string) => void rateHits.push(name));
  await app.register(searchesRoutes);
  await app.ready();
  return app;
}

/** Une recherche préparée, en attente de son lancement. */
function preparedSearch(): string {
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
  });
  return id;
}

const PHOTO = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#806040" } }).jpeg().toBuffer();

/** Formulaire multipart du lancement : des champs, puis la photo. */
function form(fields: Record<string, string>) {
  const boundary = "limiteDeTest";
  const parts: Buffer[] = Object.entries(fields).map(([name, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), PHOTO, Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "accept-language": "fr-FR" } };
}

function launch(target: FastifyInstance, id: string, fields: Record<string, string> = {}) {
  return target.inject({ method: "POST", url: `/api/searches/${id}/run`, ...form(fields) });
}

function complement(target: FastifyInstance, id: string, account = USER) {
  return target.inject({ method: "POST", url: `/api/searches/${id}/complement`, headers: { "x-compte": account, "accept-language": "fr-FR" } });
}

const searchRow = (id: string) => db.rows("product_searches").find((row) => row.id === id)!;
const matchRows = (id: string) => db.rows("product_matches").filter((row) => row.search_id === id);
const logLines = (message: string) => logs.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.msg === message);
const paidCalls = () => ({ ai: aiMock.mock.calls.length, shopping: shoppingMock.mock.calls.length, shoppingReservations: reserveMock.mock.calls.filter((call) => call[4] === "shopping").length });

/** Un lancement « boutiques ensuite » réussi : la recherche, en attente de ses boutiques. */
async function deferredLaunch(target: FastifyInstance, fields: Record<string, string> = {}): Promise<string> {
  const id = preparedSearch();
  const res = await launch(target, id, { complement: "deferred", ...fields });
  expect(res.statusCode).toBe(200);
  return id;
}

describe("les apps déjà installées (sans le champ) : tout en une fois, comme avant", () => {
  it("Lens, l'IA puis Google Shopping dans le lancement ; la réponse a les boutiques et leur requête ; rien n'attend", async () => {
    const target = await buildApp();
    const id = preparedSearch();
    const res = await launch(target, id);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(paidCalls()).toEqual({ ai: 1, shopping: 1, shoppingReservations: 1 });
    expect(body.complement).toEqual({ status: "shown", query: QUERY, suggestText: false, textStatus: null });
    expect(body.matches.filter((match: { origin?: string }) => match.origin === "shopping").length).toBeGreaterThan(0);
    expect(searchRow(id)).toMatchObject({ status: "completed", complement_status: "shown", shopping_calls: 1, complement_deferred: null });
    // Aucun rang de Google gardé, aucune ligne d'attente.
    expect(matchRows(id).every((row) => row.lens_rank === null)).toBe(true);
    expect(logLines("Mesure complément")).toEqual([expect.objectContaining({ source: "ai", status: "shown", deferred: false, calls: 1 })]);
    // Une seconde demande des boutiques : refusée, sans rien payer.
    const again = await complement(target, id);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: "complement_not_deferred" });
    expect(paidCalls()).toEqual({ ai: 1, shopping: 1, shoppingReservations: 1 });
  });

  it("voie C coupée : le champ est ignoré, Lens seul comme avant, et la route des boutiques répond 404", async () => {
    env.VOIE_C_ENABLED = false;
    const target = await buildApp();
    const id = preparedSearch();
    const res = await launch(target, id, { complement: "deferred" });
    expect(res.statusCode).toBe(200);
    expect(res.json().complement).toBeUndefined();
    expect(searchRow(id).complement_deferred).toBeNull();
    expect(paidCalls()).toEqual({ ai: 0, shopping: 0, shoppingReservations: 0 });
    const shops = await complement(target, id);
    expect(shops.statusCode).toBe(404);
    expect(shops.json()).toMatchObject({ error: "complement_unavailable" });
  });

  it("base sans 0031 : le champ est ignoré, tout se fait au lancement, comme avant", async () => {
    db.missingColumns.add("lens_rank");
    const target = await buildApp();
    const id = preparedSearch();
    const res = await launch(target, id, { complement: "deferred" });
    expect(res.statusCode).toBe(200);
    expect(res.json().complement).toEqual({ status: "shown", query: QUERY, suggestText: false, textStatus: null });
    expect(paidCalls()).toEqual({ ai: 1, shopping: 1, shoppingReservations: 1 });
  });

  it("une autre valeur du champ est refusée avant tout appel", async () => {
    const target = await buildApp();
    const id = preparedSearch();
    const res = await launch(target, id, { complement: "maintenant" });
    expect(res.statusCode).toBe(400);
    expect(lensMock).not.toHaveBeenCalled();
    expect(searchRow(id).status).toBe("pending");
  });
});

describe("boutiques ensuite : le lancement répond dès Lens", () => {
  it("aucun appel du complément (ni IA, ni Google Shopping, ni place réservée) ; la réponse dit « pending »", async () => {
    const target = await buildApp();
    const id = preparedSearch();
    const res = await launch(target, id, { complement: "deferred" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(lensMock).toHaveBeenCalledTimes(1);
    expect(paidCalls()).toEqual({ ai: 0, shopping: 0, shoppingReservations: 0 });
    expect(capacityMock).not.toHaveBeenCalled();
    expect(aiQuotaMock).not.toHaveBeenCalled();
    expect(body.complement).toEqual({ status: null, suggestText: false, textStatus: null, pending: true });
    expect(body.status).toBe("completed");
    expect(body.matches.map((match: { productName: string }) => match.productName)).toEqual(LENS.map((match) => match.productName));
    expect(searchRow(id)).toMatchObject({ complement_deferred: "pending", complement_status: null, shopping_calls: 0, text_suggested: false });
    // Sans mots, l'ordre des rangs est celui de Google : rien de plus n'est gardé.
    expect(matchRows(id).every((row) => row.lens_rank === null)).toBe(true);
    // « Mesure recherche » tout de suite ; « Mesure complément » viendra avec les boutiques.
    expect(logLines("Mesure recherche")).toHaveLength(1);
    expect(logLines("Mesure complément")).toEqual([]);
  });

  it("relue (GET), la recherche annonce les boutiques en attente ; plus après 5 minutes", async () => {
    const target = await buildApp();
    const id = await deferredLaunch(target);
    const read = await target.inject({ method: "GET", url: `/api/searches/${id}` });
    expect(read.json().complement).toEqual({ status: null, suggestText: false, textStatus: null, pending: true });
    searchRow(id).complement_deferred_at = new Date(Date.now() - COMPLEMENT_PENDING_MAX_MS - 1_000).toISOString();
    const later = await target.inject({ method: "GET", url: `/api/searches/${id}` });
    expect(later.json().complement).toEqual({ status: null, suggestText: false, textStatus: null });
    expect(paidCalls()).toEqual({ ai: 0, shopping: 0, shoppingReservations: 0 });
  });

  it("rien à chercher (IA coupée) : l'issue est enregistrée au lancement, comme avant, sans attente", async () => {
    env.VOIE_C_AI_ENABLED = false;
    const target = await buildApp();
    const id = preparedSearch();
    const res = await launch(target, id, { complement: "deferred" });
    expect(res.json().complement).toEqual({ status: "skipped", suggestText: false, textStatus: null });
    expect(searchRow(id)).toMatchObject({ complement_status: "skipped", complement_deferred: null });
    expect(logLines("Mesure complément")).toEqual([expect.objectContaining({ status: "skipped", deferred: false })]);
  });

  it("Lens sans proposition : « Que cherchez-vous ? » proposé au lancement, comme avant, sans attente", async () => {
    lensMock.mockResolvedValue({ matches: [], measure: { ...LENS_MEASURE, kept: 0, keptWithPrice: 0, received: 0, distinctSites: 0 }, addedRanks: [], statusCode: 200 });
    const target = await buildApp();
    const id = preparedSearch();
    const res = await launch(target, id, { complement: "deferred" });
    expect(res.json().complement).toEqual({ status: "no_query", suggestText: true, textStatus: null });
    expect(searchRow(id).complement_deferred).toBeNull();
  });
});

describe("POST /api/searches/:id/complement : l'étape payante une seule fois", () => {
  it("la première demande fait l'étape : boutiques rangées après Lens, colonnes, mesure, requête dans la réponse seulement", async () => {
    const target = await buildApp();
    const id = await deferredLaunch(target);
    const res = await complement(target, id);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(paidCalls()).toEqual({ ai: 1, shopping: 1, shoppingReservations: 1 });
    expect(body.complement).toEqual({ status: "shown", query: QUERY, suggestText: false, textStatus: null });
    const shops = body.matches.filter((match: { origin?: string }) => match.origin === "shopping");
    expect(shops.length).toBeGreaterThan(0);
    // Les propositions Lens gardent leurs rangs ; les boutiques viennent après.
    expect(body.matches.slice(0, 3).map((match: { rank: number; origin?: string }) => [match.rank, match.origin])).toEqual([
      [1, undefined],
      [2, undefined],
      [3, undefined],
    ]);
    expect(Math.min(...shops.map((match: { rank: number }) => match.rank))).toBe(4);
    expect(searchRow(id)).toMatchObject({ complement_deferred: "done", complement_status: "shown", shopping_calls: 1, served_from_cache: false });
    // Mêmes ports qu'au lancement : la garde des images, la limite de l'IA, le plafond.
    expect(aiMock.mock.calls[0]![2]).toMatchObject({ apiKey: "faux-anthropic", assertNoImage: assertNoUserImage });
    expect(aiQuotaMock).toHaveBeenCalledTimes(1);
    expect(capacityMock).toHaveBeenCalledTimes(1);
    expect(logLines("Mesure complément")).toEqual([expect.objectContaining({ source: "ai", status: "shown", deferred: true, calls: 1, lensFromCache: false })]);
    // La requête de l'IA n'est ni enregistrée ni journalisée.
    expect(JSON.stringify(db.rows("product_searches"))).not.toContain(QUERY);
    expect(logs.join("\n")).not.toContain(QUERY);
  });

  it("une seconde demande renvoie l'issue enregistrée, sans aucun appel payant (et sans la requête)", async () => {
    const target = await buildApp();
    const id = await deferredLaunch(target);
    await complement(target, id);
    const again = await complement(target, id);
    expect(again.statusCode).toBe(200);
    expect(paidCalls()).toEqual({ ai: 1, shopping: 1, shoppingReservations: 1 });
    expect(again.json().complement).toEqual({ status: "shown", suggestText: false, textStatus: null });
    expect(again.json().matches.filter((match: { origin?: string }) => match.origin === "shopping").length).toBeGreaterThan(0);
    expect(logLines("Mesure complément")).toHaveLength(1);
  });

  it("trois demandes simultanées : une seule étape payante, toutes reçoivent les boutiques", async () => {
    // L'IA met un peu de temps : les trois demandes arrivent pendant l'étape.
    aiMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { kind: "query", value: { query: QUERY, brand: "Exemplor", model: "Nuage 07" }, usage: { inputTokens: 900, outputTokens: 40 } };
    });
    const target = await buildApp();
    const id = await deferredLaunch(target);
    const replies = await Promise.all([complement(target, id), complement(target, id), complement(target, id)]);
    expect(replies.map((res) => res.statusCode)).toEqual([200, 200, 200]);
    expect(paidCalls()).toEqual({ ai: 1, shopping: 1, shoppingReservations: 1 });
    for (const res of replies) {
      expect(res.json().complement.status).toBe("shown");
      expect(res.json().matches.filter((match: { origin?: string }) => match.origin === "shopping").length).toBeGreaterThan(0);
    }
    expect(replies.filter((res) => res.json().complement.query === QUERY)).toHaveLength(1);
    expect(matchRows(id).filter((row) => row.origin === "shopping").length).toBe(replies[0]!.json().matches.length - 3);
  });

  it("la recherche d'une autre personne : 404, comme une recherche inexistante, sans rien payer ni changer", async () => {
    const target = await buildApp();
    const id = await deferredLaunch(target);
    const res = await complement(target, id, STRANGER);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "search_not_found", message: "Recherche introuvable." });
    const unknown = await complement(target, randomUUID());
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual(res.json());
    expect(paidCalls()).toEqual({ ai: 0, shopping: 0, shoppingReservations: 0 });
    expect(searchRow(id).complement_deferred).toBe("pending");
  });

  it("voie C coupée depuis le lancement : refusée (404), sans rien payer ni changer", async () => {
    const target = await buildApp();
    const id = await deferredLaunch(target);
    env.VOIE_C_ENABLED = false;
    const res = await complement(target, id);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "complement_unavailable" });
    expect(paidCalls()).toEqual({ ai: 0, shopping: 0, shoppingReservations: 0 });
    expect(searchRow(id).complement_deferred).toBe("pending");
  });

  it("étape en attente depuis plus de 5 minutes : expirée, aucun appel payant, issue « no_time »", async () => {
    const target = await buildApp();
    const id = await deferredLaunch(target, { query: WORDS });
    expect(matchRows(id).some((row) => row.lens_rank !== null)).toBe(true);
    searchRow(id).complement_deferred_at = new Date(Date.now() - COMPLEMENT_PENDING_MAX_MS - 1_000).toISOString();
    const res = await complement(target, id);
    expect(res.statusCode).toBe(200);
    expect(paidCalls()).toEqual({ ai: 0, shopping: 0, shoppingReservations: 0 });
    expect(res.json().complement).toEqual({ status: "no_time", suggestText: false, textStatus: null });
    expect(searchRow(id)).toMatchObject({ complement_deferred: "done", complement_status: "no_time" });
    // L'ordre de Google est effacé avec l'expiration.
    expect(matchRows(id).every((row) => row.lens_rank === null)).toBe(true);
    expect(logLines("Mesure complément")).toEqual([expect.objectContaining({ status: "no_time", calls: 0, deferred: true })]);
    // Et plus jamais ensuite.
    await complement(target, id);
    expect(paidCalls()).toEqual({ ai: 0, shopping: 0, shoppingReservations: 0 });
  });

  it("étape restée « running » plus d'une minute (serveur redémarré) : close « error », sans appel payant", async () => {
    const target = await buildApp();
    const id = await deferredLaunch(target);
    Object.assign(searchRow(id), { complement_deferred: "running", complement_deferred_at: new Date(Date.now() - COMPLEMENT_RUNNING_MAX_MS - 1_000).toISOString() });
    const res = await complement(target, id);
    expect(res.statusCode).toBe(200);
    expect(res.json().complement).toEqual({ status: "error", suggestText: false, textStatus: null });
    expect(paidCalls()).toEqual({ ai: 0, shopping: 0, shoppingReservations: 0 });
  });
});

describe("boutiques ensuite : vos mots ne partent nulle part", () => {
  it("l'IA reçoit les titres et sites Lens dans l'ordre de Google ; ni vos mots ni l'ordre qu'ils donnent ne partent, ni ne restent", async () => {
    const target = await buildApp();
    const id = preparedSearch();
    const launched = await launch(target, id, { complement: "deferred", query: WORDS });
    // La réponse et la base suivent l'ordre de vos mots (la 3ᵉ en tête)…
    expect(launched.json().sortedByWords).toBe(true);
    expect(launched.json().matches[0].productName).toBe("Veste rouge brodée");
    // … et l'ordre de Google n'est gardé que jusqu'au début de l'étape.
    expect(matchRows(id).map((row) => [row.rank, row.lens_rank])).toEqual([
      [1, 3],
      [2, 1],
      [3, 2],
    ]);

    const res = await complement(target, id);
    expect(res.statusCode).toBe(200);
    expect(aiMock).toHaveBeenCalledTimes(1);
    const [items] = aiMock.mock.calls[0]!;
    expect(items).toEqual([
      { title: "Exemplor veste Nuage 07 bleue", site: "lens-exemple.fr" },
      { title: "Veste Exemplor Nuage 07", site: "autre-lens.fr" },
      { title: "Veste rouge brodée", site: "troisieme-lens.fr" },
    ]);
    // Google Shopping reçoit la requête de l'IA, rien d'autre.
    expect(shoppingMock.mock.calls[0]![0]).toBe(QUERY);
    const sent = JSON.stringify([aiMock.mock.calls, shoppingMock.mock.calls]);
    expect(sent).not.toContain("zéphyrine");
    expect(sent).not.toContain(WORDS);
    // Rien n'en reste : ni dans la base, ni dans les journaux.
    expect(matchRows(id).every((row) => row.lens_rank === null)).toBe(true);
    expect(JSON.stringify([...db.tables.values()])).not.toContain("zéphyrine");
    expect(logs.join("\n")).not.toContain("zéphyrine");
    expect(logs.join("\n")).not.toContain("rouge");
  });
});

describe("« Que cherchez-vous ? » : proposé au même moment qu'avant, après l'issue des boutiques", () => {
  it("pas pendant l'attente ; après des boutiques peu fiables, oui (et la route des mots l'accepte)", async () => {
    // Aucune pièce, Lens ou boutiques, avec la marque ET le modèle : résultat peu fiable.
    aiMock.mockResolvedValue({ kind: "query", value: { query: "veste brodée", brand: "Inconnue", model: "Z9" }, usage: { inputTokens: 900, outputTokens: 40 } });
    const target = await buildApp();
    const id = await deferredLaunch(target);
    const waiting = await target.inject({ method: "POST", url: `/api/searches/${id}/text`, payload: { words: "veste brodée" } });
    expect(waiting.statusCode).toBe(409);
    expect(searchRow(id).text_requested_at ?? null).toBeNull();
    const res = await complement(target, id);
    expect(res.json().complement).toMatchObject({ status: "shown", suggestText: true });
    expect(searchRow(id).text_suggested).toBe(true);
  });

  it("Lens venu du cache, boutiques appelées : la limite horaire compte ce lancement à ce moment-là", async () => {
    const target = await buildApp();
    const id = await deferredLaunch(target);
    Object.assign(searchRow(id), { lens_from_cache: true, served_from_cache: true });
    rateHits.length = 0;
    await complement(target, id);
    expect(rateHits).toEqual(["searchCreate"]);
    expect(searchRow(id)).toMatchObject({ served_from_cache: false, shopping_calls: 1 });
  });
});
