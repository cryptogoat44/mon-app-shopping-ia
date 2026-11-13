import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { trackingKeyOf } from "../src/lib/alertKeys.js";
import { buildObservations, flushObservations, MAX_OBSERVATIONS, OBSERVATION_LOG_MESSAGE, observePurchase, observeResults, type ObservedRow } from "../src/lib/wishObserve.js";
import { resetWishAlertsProbe } from "../src/lib/wishAlertsSchema.js";
import { resetWishAlertsFlush, waitForWishAlertsFlush } from "../src/lib/wishAlertsSend.js";
import { scrubLogLine } from "../src/lib/logPrivacy.js";

// Alertes prix et stock (lot 2) : l'observation des résultats frais, sans
// base ni réseau. Ce que le serveur envoie à wish_observe (une observation
// par clé, en centimes, jamais une adresse ni une personne) et le « compteur
// gratuit » du journal. La comparaison avec les envies (baisse, stock,
// limites) est faite par la base : alertesPrix.test.ts, sur spotto-dev-2.

const row = (merchantUrl: string, fields: Partial<ObservedRow> = {}): ObservedRow => ({ merchantUrl, merchantName: "Boutique Exemple", priceValue: 89.9, currency: "€", ...fields });
const URL_A = "https://boutique-exemple.fr/vestes/nuage-07";
const URL_B = "https://autre-boutique.fr/vestes/nuage-07";
const KEY_A = trackingKeyOf(URL_A, "Boutique Exemple")!;
const KEY_B = trackingKeyOf(URL_B, "Boutique Exemple")!;
const GOOGLE = "https://www.google.fr/search?q=veste&prds=productid:123456";
const BUYER = "b0000000-0000-4000-8000-0000000000b1";
const OTHER_MEMBER = "c0000000-0000-4000-8000-0000000000c1";
/** Le jour de Paris il y a `days` jours. */
const parisDayAgo = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() - days * 86_400_000));

describe("observations d'une réponse (une par clé, en centimes)", () => {
  it("baisse de prix : le prix part en centimes entiers, avec la devise ISO et le pays de la recherche", () => {
    const { observations, counts } = buildObservations([row(URL_A, { priceValue: 89.9 })], "fr");
    expect(observations).toEqual([{ k: KEY_A.hash, m: "boutiqueexemple", p: 8990, c: "EUR", n: "fr", s: null }]);
    expect(counts).toMatchObject({ rows: 1, keyed: 1, observations: 1, conflicts: 0 });
  });

  it("devise différente ou inconnue : la devise ISO part telle quelle, une écriture inconnue ne part pas (aucune comparaison possible)", () => {
    const { observations } = buildObservations(
      [row(URL_A, { currency: "$US" }), row(URL_B, { currency: "$" }), row("https://troisieme.fr/p/1", { currency: "euros" })],
      "fr"
    );
    const byKey = new Map(observations.map((observation) => [observation.k, observation]));
    expect(byKey.get(KEY_A.hash)).toMatchObject({ p: 8990, c: "USD", n: "fr" });
    // « $ » seul hors des États-Unis, ou écriture inconnue : la pièce est vue, sans prix.
    expect(byKey.get(KEY_B.hash)).toMatchObject({ p: null, c: null, n: null });
    expect(buildObservations([row(URL_A, { currency: "$" })], "us").observations[0]).toMatchObject({ p: 8990, c: "USD", n: "us" });
  });

  it("prix nul ou négatif ignoré ; sans prix, la pièce est quand même vue (jour et stock)", () => {
    expect(buildObservations([row(URL_A, { priceValue: 0 })], "fr").observations[0]).toMatchObject({ p: null, c: null, n: null });
    expect(buildObservations([row(URL_A, { priceValue: null, currency: null, inStock: true })], "fr").observations[0]).toEqual({ k: KEY_A.hash, m: "boutiqueexemple", p: null, c: null, n: null, s: true });
  });

  it("pièce absente des résultats, place de marché, page Google sans productid : rien n'est observé pour elles", () => {
    const { observations, counts } = buildObservations([row("https://www.amazon.fr/dp/B000123"), row("https://www.google.fr/search?q=veste")], "fr");
    expect(observations).toEqual([]);
    expect(counts).toMatchObject({ rows: 2, keyed: 0, observations: 0 });
  });

  it("observations en désaccord pour une même clé (prix, devise, pays, stock, boutique) : la clé est écartée", () => {
    for (const other of [{ priceValue: 79.9 }, { currency: "£" }, { inStock: false }, { merchantName: "Autre Boutique" }] satisfies Partial<ObservedRow>[]) {
      const { observations, counts } = buildObservations([row(URL_A, { inStock: true }), row(`${URL_A}/`, { inStock: true, ...other }), row(URL_B)], "fr");
      expect(observations.map((observation) => observation.k), JSON.stringify(other)).toEqual([KEY_B.hash]);
      expect(counts.conflicts).toBe(1);
    }
    // Même page écrite autrement (« www. », « / » final, suivi publicitaire), mêmes valeurs : une seule observation.
    const same = buildObservations([row(URL_A), row("https://www.boutique-exemple.fr/vestes/nuage-07/?utm_source=lens")], "fr");
    expect(same.observations).toHaveLength(1);
    // L'une sans prix, l'autre avec : elles s'accordent, le prix est gardé.
    expect(buildObservations([row(URL_A, { priceValue: null }), row(URL_A, { inStock: true })], "fr").observations).toEqual([
      { k: KEY_A.hash, m: "boutiqueexemple", p: 8990, c: "EUR", n: "fr", s: true },
    ]);
  });

  it("compteur gratuit : stocks annoncés, identifiants produits de SerpApi, clés Google — des nombres seulement", () => {
    const { counts } = buildObservations(
      [row(URL_A, { inStock: true }), row(URL_B, { inStock: false }), row(GOOGLE, { hasProductId: true }), row("https://www.amazon.fr/dp/1", { hasProductId: true })],
      "fr"
    );
    expect(counts).toEqual({ rows: 4, keyed: 3, googleKeys: 1, inStockTrue: 1, inStockFalse: 1, productIdField: 2, conflicts: 0, observations: 3 });
  });

  it("au plus 200 observations par appel, triées par clé", () => {
    const rows = Array.from({ length: MAX_OBSERVATIONS + 20 }, (_, index) => row(`https://boutique-exemple.fr/p/${index}`));
    const { observations } = buildObservations(rows, "fr");
    expect(observations).toHaveLength(MAX_OBSERVATIONS);
    expect(observations.map((observation) => observation.k)).toEqual([...observations.map((observation) => observation.k)].sort());
  });
});

// ---- observeResults : après la réponse, lancé puis oublié ----

let lines: string[] = [];
let rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let app: FastifyInstance | null = null;

interface StockReportRow {
  user_id: string;
  match_key_hash: string;
  created_on: string;
}

/** Une lecture de stock_reports (select, eq, in, gte, limit), imitée. */
function stockReportsTable(rows: readonly StockReportRow[], fail: boolean) {
  const filters: ((row: StockReportRow) => boolean)[] = [];
  const chain = {
    select: () => chain,
    eq: (column: keyof StockReportRow, value: string) => (filters.push((row) => row[column] === value), chain),
    in: (column: keyof StockReportRow, values: string[]) => (filters.push((row) => values.includes(row[column])), chain),
    gte: (column: keyof StockReportRow, value: string) => (filters.push((row) => row[column] >= value), chain),
    limit: async (n: number) =>
      fail ? { data: null, error: { code: "57014", message: "délai dépassé" } } : { data: rows.filter((row) => filters.every((keep) => keep(row))).slice(0, n).map(() => ({ id: "r" })), error: null },
  };
  return chain;
}

async function observerApp(options: {
  migrated: boolean;
  observe?: () => Promise<{ data: unknown; error: { code: string } | null }>;
  reports?: StockReportRow[];
  reportsFail?: boolean;
}): Promise<FastifyInstance> {
  app = Fastify({ logger: { level: "info", stream: { write: (line: string) => void lines.push(line) }, hooks: { streamWrite: scrubLogLine } } });
  app.decorate("supabaseAdmin", {
    from: (table: string) => {
      if (table !== "stock_reports") throw new Error(`table inattendue : ${table}`);
      return stockReportsTable(options.reports ?? [], options.reportsFail === true);
    },
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ fn, args });
      if (!options.migrated) return { data: null, error: { code: "PGRST202", message: "absente" } };
      if (fn === "wish_alerts_version") return { data: 2, error: null };
      if (fn === "wish_observe") return options.observe ? options.observe() : { data: [{ matched: 2, events: 1 }], error: null };
      return { data: null, error: { code: "PGRST202", message: "absente" } };
    },
  } as unknown as FastifyInstance["supabaseAdmin"]);
  await app.ready();
  return app;
}

const observationLines = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.msg === OBSERVATION_LOG_MESSAGE);

beforeEach(() => {
  resetWishAlertsProbe();
  lines = [];
  rpcCalls = [];
});

afterEach(async () => {
  await flushObservations();
  await resetWishAlertsFlush();
  await app?.close();
  app = null;
  resetWishAlertsProbe();
});

describe("observeResults", () => {
  it("sans la migration 0036 : le compteur gratuit est quand même écrit, rien n'est envoyé à la base", async () => {
    const target = await observerApp({ migrated: false });
    observeResults(target, { source: "lens", rows: [row(URL_A, { inStock: false })], country: "fr" });
    await flushObservations();
    expect(rpcCalls.filter((call) => call.fn === "wish_observe")).toEqual([]);
    expect(observationLines()).toEqual([expect.objectContaining({ source: "lens", rows: 1, keyed: 1, inStockFalse: 1, matched: 0, events: 0, outcome: "counted" })]);
  });

  it("avec 0036 : UN appel à wish_observe, avec le lot seulement (jamais qui a cherché) ; journal : des nombres, jamais une adresse, un titre ni un identifiant", async () => {
    const target = await observerApp({ migrated: true });
    observeResults(target, { source: "shopping", rows: [row(URL_A), row(URL_B, { priceValue: 59 })], country: "fr" });
    await flushObservations();
    const calls = rpcCalls.filter((call) => call.fn === "wish_observe");
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]!.args)).toEqual(["p_batch"]);
    expect(calls[0]!.args.p_batch).toEqual(buildObservations([row(URL_A), row(URL_B, { priceValue: 59 })], "fr").observations);
    expect(JSON.stringify(calls[0]!.args)).not.toMatch(/https?:|boutique-exemple|Veste/);
    expect(observationLines()).toEqual([expect.objectContaining({ source: "shopping", observations: 2, matched: 2, events: 1, outcome: "observed" })]);
    const journal = lines.join("\n");
    expect(journal).not.toContain("boutique-exemple");
    expect(journal).not.toContain(KEY_A.hash);
  });

  it("refus de la base : jamais d'erreur vers la route, une ligne de journal avec le code", async () => {
    const target = await observerApp({ migrated: true, observe: async () => ({ data: null, error: { code: "42883" } }) });
    observeResults(target, { source: "lens", rows: [row(URL_A)], country: "fr" });
    await flushObservations();
    expect(observationLines()).toEqual([expect.objectContaining({ outcome: "failed" })]);
    expect(lines.join("\n")).toContain("42883");
  });

  it("au plus 4 observations en cours : la suivante est sautée et comptée (« busy »)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const target = await observerApp({
      migrated: true,
      observe: async () => {
        await gate;
        return { data: [{ matched: 0, events: 0 }], error: null };
      },
    });
    for (let index = 0; index < 5; index += 1) observeResults(target, { source: "lens", rows: [row(URL_A)], country: "fr" });
    release();
    await flushObservations();
    expect(observationLines().filter((line) => line.outcome === "busy")).toHaveLength(1);
    expect(rpcCalls.filter((call) => call.fn === "wish_observe")).toHaveLength(4);
  });

  it("achat via Spotto : « disponible chez cette boutique aujourd'hui », sans prix, sans pays, sans l'acheteur", async () => {
    // Un signalement d'un AUTRE membre, ou de l'acheteur sur une autre pièce, ou trop ancien : sans effet.
    const target = await observerApp({
      migrated: true,
      reports: [
        { user_id: OTHER_MEMBER, match_key_hash: KEY_A.hash, created_on: parisDayAgo(0) },
        { user_id: BUYER, match_key_hash: KEY_B.hash, created_on: parisDayAgo(0) },
        { user_id: BUYER, match_key_hash: KEY_A.hash, created_on: parisDayAgo(31) },
      ],
    });
    observePurchase(target, BUYER, { merchantUrl: URL_A, merchantName: "Boutique Exemple" });
    await flushObservations();
    expect(rpcCalls.find((call) => call.fn === "wish_observe")!.args).toEqual({ p_batch: [{ k: KEY_A.hash, m: "boutiqueexemple", p: null, c: null, n: null, s: true }] });
    expect(observationLines()).toEqual([expect.objectContaining({ source: "purchase", inStockTrue: 1, outcome: "observed" })]);
    expect(lines.join("\n")).not.toContain(BUYER);
  });

  it("« Plus disponible » puis « Je l'ai achetée » par le MÊME membre : l'achat ne vaut pas « disponible » (aucun faux retour en stock chez les autres)", async () => {
    const target = await observerApp({ migrated: true, reports: [{ user_id: BUYER, match_key_hash: KEY_A.hash, created_on: parisDayAgo(3) }] });
    observePurchase(target, BUYER, { merchantUrl: URL_A, merchantName: "Boutique Exemple" });
    await flushObservations();
    expect(rpcCalls.filter((call) => call.fn === "wish_observe")).toEqual([]);
    expect(observationLines()).toEqual([expect.objectContaining({ source: "purchase", outcome: "own_report", matched: 0, events: 0 })]);
    // Jamais l'acheteur dans le journal.
    expect(lines.join("\n")).not.toContain(BUYER);
  });

  it("signalements illisibles : dans le doute, l'achat ne vaut pas « disponible »", async () => {
    const target = await observerApp({ migrated: true, reportsFail: true });
    observePurchase(target, BUYER, { merchantUrl: URL_A, merchantName: "Boutique Exemple" });
    await flushObservations();
    expect(rpcCalls.filter((call) => call.fn === "wish_observe")).toEqual([]);
    expect(observationLines()).toEqual([expect.objectContaining({ outcome: "own_report" })]);
  });

  it("des alertes viennent de naître : un passage d'envoi part AUSSITÔT après l'observation (« à la seconde près »), par le même chemin atomique (wish_alerts_claim) ; une seconde observation n'attend pas la minute", async () => {
    const target = await observerApp({ migrated: true });
    observeResults(target, { source: "lens", rows: [row(URL_A)], country: "fr" });
    await flushObservations();
    await waitForWishAlertsFlush();
    const fns = rpcCalls.map((call) => call.fn);
    expect(fns.filter((fn) => fn === "wish_alerts_claim")).toHaveLength(1);
    expect(fns.indexOf("wish_alerts_claim")).toBeGreaterThan(fns.indexOf("wish_observe"));
    // Une autre recherche, quelques secondes après, qui crée aussi une alerte : un autre passage, tout de suite.
    observeResults(target, { source: "shopping", rows: [row(URL_B)], country: "fr" });
    await flushObservations();
    await waitForWishAlertsFlush();
    expect(rpcCalls.filter((call) => call.fn === "wish_alerts_claim")).toHaveLength(2);
    // Jamais qui a cherché : le passage ne reçoit qu'une limite.
    for (const call of rpcCalls.filter((entry) => entry.fn === "wish_alerts_claim")) expect(Object.keys(call.args)).toEqual(["p_limit"]);
  });

  it("aucune alerte créée (ou observation refusée) : aucun passage d'envoi lancé par l'observation", async () => {
    const target = await observerApp({ migrated: true, observe: async () => ({ data: [{ matched: 3, events: 0 }], error: null }) });
    observeResults(target, { source: "lens", rows: [row(URL_A)], country: "fr" });
    await flushObservations();
    await waitForWishAlertsFlush();
    expect(rpcCalls.filter((call) => call.fn === "wish_alerts_claim")).toEqual([]);
  });

  it("rien à observer : aucun appel, aucune ligne", async () => {
    const target = await observerApp({ migrated: true });
    observeResults(target, { source: "words", rows: [], country: "fr" });
    await flushObservations();
    expect(rpcCalls).toEqual([]);
    expect(observationLines()).toEqual([]);
  });
});
