import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import searchesRoutes from "../src/routes/searches.js";
import { requestLogFields, scrubLogLine, withoutErrorDetails } from "../src/lib/logPrivacy.js";
import { HISTORY_SCAN_BATCH, historyLikePattern, matchesHistoryQuery, recentSearchesQuerySchema } from "../src/lib/searchHistory.js";
import { keptMatchRows } from "../src/lib/searchRows.js";
import { fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Retours du build 2, lot « historique » : GET /api/searches reçoit `before`
// (la suite de l'historique) et `q` (une recherche dans l'historique),
// FACULTATIFS, sur une fausse base en mémoire (tests/fakeSupabase.ts, aucun
// réseau). Chaque règle : un cas refusé, un cas permis. Pièces, marques et
// boutiques fictives.

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const BASE = Date.UTC(2026, 10, 24, 12, 0, 0);
/** Date de la recherche n° i (0 : la plus récente), une minute d'écart. */
const at = (i: number) => new Date(BASE - i * 60_000).toISOString();
const searchId = (owner: string, i: number) => `${owner.slice(0, 8)}-0000-4000-8000-${String(i).padStart(12, "0")}`;
const matchId = (owner: string, i: number, rank: number) => `${owner.slice(0, 7)}f-${String(rank).padStart(4, "0")}-4000-8000-${String(i).padStart(12, "0")}`;

function searchRow(owner: string, i: number, extra: Row = {}): Row {
  return {
    id: searchId(owner, i),
    user_id: owner,
    source_url: null,
    source_platform: "photo",
    method: "manual_screenshot",
    screenshot_url: null,
    status: "completed",
    error_message: null,
    query: null,
    created_at: at(i),
    refused_before_call: 0,
    failure_kind: null,
    provider: "serpapi",
    run_started_at: at(i),
    ...extra,
  };
}

function matchRow(owner: string, i: number, rank: number, extra: Row = {}): Row {
  return {
    id: matchId(owner, i, rank),
    search_id: searchId(owner, i),
    rank,
    product_name: `Pièce ${i}-${rank}`,
    brand: null,
    image_url: `https://images.example.test/${i}-${rank}.jpg`,
    image_hd_url: null,
    price_min: null,
    price_max: null,
    currency: null,
    merchant_name: "Boutique Exemple",
    merchant_url: `https://boutique-exemple.test/${i}/${rank}`,
    origin: "lens",
    created_at: at(i),
    ...extra,
  };
}

/** `count` recherches d'Alice, deux propositions chacune. */
function seeded(count: number, options: FakeDbOptions = {}) {
  const fake = fakeSupabase(options);
  for (let i = 0; i < count; i += 1) {
    fake.table("product_searches").push(searchRow(ALICE, i));
    fake.table("product_matches").push(matchRow(ALICE, i, 1), matchRow(ALICE, i, 2));
  }
  return fake;
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function buildApp(db: unknown, logLines: string[] = []): Promise<FastifyInstance> {
  app = Fastify({
    logger: {
      level: "info",
      stream: { write: (line: string) => void logLines.push(line) },
      serializers: { req: requestLogFields },
      formatters: { log: withoutErrorDetails },
      hooks: { streamWrite: scrubLogLine },
    },
  });
  app.decorate("supabaseAdmin", db as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest) => {
    request.user = { id: String(request.headers["x-compte"] ?? ALICE), email: null };
  });
  app.decorate("requireActiveAccount", async () => {});
  app.decorate("rateLimit", () => async () => {});
  app.decorate("rateLimitCheck", () => async () => {});
  app.decorate("countRateLimitHit", () => {});
  await app.register(searchesRoutes);
  await app.ready();
  return app;
}

type Listed = { id: string; createdAt: string; matches: { id: string; productName: string }[] };
async function list(target: FastifyInstance, url: string, user = ALICE) {
  const res = await target.inject({ method: "GET", url, headers: { "x-compte": user } });
  return { status: res.statusCode, body: res.json() as Listed[] };
}
const qs = (params: Record<string, string>) => `/api/searches?${new URLSearchParams(params).toString()}`;

describe("paramètres : `before` et `q` facultatifs, vérifiés", () => {
  it("refusé : date illisible, `q` d'un caractère ou de plus de 60, caractère de contrôle ; permis : date avec fuseau, `q` sans blancs autour", () => {
    const parse = (value: object) => recentSearchesQuerySchema.safeParse(value);
    expect(parse({ before: "hier" }).success).toBe(false);
    expect(parse({ q: " a " }).success).toBe(false);
    expect(parse({ q: "x".repeat(61) }).success).toBe(false);
    expect(parse({ q: "sac\u0000noir" }).success).toBe(false);
    expect(parse({ before: "2026-11-24T10:00:00.123456+00:00" }).success).toBe(true);
    expect(parse({ before: "2026-11-24T10:00:00Z" }).success).toBe(true);
    expect(parse({ q: "  sac noir " }).data).toEqual({ q: "sac noir" });
    expect(parse({ q: "x".repeat(60) }).success).toBe(true);
  });

  it("refusé par la route : 400, sans rien lire", async () => {
    const target = await buildApp(seeded(3).db);
    for (const url of [qs({ before: "hier" }), qs({ q: "a" }), qs({ q: "x".repeat(61) }), "/api/searches?q=sac&q=noir"]) {
      expect((await list(target, url)).status, url).toBe(400);
    }
  });

  it("premier tri dans la base : un joker tapé ne vaut jamais « tout » ; recherche exacte sans tenir compte de la casse", () => {
    expect(historyLikePattern("sac noir")).toBe("%sac noir%");
    expect(historyLikePattern("100%")).toBe("%100_%");
    expect(historyLikePattern("a*b_c\\d")).toBe("%a_b_c_d%");
    const piece = { product_name: "Sac NOIR Exemplor", brand: null, merchant_name: "Boutique (Paris), Lyon" };
    expect(matchesHistoryQuery(piece, "sac noir")).toBe(true);
    expect(matchesHistoryQuery(piece, "(paris), ly")).toBe(true);
    expect(matchesHistoryQuery(piece, "sac rouge")).toBe(false);
    expect(matchesHistoryQuery(piece, "%")).toBe(false);
  });
});

describe("ancien chemin : une app qui n'envoie que `limit` reçoit la réponse d'aujourd'hui", () => {
  it("permis : 6 par défaut, 20 au plus, la meilleure proposition de chaque recherche, des plus récentes aux plus anciennes", async () => {
    const target = await buildApp(seeded(25).db);
    const byDefault = await list(target, "/api/searches");
    expect(byDefault.status).toBe(200);
    expect(byDefault.body.map((search) => search.id)).toEqual([0, 1, 2, 3, 4, 5].map((i) => searchId(ALICE, i)));
    expect(byDefault.body.every((search) => search.matches.length === 1 && search.matches[0]!.id.endsWith(search.id.slice(-12)))).toBe(true);
    expect(byDefault.body[0]!.matches[0]!.productName).toBe("Pièce 0-1");
    const max = await list(target, "/api/searches?limit=50");
    expect(max.body).toHaveLength(20);
  });
});

describe("`before` : la suite de l'historique", () => {
  it("permis : seulement les recherches plus anciennes, par pages de 20, sans doublon, jusqu'au bout ; refusé : celles d'un autre membre", async () => {
    const fake = seeded(45);
    fake.table("product_searches").push(searchRow(BOB, 100, { created_at: at(30) }));
    fake.table("product_matches").push(matchRow(BOB, 100, 1));
    const target = await buildApp(fake.db);
    const first = await list(target, "/api/searches?limit=20");
    const second = await list(target, qs({ limit: "20", before: first.body.at(-1)!.createdAt }));
    const third = await list(target, qs({ limit: "20", before: second.body.at(-1)!.createdAt }));
    const fourth = await list(target, qs({ limit: "20", before: third.body.at(-1)!.createdAt }));
    expect([first, second, third, fourth].map((page) => page.body.length)).toEqual([20, 20, 5, 0]);
    const ids = [first, second, third].flatMap((page) => page.body.map((search) => search.id));
    expect(new Set(ids).size).toBe(45);
    expect(ids).toEqual(Array.from({ length: 45 }, (_, i) => searchId(ALICE, i)));
    expect(ids).not.toContain(searchId(BOB, 100));
  });

  it("permis : une recherche sans proposition encore montrée est sautée, la page se remplit avec les suivantes", async () => {
    const fake = seeded(60);
    // Recherches 20 à 24 : leurs propositions viennent toutes d'une boutique masquée.
    for (const row of fake.table("product_matches")) {
      const i = Number(String(row.search_id).slice(-12));
      if (i >= 20 && i < 25) row.merchant_url = `https://replica-exemple.test/${i}`;
    }
    expect(keptMatchRows([{ merchant_url: "https://replica-exemple.test/1", price_min: null, currency: null }])).toHaveLength(0);
    const target = await buildApp(fake.db);
    const next = await list(target, qs({ limit: "20", before: at(19) }));
    expect(next.body.map((search) => search.id)).toEqual(Array.from({ length: 20 }, (_, k) => searchId(ALICE, 25 + k)));
  });
});

describe("`q` : chercher dans ses recherches passées", () => {
  function catalogue() {
    const fake = seeded(8);
    const set = (i: number, rank: number, fields: Row) => Object.assign(fake.table("product_matches").find((row) => row.id === matchId(ALICE, i, rank))!, fields);
    set(2, 2, { product_name: "Veste en daim marron" });
    set(5, 1, { brand: "Exemplor" });
    set(6, 2, { merchant_name: "Atelier Nuage" });
    // Une veste en daim chez une boutique masquée : jamais montrée.
    set(7, 1, { product_name: "Veste en daim noire", merchant_url: "https://replica-exemple.test/veste" });
    // Recherche d'avant le 27 octobre : son texte tapé n'est jamais fouillé.
    Object.assign(fake.table("product_searches").find((row) => row.id === searchId(ALICE, 4))!, { query: "veste en daim pour Léa" });
    // Bob a aussi une veste en daim.
    fake.table("product_searches").push(searchRow(BOB, 50, { created_at: at(1) }));
    fake.table("product_matches").push(matchRow(BOB, 50, 1, { product_name: "Veste en daim de Bob" }));
    return fake;
  }

  it("permis : la proposition qui correspond (pas la meilleure), dans le nom, la marque ou la boutique, sans tenir compte de la casse", async () => {
    const target = await buildApp(catalogue().db);
    const veste = await list(target, qs({ q: "VESTE EN DAIM", limit: "20" }));
    expect(veste.status).toBe(200);
    expect(veste.body.map((search) => search.id)).toEqual([searchId(ALICE, 2)]);
    expect(veste.body[0]!.matches).toHaveLength(1);
    expect(veste.body[0]!.matches[0]!.id).toBe(matchId(ALICE, 2, 2));
    expect(veste.body[0]!.matches[0]!.productName).toBe("Veste en daim marron");
    expect((await list(target, qs({ q: "exemplor", limit: "20" }))).body.map((search) => search.matches[0]!.id)).toEqual([matchId(ALICE, 5, 1)]);
    expect((await list(target, qs({ q: "nuage", limit: "20" }))).body.map((search) => search.matches[0]!.id)).toEqual([matchId(ALICE, 6, 2)]);
  });

  it("refusé : la recherche d'un autre membre, une boutique masquée, le texte tapé d'une ancienne recherche", async () => {
    const target = await buildApp(catalogue().db);
    const ids = (await list(target, qs({ q: "daim", limit: "20" }))).body.map((search) => search.id);
    expect(ids).toEqual([searchId(ALICE, 2)]);
    expect((await list(target, qs({ q: "Léa", limit: "20" }))).body).toEqual([]);
    // Bob, lui, retrouve la sienne.
    expect((await list(target, qs({ q: "daim", limit: "20" }), BOB)).body.map((search) => search.id)).toEqual([searchId(BOB, 50)]);
  });

  it("refusé : virgules, parenthèses et jokers tapés ne cassent ni n'élargissent le filtre ; permis : ils sont cherchés tels quels", async () => {
    const fake = catalogue();
    Object.assign(fake.table("product_matches").find((row) => row.id === matchId(ALICE, 3, 1))!, { product_name: "Sac (édition 100%), cuir" });
    const target = await buildApp(fake.db);
    for (const q of ["%%", "__", "**", "a,b(c)", "),product_name.ilike.*"]) {
      const res = await list(target, qs({ q, limit: "20" }));
      expect(res.status, q).toBe(200);
      expect(res.body, q).toEqual([]);
    }
    expect((await list(target, qs({ q: "100%), cu", limit: "20" }))).body.map((search) => search.matches[0]!.id)).toEqual([matchId(ALICE, 3, 1)]);
  });

  it("permis : `q` et `before` ensemble, par pages, au-delà des premières recherches parcourues", async () => {
    const count = HISTORY_SCAN_BATCH * 2 + 30;
    const fake = seeded(count);
    // Une recherche sur dix a une écharpe en 2e proposition.
    for (let i = 0; i < count; i += 10) Object.assign(fake.table("product_matches").find((row) => row.id === matchId(ALICE, i, 2))!, { product_name: `Écharpe ${i}` });
    const target = await buildApp(fake.db);
    const first = await list(target, qs({ q: "écharpe", limit: "20" }));
    const second = await list(target, qs({ q: "écharpe", limit: "20", before: first.body.at(-1)!.createdAt }));
    const third = await list(target, qs({ q: "écharpe", limit: "20", before: second.body.at(-1)!.createdAt }));
    expect([first, second, third].map((page) => page.body.length)).toEqual([20, 3, 0]);
    const found = [...first.body, ...second.body].map((search) => search.id);
    expect(found).toEqual(Array.from({ length: 23 }, (_, k) => searchId(ALICE, k * 10)));
  });

  it("permis : « Max rows » de Supabase plus petit qu'une page, rien n'est perdu", async () => {
    const fake = seeded(30, { maxRows: 7 });
    Object.assign(fake.table("product_matches").find((row) => row.id === matchId(ALICE, 29, 2))!, { product_name: "Ceinture tressée" });
    const target = await buildApp(fake.db);
    expect((await list(target, qs({ q: "ceinture", limit: "20" }))).body.map((search) => search.id)).toEqual([searchId(ALICE, 29)]);
  });
});

describe("vie privée : les mots tapés ne sont ni gardés ni écrits dans le journal", () => {
  const WORDS = "Robe zéphyrine";

  it("permis : réponse normale, le journal ne note que la route ; rien d'écrit dans la base", async () => {
    const lines: string[] = [];
    const fake = seeded(5);
    const before = JSON.stringify([...fake.tables]);
    const target = await buildApp(fake.db, lines);
    expect((await list(target, qs({ q: WORDS, limit: "20" }))).status).toBe(200);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toMatch(/zéphyrine|z%C3%A9phyrine|Robe/i);
    expect(lines.join("\n")).toContain("/api/searches");
    expect(JSON.stringify([...fake.tables])).toBe(before);
  });

  it("refusé : lecture impossible — 500, et toujours aucun mot dans le journal", async () => {
    const lines: string[] = [];
    const target = await buildApp(seeded(5, { missing: ["product_matches"] }).db, lines);
    expect((await list(target, qs({ q: WORDS, limit: "20" }))).status).toBe(500);
    expect(lines.join("\n")).toContain("Échec de lecture de la suite de l'historique des recherches");
    expect(lines.join("\n")).not.toMatch(/zéphyrine|z%C3%A9phyrine|Robe/i);
  });
});
