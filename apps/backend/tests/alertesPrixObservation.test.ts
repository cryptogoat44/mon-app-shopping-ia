import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { trackingKeyOf } from "../src/lib/alertKeys.js";
import { buildObservations, flushObservations, MAX_OBSERVATIONS, OBSERVATION_LOG_MESSAGE, observePurchase, observeResults, type ObservedRow } from "../src/lib/wishObserve.js";
import { resetWishAlertsProbe } from "../src/lib/wishAlertsSchema.js";
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

async function observerApp(options: { migrated: boolean; observe?: () => Promise<{ data: unknown; error: { code: string } | null }> }): Promise<FastifyInstance> {
  app = Fastify({ logger: { level: "info", stream: { write: (line: string) => void lines.push(line) }, hooks: { streamWrite: scrubLogLine } } });
  app.decorate("supabaseAdmin", {
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ fn, args });
      if (!options.migrated) return { data: null, error: { code: "PGRST202", message: "absente" } };
      if (fn === "wish_alerts_version") return { data: 1, error: null };
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
    const target = await observerApp({ migrated: true });
    observePurchase(target, { merchantUrl: URL_A, merchantName: "Boutique Exemple" });
    await flushObservations();
    expect(rpcCalls.find((call) => call.fn === "wish_observe")!.args).toEqual({ p_batch: [{ k: KEY_A.hash, m: "boutiqueexemple", p: null, c: null, n: null, s: true }] });
    expect(observationLines()).toEqual([expect.objectContaining({ source: "purchase", inStockTrue: 1 })]);
  });

  it("rien à observer : aucun appel, aucune ligne", async () => {
    const target = await observerApp({ migrated: true });
    observeResults(target, { source: "words", rows: [], country: "fr" });
    await flushObservations();
    expect(rpcCalls).toEqual([]);
    expect(observationLines()).toEqual([]);
  });
});
