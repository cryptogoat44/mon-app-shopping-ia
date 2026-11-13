import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { trackingKeyOf } from "../src/lib/alertKeys.js";
import { buildObservations, flushObservations, MAX_OBSERVATIONS, OBSERVATION_LOG_MESSAGE, observeResults, type ObservedRow } from "../src/lib/wishObserve.js";
import { resetWishAlertsProbe } from "../src/lib/wishAlertsSchema.js";
import { resetWishAlertsFlush, waitForWishAlertsFlush } from "../src/lib/wishAlertsSend.js";
import { scrubLogLine } from "../src/lib/logPrivacy.js";

// Alertes prix et stock (lot 2 ; nouvelle version, 0041) : l'observation des
// résultats frais, sans base ni réseau. Ce que le serveur envoie à
// wish_observe (une observation par empreinte, en centimes, jamais une
// adresse ; le membre qui cherche à part, p_observer, jamais au journal) et
// le « compteur gratuit » du journal. La comparaison avec les envies (seuil,
// stock, limites) est faite par la base : alertesPrix.test.ts, sur
// spotto-dev-2, et les scénarios de la base locale jetable.

const row = (merchantUrl: string, fields: Partial<ObservedRow> = {}): ObservedRow => ({ merchantUrl, merchantName: "Boutique Exemple", priceValue: 89.9, currency: "€", ...fields });
const URL_A = "https://boutique-exemple.fr/vestes/nuage-07";
const URL_B = "https://autre-boutique.fr/vestes/nuage-07";
const KEY_A = trackingKeyOf(URL_A, "Boutique Exemple")!;
const KEY_B = trackingKeyOf(URL_B, "Boutique Exemple")!;
const GOOGLE = "https://www.google.fr/search?q=veste&prds=productid:123456";
/** Le membre qui cherche. */
const SEARCHER = "b0000000-0000-4000-8000-0000000000b1";

describe("observations d'une réponse (une par clé, en centimes)", () => {
  it("baisse de prix : le prix part en centimes entiers, avec la devise ISO et le pays de la recherche", () => {
    const { observations, counts } = buildObservations([row(URL_A, { priceValue: 89.9 })], "fr");
    expect(observations).toEqual([{ k: KEY_A.hash, m: "boutiqueexemple", p: 8990, c: "EUR", n: "fr", s: null }]);
    expect(counts).toMatchObject({ rows: 1, keyed: 1, observations: 1, conflicts: 0 });
  });

  // Lot « durcissement des alertes » (entrees-08) : une recherche faite avec une
  // région que les alertes ne prennent pas en charge (« en-NZ ») ne peut jamais
  // fixer le prix de référence des autres membres ; son état du stock compte.
  it("pays non pris en charge par les alertes : ni prix, ni devise, ni pays ; l'état du stock part quand même", () => {
    for (const country of ["nz", "au", "zz"]) {
      const { observations } = buildObservations([row(URL_A, { priceValue: 89.9, inStock: true })], country);
      expect(observations, country).toEqual([{ k: KEY_A.hash, m: "boutiqueexemple", p: null, c: null, n: null, s: true }]);
    }
    for (const [country, currency] of [["fr", "€"], ["gb", "£"], ["ch", "CHF"], ["us", "$"]] as const) {
      expect(buildObservations([row(URL_A, { priceValue: 89.9, currency })], country).observations[0]!.n, country).toBe(country);
    }
  });

  it("devise qui n'est pas celle du pays de la recherche, ou inconnue : la pièce est vue, sans prix (même pays ET même devise, 0041)", () => {
    const { observations } = buildObservations(
      [row(URL_A, { currency: "$US" }), row(URL_B, { currency: "$" }), row("https://troisieme.fr/p/1", { currency: "euros" })],
      "fr"
    );
    for (const observation of observations) expect(observation).toMatchObject({ p: null, c: null, n: null });
    expect(observations).toHaveLength(3);
    expect(buildObservations([row(URL_A, { currency: "$" })], "us").observations[0]).toMatchObject({ p: 8990, c: "USD", n: "us" });
    expect(buildObservations([row(URL_A, { currency: "£" })], "gb").observations[0]).toMatchObject({ p: 8990, c: "GBP", n: "gb" });
    expect(buildObservations([row(URL_A, { currency: "€" })], "gb").observations[0]).toMatchObject({ p: null, c: null, n: null });
  });

  it("prix nul ou négatif ignoré ; sans prix, la pièce est quand même vue (jour et stock)", () => {
    expect(buildObservations([row(URL_A, { priceValue: 0 })], "fr").observations[0]).toMatchObject({ p: null, c: null, n: null });
    expect(buildObservations([row(URL_A, { priceValue: null, currency: null, inStock: true })], "fr").observations[0]).toEqual({ k: KEY_A.hash, m: "boutiqueexemple", p: null, c: null, n: null, s: true });
  });

  it("place de marché, page de Google (même avec un productid) : rien n'est observé pour elles", () => {
    const { observations, counts } = buildObservations([row("https://www.amazon.fr/dp/B000123"), row("https://www.google.fr/search?q=veste"), row(GOOGLE, { inStock: false })], "fr");
    expect(observations).toEqual([]);
    expect(counts).toMatchObject({ rows: 3, keyed: 0, observations: 0 });
  });

  it("observations en désaccord pour une même empreinte (prix, stock, boutique) : l'empreinte est écartée", () => {
    // Une autre devise que celle du pays n'a plus de prix (0041) : elle ne contredit rien.
    expect(buildObservations([row(URL_A), row(`${URL_A}/`, { currency: "£" })], "fr").observations).toHaveLength(1);
    for (const other of [{ priceValue: 79.9 }, { inStock: false }, { merchantName: "Autre Boutique" }] satisfies Partial<ObservedRow>[]) {
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

  it("compteur gratuit : stocks annoncés, identifiants produits de SerpApi, empreintes — des nombres seulement", () => {
    const { counts } = buildObservations(
      [row(URL_A, { inStock: true }), row(URL_B, { inStock: false }), row(GOOGLE, { hasProductId: true }), row("https://www.amazon.fr/dp/1", { hasProductId: true })],
      "fr"
    );
    expect(counts).toEqual({ rows: 4, keyed: 2, inStockTrue: 1, inStockFalse: 1, productIdField: 2, conflicts: 0, observations: 2 });
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

async function observerApp(options: { migrated: boolean; version?: number; observe?: () => Promise<{ data: unknown; error: { code: string } | null }> }): Promise<FastifyInstance> {
  app = Fastify({ logger: { level: "info", stream: { write: (line: string) => void lines.push(line) }, hooks: { streamWrite: scrubLogLine } } });
  app.decorate("supabaseAdmin", {
    from: (table: string) => {
      // L'observation ne lit aucune table (ni signalements, ni comptes) : tout se fait dans wish_observe.
      throw new Error(`table inattendue : ${table}`);
    },
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ fn, args });
      if (!options.migrated) return { data: null, error: { code: "PGRST202", message: "absente" } };
      if (fn === "wish_alerts_version") return { data: options.version ?? 3, error: null };
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
  it("sans les migrations des alertes, ou avec 0040 sans 0041 : le compteur gratuit est quand même écrit, rien n'est envoyé à la base", async () => {
    const before = await observerApp({ migrated: true, version: 2 });
    observeResults(before, { source: "lens", rows: [row(URL_A, { inStock: false })], country: "fr", observerId: SEARCHER });
    await flushObservations();
    expect(rpcCalls.filter((call) => call.fn === "wish_observe")).toEqual([]);
    await before.close();
    resetWishAlertsProbe();
    lines = [];
    const target = await observerApp({ migrated: false });
    observeResults(target, { source: "lens", rows: [row(URL_A, { inStock: false })], country: "fr", observerId: SEARCHER });
    await flushObservations();
    expect(rpcCalls.filter((call) => call.fn === "wish_observe")).toEqual([]);
    expect(observationLines()).toEqual([expect.objectContaining({ source: "lens", rows: 1, keyed: 1, inStockFalse: 1, matched: 0, events: 0, outcome: "counted" })]);
  });

  it("avec 0041 : UN appel à wish_observe, avec le lot et le membre qui cherche (pour son réglage) ; journal : des nombres, jamais une adresse, un titre, un identifiant ni le membre", async () => {
    const target = await observerApp({ migrated: true });
    observeResults(target, { source: "shopping", rows: [row(URL_A), row(URL_B, { priceValue: 59 })], country: "fr", observerId: SEARCHER });
    await flushObservations();
    const calls = rpcCalls.filter((call) => call.fn === "wish_observe");
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]!.args)).toEqual(["p_batch", "p_observer"]);
    expect(calls[0]!.args.p_observer).toBe(SEARCHER);
    expect(calls[0]!.args.p_batch).toEqual(buildObservations([row(URL_A), row(URL_B, { priceValue: 59 })], "fr").observations);
    expect(JSON.stringify(calls[0]!.args.p_batch)).not.toMatch(/https?:|boutique-exemple|Veste/);
    expect(JSON.stringify(calls[0]!.args.p_batch)).not.toContain(SEARCHER);
    expect(observationLines()).toEqual([expect.objectContaining({ source: "shopping", observations: 2, matched: 2, events: 1, outcome: "observed" })]);
    const journal = lines.join("\n");
    expect(journal).not.toContain("boutique-exemple");
    expect(journal).not.toContain(KEY_A.hash);
    expect(journal).not.toContain(SEARCHER);
  });

  it("refus de la base : jamais d'erreur vers la route, une ligne de journal avec le code", async () => {
    const target = await observerApp({ migrated: true, observe: async () => ({ data: null, error: { code: "42883" } }) });
    observeResults(target, { source: "lens", rows: [row(URL_A)], country: "fr", observerId: SEARCHER });
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
    for (let index = 0; index < 5; index += 1) observeResults(target, { source: "lens", rows: [row(URL_A)], country: "fr", observerId: SEARCHER });
    release();
    await flushObservations();
    expect(observationLines().filter((line) => line.outcome === "busy")).toHaveLength(1);
    expect(rpcCalls.filter((call) => call.fn === "wish_observe")).toHaveLength(4);
  });

  it("un achat n'est jamais observé : plus aucune fonction pour lui (« Je l'ai achetée » ne compare rien chez les autres membres)", async () => {
    const module = await import("../src/lib/wishObserve.js");
    expect(Object.keys(module)).not.toContain("observePurchase");
    const source = (await import("node:fs")).readFileSync(new URL("../src/lib/wishObserve.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/"purchase"|stock_reports|skipIfReportedBy/);
  });

  it("des alertes viennent de naître : un passage d'envoi part AUSSITÔT après l'observation (« à la seconde près »), par le même chemin atomique (wish_alerts_claim) ; une seconde observation n'attend pas la minute", async () => {
    const target = await observerApp({ migrated: true });
    observeResults(target, { source: "lens", rows: [row(URL_A)], country: "fr", observerId: SEARCHER });
    await flushObservations();
    await waitForWishAlertsFlush();
    const fns = rpcCalls.map((call) => call.fn);
    expect(fns.filter((fn) => fn === "wish_alerts_claim")).toHaveLength(1);
    expect(fns.indexOf("wish_alerts_claim")).toBeGreaterThan(fns.indexOf("wish_observe"));
    // Une autre recherche, quelques secondes après, qui crée aussi une alerte : un autre passage, tout de suite.
    observeResults(target, { source: "shopping", rows: [row(URL_B)], country: "fr", observerId: SEARCHER });
    await flushObservations();
    await waitForWishAlertsFlush();
    expect(rpcCalls.filter((call) => call.fn === "wish_alerts_claim")).toHaveLength(2);
    // Jamais qui a cherché : le passage ne reçoit qu'une limite.
    for (const call of rpcCalls.filter((entry) => entry.fn === "wish_alerts_claim")) expect(Object.keys(call.args)).toEqual(["p_limit"]);
  });

  it("aucune alerte créée (ou observation refusée) : aucun passage d'envoi lancé par l'observation", async () => {
    const target = await observerApp({ migrated: true, observe: async () => ({ data: [{ matched: 3, events: 0 }], error: null }) });
    observeResults(target, { source: "lens", rows: [row(URL_A)], country: "fr", observerId: SEARCHER });
    await flushObservations();
    await waitForWishAlertsFlush();
    expect(rpcCalls.filter((call) => call.fn === "wish_alerts_claim")).toEqual([]);
  });

  it("rien à observer : aucun appel, aucune ligne", async () => {
    const target = await observerApp({ migrated: true });
    observeResults(target, { source: "words", rows: [], country: "fr", observerId: SEARCHER });
    await flushObservations();
    expect(rpcCalls).toEqual([]);
    expect(observationLines()).toEqual([]);
  });
});
