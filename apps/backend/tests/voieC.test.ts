import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { startDeadline, VOIE_C_BUDGET } from "../src/lib/deadline.js";
import { complementLogLine } from "../src/lib/searchMeasure.js";
import { singleFlightPending } from "../src/lib/singleFlight.js";
import {
  complementAfterSaveFailure,
  launchColumns,
  lensStep,
  QUERY_CACHE_PAYLOAD,
  runComplement,
  runTextComplement,
  sanitizeShoppingQuery,
  type AiLensItem,
  type CacheStep,
  type ComplementInput,
  type ComplementPorts,
  type LensAnswer,
  type LightSortPort,
  type ShoppingQueryAnswer,
  type TextComplementPorts,
  type VoieCLog,
} from "../src/lib/voieC.js";
import { ProviderFailure, type ProviderShoppingItem, type TextSearchResponse } from "../src/services/searchProvider.js";
import type { VisualMatch } from "../src/services/visualSearch.js";

// Lot c, voie C : le cœur du complément, avec des ports factices et une
// fausse horloge. Aucun réseau : ni SerpApi, ni Anthropic, ni Supabase.
// Marques et sites fictifs. Interrupteurs forcés à « coupé » : un .env qui
// allumerait la voie C (sur le Mac) ne change pas ces tests.
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, VOIE_C_ENABLED: false, VOIE_C_AI_ENABLED: false, ANTHROPIC_PHOTO_ENABLED: false } };
});

const FR = { country: "fr", hl: "fr" };
const QUERY = "Exemplor veste Nuage 07";
const BRAND = "Exemplor";
const MODEL = "Nuage 07";

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const lensMatch = (rank: number, productName: string, merchantUrl: string): VisualMatch => ({
  rank,
  productName,
  imageUrl: `https://images.exemple.fr/${rank}.jpg`,
  imageHdUrl: null,
  merchantName: "Marchand Exemple",
  merchantUrl,
  priceValue: 59,
  currency: "€",
});

const LENS: VisualMatch[] = [
  lensMatch(1, "Exemplor veste Nuage 07 bleue", "https://www.lens-exemple.fr/a"),
  lensMatch(2, "Veste Exemplor Nuage 07", "https://autre-lens.fr/b"),
  lensMatch(3, "Veste bleue", "https://troisieme-lens.fr/c"),
];
/** Lens sans aucun titre « marque ET modèle » (palier 1 au mieux). */
const LENS_WEAK: VisualMatch[] = [lensMatch(1, "Veste Exemplor bleue", "https://www.lens-exemple.fr/a"), lensMatch(2, "Veste bleue", "https://autre-lens.fr/b")];

const shoppingItem = (position: number, title: string, link: string): ProviderShoppingItem => ({
  position,
  title,
  link,
  product_link: `https://www.google.fr/shopping/product/${position}`,
  source: "Boutique Exemple",
  price: "49,99 €",
  extracted_price: 49.99,
  thumbnail: `https://encrypted-tbn0.gstatic.com/images?q=tbn:${position}`,
});

const SHOPPING: TextSearchResponse = {
  items: [
    shoppingItem(1, "Veste bleue sans marque", "https://boutique-b.fr/2"),
    shoppingItem(2, "Exemplor veste Nuage 07", "https://boutique-a.fr/1"),
    // Même page qu'un résultat Lens : doublon, retiré.
    shoppingItem(3, "Exemplor Nuage 07", "https://www.lens-exemple.fr/a"),
  ],
  received: 3,
  statusCode: 200,
};

/** Tri léger factice : palier 0 si marque et modèle sont dans le titre, 1 si l'un des deux, 2 sinon. */
const fakeLightSort: LightSortPort = (items, reference) => {
  const has = (title: string, part: string) => part !== "" && title.toLowerCase().includes(part.toLowerCase());
  const tiers: [typeof items, typeof items, typeof items] = [[], [], []];
  for (const item of items) {
    const brand = has(item.productName, reference.brand);
    const model = has(item.productName, reference.model);
    tiers[brand && model ? 0 : brand || model ? 1 : 2].push(item);
  }
  return { items: [...tiers[0], ...tiers[1], ...tiers[2]], tierCounts: [tiers[0].length, tiers[1].length, tiers[2].length] };
};

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Cache factice partagé entre plusieurs lancements (aller-retour JSON, comme jsonb). */
function fakeCache() {
  const entries = new Map<string, { step: CacheStep; payload: unknown }>();
  return {
    entries,
    readCache: async <T>(key: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T | null> => {
      const entry = entries.get(key);
      if (!entry) return null;
      const parsed = schema.safeParse(entry.payload);
      return parsed.success ? parsed.data : null;
    },
    writeCache: (key: string, step: CacheStep, payload: unknown) => {
      entries.set(key, { step, payload: JSON.parse(JSON.stringify(payload)) });
    },
    cacheKey: (step: CacheStep, parts: string[]) => sha256(JSON.stringify([step, ...parts])),
    dropStep(step: CacheStep) {
      for (const [key, entry] of entries) if (entry.step === step) entries.delete(key);
    },
  };
}

function fakeClock(start: number) {
  let time = start;
  return {
    now: () => time,
    set: (value: number) => (time = value),
    advance: (ms: number) => (time += ms),
  };
}

const QUERY_ANSWER: ShoppingQueryAnswer = { kind: "query", value: { query: QUERY, brand: BRAND, model: MODEL }, usage: { inputTokens: 900, outputTokens: 40 } };

class FakeShoppingQueryError extends Error {
  constructor(
    readonly kind: "unavailable" | "refused" | "invalid_output",
    readonly status: number | null = null
  ) {
    super(`shopping_query_${kind}`);
  }
}

function fakeLog() {
  const warn = vi.fn();
  const error = vi.fn();
  return { log: { warn, error } as unknown as VoieCLog, warn, error };
}

type Cache = ReturnType<typeof fakeCache>;

function setup(options: { cache?: Cache; clock?: ReturnType<typeof fakeClock>; ports?: Partial<ComplementPorts> } = {}) {
  const cache = options.cache ?? fakeCache();
  // Lens a répondu 4 s après T0 : il reste 10 s.
  const clock = options.clock ?? fakeClock(4_000);
  const logs = fakeLog();
  const timeouts: number[] = [];
  const ports = {
    readCache: cache.readCache,
    writeCache: cache.writeCache,
    cacheKey: cache.cacheKey,
    aiInputKey: vi.fn((items: AiLensItem[], locale: { country: string; hl: string }) => cache.cacheKey("query", ["consignes-test", locale.country, locale.hl, JSON.stringify(items)])),
    askQuery: vi.fn(async (): Promise<ShoppingQueryAnswer> => QUERY_ANSWER),
    sortShopping: fakeLightSort,
    searchText: vi.fn(async (): Promise<TextSearchResponse> => SHOPPING),
    reserve: vi.fn(async () => ({ allowed: true as const, reservationId: 42 })),
    release: vi.fn(async () => true),
    capacityLeft: vi.fn(async () => true),
    consumeAiLimit: vi.fn(() => true),
    socketDestroyed: vi.fn(() => false),
    now: clock.now,
    log: logs.log,
    timeoutSignal: (ms: number) => {
      timeouts.push(ms);
      return new AbortController().signal;
    },
    ...options.ports,
  } satisfies ComplementPorts;
  const input = (extra: Partial<ComplementInput> = {}): ComplementInput => ({
    lens: LENS,
    lensFailed: false,
    lensCalled: true,
    shoppingCalls: 0,
    locale: FR,
    deadline: startDeadline(0, VOIE_C_BUDGET.totalMs, clock.now),
    aiEnabled: true,
    ...extra,
  });
  return { cache, clock, logs, timeouts, ports, input };
}

describe("runComplement — le chemin normal", () => {
  it("Lens, puis l'IA, puis les boutiques : « shown » ; les objets et l'ordre de Lens ne sont jamais touchés", async () => {
    const { ports, input, timeouts } = setup();
    const lens = deepFreeze(structuredClone(LENS));
    const result = await runComplement(ports, input({ lens }));

    expect(lens).toEqual(LENS);
    expect(result.columns).toEqual({ complement_status: "shown", shopping_calls: 1, text_suggested: false });
    expect(result.reply).toEqual({ status: "shown", query: QUERY, suggestText: false, textStatus: null });
    // Doublon de la page Lens retiré ; palier 0 en tête, puis l'ordre de Google.
    expect(result.matches.map((match) => match.merchantUrl)).toEqual(["https://boutique-a.fr/1", "https://boutique-b.fr/2"]);
    expect(result.matches.map((match) => match.rank)).toEqual([1, 2]);
    expect(result.matches[0]).toMatchObject({ priceValue: 49.99, currency: "EUR" });
    // L'IA reçoit les titres et sites Lens, dans l'ordre de Google, rien d'autre.
    expect(ports.askQuery).toHaveBeenCalledOnce();
    expect(vi.mocked(ports.askQuery).mock.calls[0]![0]).toEqual([
      { title: "Exemplor veste Nuage 07 bleue", site: "lens-exemple.fr" },
      { title: "Veste Exemplor Nuage 07", site: "autre-lens.fr" },
      { title: "Veste bleue", site: "troisieme-lens.fr" },
    ]);
    expect(ports.capacityLeft).toHaveBeenCalledOnce();
    expect(ports.consumeAiLimit).toHaveBeenCalledOnce();
    expect(ports.reserve).toHaveBeenCalledOnce();
    expect(ports.searchText).toHaveBeenCalledWith(QUERY, FR, expect.any(AbortSignal));
    expect(ports.release).not.toHaveBeenCalled();
    // Délais : lectures du cache 800 ms, IA min(3 s, 10 − 4), boutiques min(5 s, 10 − 1,5).
    expect(timeouts).toEqual([800, 3_000, 800, 5_000]);
    expect(result.measure).toMatchObject({ source: "ai", status: "shown", calls: 1, queryFromCache: false, shoppingFromCache: false, received: 3, kept: 2, keptWithPrice: 2, tier0: 1, tier1: 0, inputTokens: 900, outputTokens: 40 });
  });

  it("aucune pièce fiable (marque ET modèle absents de tous les titres, Lens et boutiques) : « shown » et « Que cherchez-vous ? » proposé", async () => {
    const { ports, input } = setup({
      ports: {
        searchText: vi.fn(async (): Promise<TextSearchResponse> => ({ items: [shoppingItem(1, "Veste Exemplor bleue", "https://boutique-a.fr/1")], received: 1, statusCode: 200 })),
      },
    });
    const result = await runComplement(ports, input({ lens: LENS_WEAK }));
    expect(result.columns).toEqual({ complement_status: "shown", shopping_calls: 1, text_suggested: true });
    expect(result.reply.suggestText).toBe(true);
    expect(result.matches).toHaveLength(1);
  });

  it("rien de gardé après les filtres : « empty » et « Que cherchez-vous ? » proposé", async () => {
    const { ports, input } = setup({
      ports: { searchText: vi.fn(async (): Promise<TextSearchResponse> => ({ items: [shoppingItem(3, "Exemplor Nuage 07", "https://www.lens-exemple.fr/a")], received: 1, statusCode: 200 })) },
    });
    const result = await runComplement(ports, input());
    expect(result.columns).toEqual({ complement_status: "empty", shopping_calls: 1, text_suggested: true });
    expect(result.reply).toEqual({ status: "empty", query: QUERY, suggestText: true, textStatus: null });
    expect(result.matches).toEqual([]);
  });

  it("20 au plus, après le tri léger", async () => {
    const items = Array.from({ length: 30 }, (_, index) => shoppingItem(index + 1, index >= 25 ? "Exemplor veste Nuage 07" : "Veste bleue", `https://boutique-${index}.fr/p`));
    const { ports, input } = setup({ ports: { searchText: vi.fn(async (): Promise<TextSearchResponse> => ({ items, received: 30, statusCode: 200 })) } });
    const result = await runComplement(ports, input());
    expect(result.matches).toHaveLength(20);
    expect(result.matches.slice(0, 5).every((match) => match.productName === "Exemplor veste Nuage 07")).toBe(true);
    expect(result.measure).toMatchObject({ received: 30, kept: 20, tier0: 5 });
  });

  it("la même image relancée : requête et boutiques lues dans le cache, aucune IA, aucune garde de dépense, aucun appel", async () => {
    const cache = fakeCache();
    await runComplement(setup({ cache }).ports, setup({ cache }).input());
    const { ports, input } = setup({ cache });
    const result = await runComplement(ports, input());
    expect(result.columns).toEqual({ complement_status: "shown", shopping_calls: 0, text_suggested: false });
    expect(ports.askQuery).not.toHaveBeenCalled();
    expect(ports.capacityLeft).not.toHaveBeenCalled();
    expect(ports.consumeAiLimit).not.toHaveBeenCalled();
    expect(ports.reserve).not.toHaveBeenCalled();
    expect(ports.searchText).not.toHaveBeenCalled();
    expect(result.measure).toMatchObject({ queryFromCache: true, shoppingFromCache: true, calls: 0 });
  });

  it("requête dans le cache : pas d'IA et AUCUNE garde de dépense consommée ; les boutiques, elles, sont appelées", async () => {
    const cache = fakeCache();
    await runComplement(setup({ cache }).ports, setup({ cache }).input());
    cache.dropStep("shopping");
    const { ports, input } = setup({ cache });
    const result = await runComplement(ports, input());
    expect(result.reply.status).toBe("shown");
    expect(ports.askQuery).not.toHaveBeenCalled();
    expect(ports.capacityLeft).not.toHaveBeenCalled();
    expect(ports.consumeAiLimit).not.toHaveBeenCalled();
    expect(ports.reserve).toHaveBeenCalledOnce();
    expect(ports.searchText).toHaveBeenCalledOnce();
    expect(result.measure).toMatchObject({ queryFromCache: true, shoppingFromCache: false, calls: 1, inputTokens: null });
  });

  it("deux lancements simultanés avec la même requête : un seul appel aux boutiques", async () => {
    const cache = fakeCache();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const searchText = vi.fn(async (): Promise<TextSearchResponse> => {
      await gate;
      return SHOPPING;
    });
    const first = setup({ cache, ports: { searchText } });
    const second = setup({ cache, ports: { searchText } });
    const both = Promise.all([runComplement(first.ports, first.input()), runComplement(second.ports, second.input())]);
    await vi.waitFor(() => expect(searchText).toHaveBeenCalled());
    release();
    const [a, b] = await both;
    expect(searchText).toHaveBeenCalledOnce();
    expect([a.reply.status, b.reply.status]).toEqual(["shown", "shown"]);
    expect([a.columns.shopping_calls + b.columns.shopping_calls]).toEqual([1]);
    expect(vi.mocked(second.ports.reserve).mock.calls.length + vi.mocked(first.ports.reserve).mock.calls.length).toBe(1);
  });

  it("panne des boutiques chez celui qui appelait, deux lancements en attente : UN seul nouvel appel (l'un relance, l'autre l'attend)", async () => {
    const cache = fakeCache();
    let fail!: (error: unknown) => void;
    let answer!: (response: TextSearchResponse) => void;
    const searchText = vi
      .fn<ComplementPorts["searchText"]>()
      .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
      .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const launches = [setup({ cache, ports: { searchText } }), setup({ cache, ports: { searchText } }), setup({ cache, ports: { searchText } })];
    const all = Promise.all(launches.map((launch) => runComplement(launch.ports, launch.input())));
    try {
      await vi.waitFor(() => expect(searchText).toHaveBeenCalledOnce());
      fail(new ProviderFailure("timeout", null, "SerpApi injoignable (timeout)"));
      await vi.waitFor(() => expect(searchText).toHaveBeenCalledTimes(2));
    } finally {
      // Toujours réglés : un appel resté en cours bloquerait les cas suivants (même requête).
      fail?.(new ProviderFailure("timeout", null, "SerpApi injoignable (timeout)"));
      answer?.(SHOPPING);
    }
    const results = await all;
    expect(searchText).toHaveBeenCalledTimes(2);
    expect(results.map((result) => result.columns.complement_status)).toEqual(["shopping_failed", "shown", "shown"]);
    expect(results.map((result) => result.columns.shopping_calls)).toEqual([1, 1, 0]);
    expect(results[2]!.measure).toMatchObject({ shoppingFromCache: true, calls: 0 });
    expect(launches.reduce((sum, launch) => sum + vi.mocked(launch.ports.reserve).mock.calls.length, 0)).toBe(2);
  });

  it("attente de l'appel d'un autre lancement bornée par son propre budget (T0 + 14 s − 1,5 s) : au-delà, « no_time », sans réservation ni appel", async () => {
    const cache = fakeCache();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const searchText = vi.fn(async (): Promise<TextSearchResponse> => {
      await gate;
      return SHOPPING;
    });
    const leader = setup({ cache, ports: { searchText } });
    const leading = runComplement(leader.ports, leader.input());
    await vi.waitFor(() => expect(searchText).toHaveBeenCalledOnce());

    // Lens lent pour ce lancement : il ne reste que 4 s (requête lue dans le cache, écrite par le premier).
    const waits: number[] = [];
    const waiter = setup({
      cache,
      clock: fakeClock(10_000),
      ports: {
        timeoutSignal: (ms: number) => {
          waits.push(ms);
          return ms === 2_500 ? AbortSignal.abort() : new AbortController().signal;
        },
      },
    });
    try {
      const late = await runComplement(waiter.ports, waiter.input());
      expect(waits).toEqual([800, 2_500]);
      expect(late.columns).toEqual({ complement_status: "no_time", shopping_calls: 0, text_suggested: false });
      expect(late.measure).toMatchObject({ queryFromCache: true, calls: 0 });
      expect(waiter.ports.reserve).not.toHaveBeenCalled();
      expect(waiter.ports.searchText).not.toHaveBeenCalled();
    } finally {
      // L'appel attendu, lui, continue (et finit toujours : il bloquerait les cas suivants).
      release();
    }
    expect((await leading).columns).toEqual({ complement_status: "shown", shopping_calls: 1, text_suggested: false });
    expect(searchText).toHaveBeenCalledOnce();
  });

  it("relance entre la fin de l'appel aux boutiques et l'écriture du cache (base lente) : ni réservation ni appel de plus", async () => {
    const cache = fakeCache();
    let commit!: () => void;
    const committed = new Promise<void>((resolve) => (commit = resolve));
    const slowWrite = async (key: string, step: CacheStep, payload: unknown) => {
      if (step === "shopping") await committed;
      cache.writeCache(key, step, payload);
    };
    const searchText = vi.fn(async (): Promise<TextSearchResponse> => SHOPPING);
    const reserve = vi.fn(async () => ({ allowed: true as const, reservationId: 42 }));
    const first = setup({ cache, ports: { writeCache: slowWrite, searchText, reserve } });
    const second = setup({ cache, ports: { writeCache: slowWrite, searchText, reserve } });
    try {
      const a = await runComplement(first.ports, first.input());
      expect([...cache.entries.values()].some((entry) => entry.step === "shopping")).toBe(false);
      const b = await runComplement(second.ports, second.input());
      expect(a.measure).toMatchObject({ calls: 1, shoppingFromCache: false });
      expect(b.measure).toMatchObject({ calls: 0, shoppingFromCache: true, queryFromCache: true });
      expect(b.columns).toEqual({ complement_status: "shown", shopping_calls: 0, text_suggested: false });
      expect(b.matches).toEqual(a.matches);
      expect(searchText).toHaveBeenCalledOnce();
      expect(reserve).toHaveBeenCalledOnce();
    } finally {
      commit();
    }
    // Écriture faite : l'entrée est retirée, la réponse est dans le cache.
    await vi.waitFor(() => expect(singleFlightPending()).toBe(0));
    expect([...cache.entries.values()].some((entry) => entry.step === "shopping")).toBe(true);
  });

  /** L'IA formulerait autrement à un second appel : une autre requête, donc une seconde recherche payée. */
  const REWORDED: ShoppingQueryAnswer = { ...QUERY_ANSWER, value: { ...(QUERY_ANSWER.kind === "query" ? QUERY_ANSWER.value : { query: "", brand: "", model: "" }), query: "veste Exemplor Nuage 07 bleue" } };

  it("deux lancements des mêmes titres pendant l'appel de l'IA : UNE réponse partagée, donc une seule recherche dans les boutiques", async () => {
    const cache = fakeCache();
    let answer!: () => void;
    const gate = new Promise<void>((resolve) => (answer = resolve));
    const askQuery = vi
      .fn<ComplementPorts["askQuery"]>()
      .mockImplementationOnce(async () => {
        await gate;
        return QUERY_ANSWER;
      })
      .mockResolvedValue(REWORDED);
    const searchText = vi.fn(async (): Promise<TextSearchResponse> => SHOPPING);
    const reserve = vi.fn(async () => ({ allowed: true as const, reservationId: 42 }));
    const first = setup({ cache, ports: { askQuery, searchText, reserve } });
    const second = setup({ cache, ports: { askQuery, searchText, reserve } });
    let results: Awaited<ReturnType<typeof runComplement>>[];
    try {
      const running = runComplement(first.ports, first.input());
      await vi.waitFor(() => expect(askQuery).toHaveBeenCalledOnce());
      const joining = runComplement(second.ports, second.input());
      answer();
      results = await Promise.all([running, joining]);
    } finally {
      // Toujours réglé : un appel resté en cours bloquerait les cas suivants (mêmes titres).
      answer();
    }
    expect(askQuery).toHaveBeenCalledOnce();
    expect(second.ports.consumeAiLimit).not.toHaveBeenCalled();
    expect(searchText).toHaveBeenCalledOnce();
    expect(reserve).toHaveBeenCalledOnce();
    expect(results.map((result) => result.reply.query)).toEqual([QUERY, QUERY]);
    expect(results[1]!.measure).toMatchObject({ queryFromCache: true, calls: 0 });
    await vi.waitFor(() => expect(singleFlightPending()).toBe(0));
  });

  it("relance entre la réponse de l'IA et l'écriture du cache (base lente) : la même requête, sans second appel à l'IA ni seconde recherche", async () => {
    const cache = fakeCache();
    let commit!: () => void;
    const committed = new Promise<void>((resolve) => (commit = resolve));
    const slowWrite = async (key: string, step: CacheStep, payload: unknown) => {
      if (step === "query") await committed;
      cache.writeCache(key, step, payload);
    };
    const askQuery = vi.fn<ComplementPorts["askQuery"]>().mockResolvedValueOnce(QUERY_ANSWER).mockResolvedValue(REWORDED);
    const searchText = vi.fn(async (): Promise<TextSearchResponse> => SHOPPING);
    const reserve = vi.fn(async () => ({ allowed: true as const, reservationId: 42 }));
    const first = setup({ cache, ports: { writeCache: slowWrite, askQuery, searchText, reserve } });
    const second = setup({ cache, ports: { writeCache: slowWrite, askQuery, searchText, reserve } });
    try {
      const a = await runComplement(first.ports, first.input());
      expect([...cache.entries.values()].some((entry) => entry.step === "query")).toBe(false);
      const b = await runComplement(second.ports, second.input());
      expect(askQuery).toHaveBeenCalledOnce();
      expect(b.measure).toMatchObject({ queryFromCache: true, calls: 0 });
      expect(b.reply.query).toBe(a.reply.query);
      expect(searchText).toHaveBeenCalledOnce();
      expect(reserve).toHaveBeenCalledOnce();
    } finally {
      commit();
    }
    await vi.waitFor(() => expect(singleFlightPending()).toBe(0));
    expect([...cache.entries.values()].some((entry) => entry.step === "query")).toBe(true);
  });
});

describe("runComplement — sorties sans complément (résultats Lens seuls)", () => {
  it("panne technique de Lens : aucun complément, rien n'est appelé", async () => {
    const { ports, input } = setup();
    const result = await runComplement(ports, input({ lens: [], lensFailed: true }));
    expect(result.columns).toEqual({ complement_status: null, shopping_calls: 0, text_suggested: false });
    expect(result.reply).toEqual({ status: null, suggestText: false, textStatus: null });
    expect(ports.askQuery).not.toHaveBeenCalled();
    expect(ports.searchText).not.toHaveBeenCalled();
  });

  it("IA coupée : « skipped », rien n'est appelé", async () => {
    const { ports, input } = setup();
    const result = await runComplement(ports, input({ aiEnabled: false }));
    expect(result.columns).toEqual({ complement_status: "skipped", shopping_calls: 0, text_suggested: false });
    expect(ports.askQuery).not.toHaveBeenCalled();
    expect(ports.capacityLeft).not.toHaveBeenCalled();
    expect(ports.searchText).not.toHaveBeenCalled();
  });

  it("Lens n'a rien gardé : l'IA n'est pas appelée, « no_query » et « Que cherchez-vous ? » proposé (même IA coupée)", async () => {
    for (const aiEnabled of [true, false]) {
      const { ports, input } = setup();
      const result = await runComplement(ports, input({ lens: [], aiEnabled }));
      expect(result.columns).toEqual({ complement_status: "no_query", shopping_calls: 0, text_suggested: true });
      expect(result.reply).toEqual({ status: "no_query", suggestText: true, textStatus: null });
      expect(ports.askQuery).not.toHaveBeenCalled();
      expect(ports.searchText).not.toHaveBeenCalled();
    }
  });

  it("Lens lent (moins de 5 s restantes) : ni IA ni boutiques, « no_time »", async () => {
    const { ports, input } = setup({ clock: fakeClock(9_500) });
    const result = await runComplement(ports, input());
    expect(result.columns).toEqual({ complement_status: "no_time", shopping_calls: 0, text_suggested: false });
    expect(ports.askQuery).not.toHaveBeenCalled();
    expect(ports.capacityLeft).not.toHaveBeenCalled();
    expect(ports.consumeAiLimit).not.toHaveBeenCalled();
    expect(ports.searchText).not.toHaveBeenCalled();
  });

  it("IA lente : plus le temps pour les boutiques, « no_time », aucune réservation", async () => {
    const clock = fakeClock(7_500);
    const { ports, input, timeouts } = setup({
      clock,
      ports: {
        askQuery: vi.fn(async (): Promise<ShoppingQueryAnswer> => {
          clock.advance(2_600);
          return QUERY_ANSWER;
        }),
      },
    });
    const result = await runComplement(ports, input());
    // IA : min(3 s, 6,5 − 4) = 2,5 s.
    expect(timeouts).toContain(2_500);
    expect(result.columns).toEqual({ complement_status: "no_time", shopping_calls: 0, text_suggested: false });
    expect(ports.reserve).not.toHaveBeenCalled();
    expect(ports.searchText).not.toHaveBeenCalled();
    expect(result.measure.aiMs).toBe(2_600);
  });

  it("plafond atteint ou limite de l'IA atteinte : « no_capacity », jamais d'erreur ni de 429", async () => {
    for (const refusal of [{ capacityLeft: vi.fn(async () => false) }, { capacityLeft: vi.fn(async () => Promise.reject(new Error("base injoignable"))) }, { consumeAiLimit: vi.fn(() => false) }]) {
      const { ports, input } = setup({ ports: refusal });
      const result = await runComplement(ports, input());
      expect(result.columns).toEqual({ complement_status: "no_capacity", shopping_calls: 0, text_suggested: false });
      expect(ports.askQuery).not.toHaveBeenCalled();
      expect(ports.searchText).not.toHaveBeenCalled();
    }
    // Plafond lu d'abord : la limite de l'IA n'est pas consommée s'il est atteint.
    const { ports, input } = setup({ ports: { capacityLeft: vi.fn(async () => false) } });
    await runComplement(ports, input());
    expect(ports.consumeAiLimit).not.toHaveBeenCalled();
  });

  it("panne, délai dépassé ou refus de l'IA : « ai_failed », aucune réservation des boutiques", async () => {
    const errors = [
      new FakeShoppingQueryError("unavailable", 529),
      new FakeShoppingQueryError("refused"),
      new FakeShoppingQueryError("invalid_output"),
      Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
    ];
    for (const error of errors) {
      const { ports, input } = setup({ ports: { askQuery: vi.fn(async (): Promise<ShoppingQueryAnswer> => Promise.reject(error)) } });
      const result = await runComplement(ports, input());
      expect(result.columns).toEqual({ complement_status: "ai_failed", shopping_calls: 0, text_suggested: false });
      expect(result.measure.aiErrorKind).toBe(error instanceof FakeShoppingQueryError ? error.kind : "unavailable");
      expect(ports.reserve).not.toHaveBeenCalled();
      expect(ports.searchText).not.toHaveBeenCalled();
    }
  });

  it("requête vide ou inventée : « no_query » et « Que cherchez-vous ? » proposé ; l'absence de requête est gardée en cache", async () => {
    for (const reason of ["empty", "invented", "brand_not_shared"] as const) {
      const cache = fakeCache();
      const answer: ShoppingQueryAnswer = { kind: "no_query", reason, usage: { inputTokens: 800, outputTokens: 10 } };
      const { ports, input } = setup({ cache, ports: { askQuery: vi.fn(async () => answer) } });
      const result = await runComplement(ports, input());
      expect(result.columns).toEqual({ complement_status: "no_query", shopping_calls: 0, text_suggested: true });
      expect(result.measure).toMatchObject({ noQueryReason: reason, inputTokens: 800 });
      expect(ports.searchText).not.toHaveBeenCalled();
      const again = setup({ cache });
      expect((await runComplement(again.ports, again.input())).columns.complement_status).toBe("no_query");
      expect(again.ports.askQuery).not.toHaveBeenCalled();
    }
  });

  it("requête faite seulement d'opérateurs (défense en plus des contrôles de l'IA) : « no_query », aucune recherche", async () => {
    const answer: ShoppingQueryAnswer = { kind: "query", value: { query: 'site:exemple.fr -contrefaçon "" OR', brand: BRAND, model: MODEL }, usage: { inputTokens: 1, outputTokens: 1 } };
    const { ports, input } = setup({ ports: { askQuery: vi.fn(async () => answer) } });
    const result = await runComplement(ports, input());
    expect(result.columns.complement_status).toBe("no_query");
    expect(result.measure.noQueryReason).toBe("operators");
    expect(ports.searchText).not.toHaveBeenCalled();
  });

  it("réservation des boutiques refusée (ou plafond illisible) : « no_capacity », aucun appel", async () => {
    for (const reserve of [vi.fn(async () => ({ allowed: false as const, limit: "day" as const, resumesOn: null })), vi.fn(async () => Promise.reject(new Error("illisible")))]) {
      const { ports, input } = setup({ ports: { reserve } });
      const result = await runComplement(ports, input());
      expect(result.columns).toEqual({ complement_status: "no_capacity", shopping_calls: 0, text_suggested: false });
      expect(ports.searchText).not.toHaveBeenCalled();
    }
  });

  it("budget de la photo épuisé (3 recherches) : aucune réservation, aucun appel", async () => {
    const { ports, input } = setup();
    const result = await runComplement(ports, input({ shoppingCalls: 2 }));
    expect(result.columns).toEqual({ complement_status: "no_capacity", shopping_calls: 2, text_suggested: false });
    expect(ports.reserve).not.toHaveBeenCalled();
    expect(ports.searchText).not.toHaveBeenCalled();
  });

  it("refus des boutiques (non facturé) : place rendue une fois, appel non compté dans le budget de la photo ; délai dépassé : « shopping_failed », place gardée", async () => {
    const refused = setup({ ports: { searchText: vi.fn(async (): Promise<TextSearchResponse> => Promise.reject(new ProviderFailure("refused", 429, "SerpApi a répondu 429"))) } });
    const a = await runComplement(refused.ports, refused.input());
    expect(a.columns).toEqual({ complement_status: "shopping_failed", shopping_calls: 0, text_suggested: false });
    expect(refused.ports.release).toHaveBeenCalledOnce();
    expect(refused.ports.release).toHaveBeenCalledWith(42);
    // La mesure garde l'appel envoyé ; Lens venu du cache : aucune recherche comptée, servie par le cache.
    expect(a.measure).toMatchObject({ shoppingFailureKind: "refused", calls: 1 });
    expect(launchColumns(true, a, 0)).toMatchObject({ shopping_calls: 0, lens_from_cache: true, served_from_cache: true });
    expect(launchColumns(false, a, 0).served_from_cache).toBe(false);

    // Place non rendue (base injoignable) : l'appel reste compté, comme 0027 le demande.
    const notReleased = setup({
      ports: {
        searchText: vi.fn(async (): Promise<TextSearchResponse> => Promise.reject(new ProviderFailure("refused", 503, "SerpApi a répondu 503"))),
        release: vi.fn(async () => false),
      },
    });
    const kept = await runComplement(notReleased.ports, notReleased.input());
    expect(kept.columns.shopping_calls).toBe(1);
    expect(launchColumns(true, kept, 0).served_from_cache).toBe(false);

    const slow = setup({ ports: { searchText: vi.fn(async (): Promise<TextSearchResponse> => Promise.reject(new ProviderFailure("timeout", null, "SerpApi injoignable (timeout)"))) } });
    const b = await runComplement(slow.ports, slow.input());
    expect(b.columns).toEqual({ complement_status: "shopping_failed", shopping_calls: 1, text_suggested: false });
    expect(slow.ports.release).not.toHaveBeenCalled();
    // Pannes jamais mises en cache : le lancement suivant rappelle les boutiques.
    expect([...slow.cache.entries.values()].some((entry) => entry.step === "shopping")).toBe(false);
  });

  it("« Annuler » (connexion coupée) : ni IA, ni boutiques ; coupée après l'IA : pas de boutiques", async () => {
    const { ports, input } = setup({ ports: { socketDestroyed: vi.fn(() => true) } });
    const result = await runComplement(ports, input());
    expect(result.columns).toEqual({ complement_status: null, shopping_calls: 0, text_suggested: false });
    expect(ports.askQuery).not.toHaveBeenCalled();
    expect(ports.searchText).not.toHaveBeenCalled();

    let destroyed = false;
    const later = setup({
      ports: {
        socketDestroyed: vi.fn(() => destroyed),
        askQuery: vi.fn(async (): Promise<ShoppingQueryAnswer> => {
          destroyed = true;
          return QUERY_ANSWER;
        }),
      },
    });
    const after = await runComplement(later.ports, later.input());
    expect(after.columns.complement_status).toBeNull();
    expect(later.ports.askQuery).toHaveBeenCalledOnce();
    expect(later.ports.reserve).not.toHaveBeenCalled();
    expect(later.ports.searchText).not.toHaveBeenCalled();
  });

  it("exception dans un port : « error » (distincte de « skipped »), rien n'est levé, journal sans contenu", async () => {
    const throwing = [
      { sortShopping: (() => {
        throw new TypeError(`plantage ${QUERY}`);
      }) as LightSortPort },
      { askQuery: vi.fn(async (): Promise<ShoppingQueryAnswer> => Promise.reject(new TypeError("bogue"))) },
      { aiInputKey: vi.fn(() => {
        throw new RangeError("bogue");
      }) },
    ];
    for (const broken of throwing) {
      const { ports, input, logs } = setup({ ports: broken });
      const result = await runComplement(ports, input());
      expect(result.columns.complement_status).toBe("error");
      expect(result.reply).toEqual({ status: "error", suggestText: false, textStatus: null });
      expect(result.matches).toEqual([]);
      expect(logs.error).toHaveBeenCalledOnce();
      expect(JSON.stringify(logs.error.mock.calls)).not.toContain("Exemplor");
    }
    // Exception après l'appel aux boutiques : l'appel reste compté.
    const late = setup({ ports: { searchText: vi.fn(async (): Promise<TextSearchResponse> => Promise.reject(new TypeError("bogue"))) } });
    const result = await runComplement(late.ports, late.input());
    expect(result.columns).toEqual({ complement_status: "error", shopping_calls: 1, text_suggested: false });
  });

  it("colonnes du lancement : servie par le cache seulement sans aucun appel réel ; durée en secondes, bornée", async () => {
    const cache = fakeCache();
    const first = await runComplement(setup({ cache }).ports, setup({ cache }).input());
    expect(launchColumns(false, first, 9_400)).toEqual({ complement_status: "shown", shopping_calls: 1, text_suggested: false, lens_from_cache: false, served_from_cache: false, total_seconds: 9 });
    expect(launchColumns(true, first, 9_600)).toMatchObject({ lens_from_cache: true, served_from_cache: false, total_seconds: 10 });
    const again = await runComplement(setup({ cache }).ports, setup({ cache }).input({ lensCalled: false }));
    expect(launchColumns(true, again, 1_200)).toMatchObject({ shopping_calls: 0, lens_from_cache: true, served_from_cache: true, total_seconds: 1 });
    expect(launchColumns(true, again, 900_000).total_seconds).toBe(600);
  });

  it("enregistrement des lignes des boutiques impossible : « shopping_failed », les résultats Lens restent", async () => {
    const { ports, input } = setup();
    const failed = complementAfterSaveFailure(await runComplement(ports, input()));
    expect(failed.matches).toEqual([]);
    expect(failed.columns).toEqual({ complement_status: "shopping_failed", shopping_calls: 1, text_suggested: false });
    expect(failed.reply).toEqual({ status: "shopping_failed", suggestText: false, textStatus: null });
  });
});

describe("lensStep — un seul appel pour la même image", () => {
  const ANSWER: LensAnswer = {
    matches: LENS,
    measure: { removedIncomplete: 0, removedSocial: 0, removedProfessional: 0, removedDuplicates: 0, received: 3, kept: 3, keptWithPrice: 3, keptOtherCurrency: 0, distinctSites: 3, sections: ["visual_matches"], googleState: null },
    addedRanks: [],
  };
  const lensPorts = (cache: Cache) => ({ readCache: cache.readCache, writeCache: cache.writeCache, cacheKey: cache.cacheKey });

  it("deux lancements simultanés de la même image : 1 appel à Lens ; un troisième, plus tard : 0 appel, réponse du cache", async () => {
    const cache = fakeCache();
    let finish!: (value: { kind: "answered"; answer: LensAnswer }) => void;
    const call = vi.fn(() => new Promise<{ kind: "answered"; answer: LensAnswer }>((resolve) => (finish = resolve)));
    const step = () => lensStep(lensPorts(cache), { imageHash: "a".repeat(64), locale: FR, call, answerOf: (result) => result.answer });
    const first = step();
    const second = step();
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    finish({ kind: "answered", answer: ANSWER });
    const [a, b] = await Promise.all([first, second]);
    expect(call).toHaveBeenCalledOnce();
    expect(a.lensFromCache).toBe(false);
    expect(b).toEqual({ lensFromCache: true, answer: ANSWER });

    const third = await step();
    expect(call).toHaveBeenCalledOnce();
    expect(third).toEqual({ lensFromCache: true, answer: ANSWER });
  });

  it("panne de Lens (ou arrêt avant l'appel) : jamais gardée ni partagée ; celui qui attendait fait son propre appel", async () => {
    const cache = fakeCache();
    let finish!: (value: { kind: "failed" }) => void;
    const call = vi
      .fn<() => Promise<{ kind: "failed" } | { kind: "answered"; answer: LensAnswer }>>()
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockImplementationOnce(async () => ({ kind: "answered", answer: ANSWER }));
    const answerOf = (result: { kind: "failed" } | { kind: "answered"; answer: LensAnswer }) => (result.kind === "answered" ? result.answer : null);
    const step = () => lensStep(lensPorts(cache), { imageHash: "b".repeat(64), locale: FR, call, answerOf });
    const first = step();
    const second = step();
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    finish({ kind: "failed" });
    const [a, b] = await Promise.all([first, second]);
    expect(call).toHaveBeenCalledTimes(2);
    expect(a).toEqual({ lensFromCache: false, result: { kind: "failed" }, answer: null });
    expect(b).toEqual({ lensFromCache: false, result: { kind: "answered", answer: ANSWER }, answer: ANSWER });
  });

  type Called = { kind: "failed" } | { kind: "answered"; answer: LensAnswer };
  const answerOfCall = (result: Called) => (result.kind === "answered" ? result.answer : null);

  /** Premier appel en panne, second en attente de `answer` : chacun réglé par le test. */
  function failThenAnswer() {
    let fail!: (value: Called) => void;
    let answer!: (value: Called) => void;
    const call = vi
      .fn<() => Promise<Called>>()
      .mockImplementationOnce(() => new Promise((resolve) => (fail = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    return { call, fail: () => fail({ kind: "failed" }), answer: () => answer({ kind: "answered", answer: ANSWER }) };
  }

  it("panne de celui qui appelait, deux lancements en attente : UN seul nouvel appel (l'un relance, l'autre l'attend), pas un chacun", async () => {
    const cache = fakeCache();
    const { call, fail, answer } = failThenAnswer();
    const step = () => lensStep(lensPorts(cache), { imageHash: "e".repeat(64), locale: FR, call, answerOf: answerOfCall });
    const all = Promise.all([step(), step(), step()]);
    await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
    fail();
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    answer();
    const [a, b, c] = await all;
    expect(call).toHaveBeenCalledTimes(2);
    expect(a).toEqual({ lensFromCache: false, result: { kind: "failed" }, answer: null });
    expect(b).toEqual({ lensFromCache: false, result: { kind: "answered", answer: ANSWER }, answer: ANSWER });
    expect(c).toEqual({ lensFromCache: true, answer: ANSWER });
  });

  it("un lancement arrivé pendant cette reprise l'attend aussi : 2 appels en tout, jamais 3", async () => {
    const cache = fakeCache();
    const { call, fail, answer } = failThenAnswer();
    const step = () => lensStep(lensPorts(cache), { imageHash: "f".repeat(64), locale: FR, call, answerOf: answerOfCall });
    const first = step();
    const second = step();
    await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
    fail();
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    const third = step();
    answer();
    const [, b, c] = await Promise.all([first, second, third]);
    expect(call).toHaveBeenCalledTimes(2);
    expect(b.lensFromCache).toBe(false);
    expect(c).toEqual({ lensFromCache: true, answer: ANSWER });
  });

  it("relance entre la fin de l'appel et l'écriture du cache (base lente) : la réponse de l'appel, sans second appel", async () => {
    const cache = fakeCache();
    let commit!: () => void;
    const committed = new Promise<void>((resolve) => (commit = resolve));
    const ports = {
      ...lensPorts(cache),
      writeCache: async (key: string, step: CacheStep, payload: unknown) => {
        await committed;
        cache.writeCache(key, step, payload);
      },
    };
    const call = vi.fn(async () => ({ kind: "answered" as const, answer: ANSWER }));
    const step = () => lensStep(ports, { imageHash: "9".repeat(64), locale: FR, call, answerOf: (result) => result.answer });
    try {
      expect((await step()).lensFromCache).toBe(false);
      expect(cache.entries.size).toBe(0);
      expect(await step()).toEqual({ lensFromCache: true, answer: ANSWER });
      expect(call).toHaveBeenCalledOnce();
    } finally {
      commit();
    }
    await vi.waitFor(() => expect(singleFlightPending()).toBe(0));
    expect(cache.entries.size).toBe(1);
    expect((await step()).lensFromCache).toBe(true);
    expect(call).toHaveBeenCalledOnce();
  });

  it("écriture du cache qui ne finit pas : l'entrée n'est gardée que 10 s, jamais une panne", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const cache = fakeCache();
      let writes = 0;
      const ports = {
        ...lensPorts(cache),
        // La première écriture ne finit jamais (base bloquée) ; les suivantes, tout de suite.
        writeCache: (key: string, step: CacheStep, payload: unknown) => (++writes === 1 ? new Promise<void>(() => undefined) : cache.writeCache(key, step, payload)),
      };
      let fails = false;
      const call = vi.fn(async () => (fails ? { kind: "failed" as const } : { kind: "answered" as const, answer: ANSWER }));
      const answerOf = (result: { kind: "failed" } | { kind: "answered"; answer: LensAnswer }) => (result.kind === "answered" ? result.answer : null);
      const step = () => lensStep(ports, { imageHash: "8".repeat(64), locale: FR, call, answerOf });
      await step();
      expect(singleFlightPending()).toBe(1);
      expect((await step()).lensFromCache).toBe(true);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(singleFlightPending()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(singleFlightPending()).toBe(0);
      // Rien n'a été écrit : la relance suivante appelle Lens.
      expect(cache.entries.size).toBe(0);
      expect((await step()).lensFromCache).toBe(false);
      expect(call).toHaveBeenCalledTimes(2);
      await vi.waitFor(() => expect(singleFlightPending()).toBe(0));
      // Une panne n'est jamais gardée.
      fails = true;
      cache.entries.clear();
      await step();
      expect(singleFlightPending()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clé : même image et même pays ; une autre image ou un autre pays ne ressert rien", async () => {
    const cache = fakeCache();
    const call = vi.fn(async () => ({ kind: "answered" as const, answer: ANSWER }));
    const run = (imageHash: string, locale: { country: string; hl: string }) => lensStep(lensPorts(cache), { imageHash, locale, call, answerOf: (result) => result.answer });
    await run("c".repeat(64), FR);
    await run("d".repeat(64), FR);
    await run("c".repeat(64), { country: "gb", hl: "en" });
    expect(call).toHaveBeenCalledTimes(3);
    expect((await run("c".repeat(64), FR)).lensFromCache).toBe(true);
    expect(call).toHaveBeenCalledTimes(3);
  });
});

describe("runTextComplement — « Que cherchez-vous ? »", () => {
  function textSetup(ports: Partial<TextComplementPorts> = {}, start = 0) {
    const clock = fakeClock(start);
    const logs = fakeLog();
    const all = {
      searchText: vi.fn(async (): Promise<TextSearchResponse> => SHOPPING),
      release: vi.fn(async () => true),
      now: clock.now,
      log: logs.log,
      ...ports,
    } satisfies TextComplementPorts;
    return { ports: all, logs, deadline: startDeadline(0, VOIE_C_BUDGET.totalMs, clock.now) };
  }

  it("Lens sans résultat : les boutiques SONT appelées ; tri par vos mots ; pages déjà proposées retirées", async () => {
    const { ports, deadline } = textSetup();
    const result = await runTextComplement(ports, { words: "nuage", existing: [], locale: FR, deadline, reservationId: 7 });
    expect(ports.searchText).toHaveBeenCalledOnce();
    expect(ports.searchText).toHaveBeenCalledWith("nuage", FR, expect.any(AbortSignal));
    expect(result.textStatus).toBe("shown");
    expect(result.calls).toBe(1);
    expect(result.matches.map((match) => match.productName)).toEqual(["Exemplor veste Nuage 07", "Exemplor Nuage 07", "Veste bleue sans marque"]);

    const withLens = await runTextComplement(textSetup().ports, { words: "veste nuage", existing: LENS, locale: FR, deadline, reservationId: 7 });
    expect(withLens.matches.map((match) => match.merchantUrl)).not.toContain("https://www.lens-exemple.fr/a");
  });

  it("rien de gardé : « empty » ; refus non facturé : place rendue une fois ; délai dépassé : place gardée", async () => {
    const empty = textSetup({ searchText: vi.fn(async (): Promise<TextSearchResponse> => ({ items: [], received: 0, statusCode: 200 })) });
    expect((await runTextComplement(empty.ports, { words: "veste", existing: [], locale: FR, deadline: empty.deadline, reservationId: 7 })).textStatus).toBe("empty");

    const refused = textSetup({ searchText: vi.fn(async (): Promise<TextSearchResponse> => Promise.reject(new ProviderFailure("refused", 503, "SerpApi a répondu 503"))) });
    const a = await runTextComplement(refused.ports, { words: "veste", existing: [], locale: FR, deadline: refused.deadline, reservationId: 7 });
    // Place rendue : rien à ajouter à shopping_calls ; la mesure garde l'appel envoyé.
    expect(a).toMatchObject({ textStatus: "shopping_failed", calls: 0, matches: [] });
    expect(a.measure.calls).toBe(1);
    expect(refused.ports.release).toHaveBeenCalledOnce();
    expect(refused.ports.release).toHaveBeenCalledWith(7);

    // Place non rendue : l'appel reste compté.
    const notReleased = textSetup({
      searchText: vi.fn(async (): Promise<TextSearchResponse> => Promise.reject(new ProviderFailure("refused", 429, "SerpApi a répondu 429"))),
      release: vi.fn(async () => false),
    });
    expect(await runTextComplement(notReleased.ports, { words: "veste", existing: [], locale: FR, deadline: notReleased.deadline, reservationId: 7 })).toMatchObject({
      textStatus: "shopping_failed",
      calls: 1,
    });

    const slow = textSetup({ searchText: vi.fn(async (): Promise<TextSearchResponse> => Promise.reject(new ProviderFailure("timeout", null, "SerpApi injoignable (timeout)"))) });
    expect((await runTextComplement(slow.ports, { words: "veste", existing: [], locale: FR, deadline: slow.deadline, reservationId: 7 })).textStatus).toBe("shopping_failed");
    expect(slow.ports.release).not.toHaveBeenCalled();
  });

  it("plus de temps du tout : aucun appel, place rendue ; exception : « shopping_failed », rien n'est levé", async () => {
    const late = textSetup({}, 12_600);
    const result = await runTextComplement(late.ports, { words: "veste", existing: [], locale: FR, deadline: late.deadline, reservationId: 7 });
    expect(result).toMatchObject({ textStatus: "shopping_failed", calls: 0 });
    expect(late.ports.searchText).not.toHaveBeenCalled();
    expect(late.ports.release).toHaveBeenCalledWith(7);

    const broken = textSetup({ searchText: vi.fn(async (): Promise<TextSearchResponse> => Promise.reject(new TypeError("bogue"))) });
    expect((await runTextComplement(broken.ports, { words: "veste", existing: [], locale: FR, deadline: broken.deadline, reservationId: 7 })).textStatus).toBe("shopping_failed");
    expect(broken.logs.error).toHaveBeenCalledOnce();
  });

  it("délai : min(10 s, T0 + 14 s − maintenant − 1,5 s)", async () => {
    const timeouts: number[] = [];
    const timeoutSignal = (ms: number) => {
      timeouts.push(ms);
      return new AbortController().signal;
    };
    const early = textSetup({ timeoutSignal }, 500);
    await runTextComplement(early.ports, { words: "veste", existing: [], locale: FR, deadline: early.deadline, reservationId: 7 });
    const later = textSetup({ timeoutSignal }, 6_000);
    await runTextComplement(later.ports, { words: "veste", existing: [], locale: FR, deadline: later.deadline, reservationId: 7 });
    expect(timeouts).toEqual([10_000, 6_500]);
  });
});

describe("sanitizeShoppingQuery", () => {
  it("retire site:, -mot, les guillemets et OR ; garde les lettres, chiffres et ' - . & +", () => {
    expect(sanitizeShoppingQuery('Exemplor "veste Nuage" site:ex.fr -faux OR 07')).toBe("Exemplor veste Nuage 07");
    // Coupée d'abord à 60 caractères (sanitizeQuery), comme les mots tapés.
    expect(sanitizeShoppingQuery(`${"a".repeat(59)} 07`)).toBe("a".repeat(59));
    expect(sanitizeShoppingQuery("A.P.C. t-shirt L’Atelier Marque&Co +plus")).toBe("A.P.C. t-shirt L'Atelier Marque&Co +plus");
    expect(sanitizeShoppingQuery("intitle:veste (veste* | blouson) AND cuir")).toBe("veste blouson cuir");
    // « or » en minuscules est un mot (la matière), pas l'opérateur.
    expect(sanitizeShoppingQuery("bague or jaune")).toBe("bague or jaune");
    expect(sanitizeShoppingQuery("<script>veste</script>\u0000 -- ' ")).toBe("script veste script");
    expect(sanitizeShoppingQuery("site:exemple.fr -x")).toBe("");
    expect(sanitizeShoppingQuery("é".repeat(80)).length).toBeLessThanOrEqual(60);
  });

  it("retire aussi « -mot » caché derrière ' . & + (« '-cuir »…), tout tiret hors d'un mot composé, et « 10..20 »", () => {
    expect(sanitizeShoppingQuery("veste '-cuir .-cuir &-cuir +-cuir ''-cuir")).toBe("veste");
    expect(sanitizeShoppingQuery("veste cuir'-daim cuir- 10..20 ..")).toBe("veste");
    // Les mots composés restent : le tiret y est entre deux lettres ou chiffres.
    expect(sanitizeShoppingQuery("t-shirt Exemplor X-200 é-è")).toBe("t-shirt Exemplor X-200 é-è");
  });
});

describe("requête de l'IA : mêmes bornes que le cache et sanitizeShoppingQuery", () => {
  it("une requête acceptée par les contrôles tient toujours dans le cache des requêtes et n'est jamais coupée ; 62 unités (lettres « mathématiques ») : refusée", async () => {
    const { checkShoppingQuery } = await import("../src/services/shoppingQueryAi.js");
    const bold = (text: string) =>
      Array.from(text, (char) => (/[a-z]/.test(char) ? String.fromCodePoint(0x1d41a + char.charCodeAt(0) - 97) : /[A-Z]/.test(char) ? String.fromCodePoint(0x1d400 + char.charCodeAt(0) - 65) : char)).join("");
    const boldTitles = [bold("Marque Exemple basket blanc cuir"), bold("Basket Marque Exemple cuir blanc")];
    const accepted = [
      checkShoppingQuery({ query: QUERY, brand: BRAND, model: MODEL }, LENS.map((match) => match.productName)),
      checkShoppingQuery({ query: bold("Marque Exemple basket blanc cuir"), brand: bold("Marque Exemple"), model: "" }, boldTitles),
    ];
    for (const checked of accepted) {
      expect(checked.kind).toBe("query");
      if (checked.kind !== "query") continue;
      expect(QUERY_CACHE_PAYLOAD.safeParse(checked.value).success).toBe(true);
      expect(sanitizeShoppingQuery(checked.value.query)).toBe(checked.value.query);
    }
    expect(checkShoppingQuery({ query: bold("Marque Exemple baskets blanc cuir"), brand: bold("Marque Exemple"), model: "" }, boldTitles)).toEqual({ kind: "no_query", reason: "too_long" });
  });
});

describe("journaux et mesure : jamais de contenu", () => {
  it("ni requête, ni titre, ni marque, ni mots, ni adresse, dans aucun journal ni dans « Mesure complément »", async () => {
    const seen: unknown[] = [];
    const scenarios: Partial<ComplementPorts>[] = [
      {},
      { askQuery: vi.fn(async (): Promise<ShoppingQueryAnswer> => Promise.reject(new FakeShoppingQueryError("refused"))) },
      { searchText: vi.fn(async (): Promise<TextSearchResponse> => Promise.reject(new ProviderFailure("refused", 400, "SerpApi a répondu 400"))) },
      { sortShopping: (() => {
        throw new Error(`${QUERY} https://boutique-a.fr/1`);
      }) as LightSortPort },
    ];
    for (const ports of scenarios) {
      const run = setup({ ports });
      const result = await runComplement(run.ports, run.input());
      seen.push(run.logs.warn.mock.calls, run.logs.error.mock.calls, result.measure, complementLogLine(result.measure, { lensFromCache: false, totalMs: 9_000 }));
    }
    const text = textSetup();
    const words = await runTextComplement(text.ports, { words: "veste nuage", existing: [], locale: FR, deadline: text.deadline, reservationId: 7 });
    seen.push(text.logs.warn.mock.calls, text.logs.error.mock.calls, complementLogLine(words.measure, { lensFromCache: false, totalMs: 16_000 }));

    const dump = JSON.stringify(seen);
    for (const forbidden of ["Exemplor", "Nuage", "veste", "Veste", "https://", "boutique", "lens-exemple", "Marchand", "42"]) {
      expect(dump, forbidden).not.toContain(forbidden);
    }
    expect(complementLogLine(words.measure, { lensFromCache: false, totalMs: 16_000 })).toMatchObject({ source: "words", status: "shown", overBudget: true, totalMs: 16_000 });
  });

  function textSetup() {
    const logs = fakeLog();
    const clock = fakeClock(0);
    return {
      logs,
      deadline: startDeadline(0, VOIE_C_BUDGET.totalMs, clock.now),
      ports: { searchText: vi.fn(async (): Promise<TextSearchResponse> => SHOPPING), release: vi.fn(async () => true), now: clock.now, log: logs.log } satisfies TextComplementPorts,
    };
  }
});

describe("recherches relues : origine et complément (lib/searchRows.ts)", () => {
  const BASE_ROW = {
    id: "00000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-000000000002",
    source_url: null,
    source_platform: "photo",
    method: "manual_screenshot",
    thumbnail_url: null,
    screenshot_url: null,
    status: "completed",
    error_message: null,
    query: null,
    created_at: "2026-11-02T10:00:00Z",
    refused_before_call: 0,
    failure_kind: null,
    provider: "serpapi",
    run_started_at: "2026-11-02T10:00:01Z",
  };
  const MATCH = {
    id: "00000000-0000-4000-8000-000000000003",
    search_id: BASE_ROW.id,
    rank: 1,
    product_name: "Pièce",
    brand: null,
    image_url: "https://images.exemple.fr/1.jpg",
    image_hd_url: null,
    price_min: 10,
    price_max: 10,
    currency: "EUR",
    merchant_name: null,
    merchant_url: "https://boutique-exemple.fr/1",
  };

  it("base sans 0028, ou voie C jamais lancée (valeurs par défaut) : réponse identique à celle d'avant (ni origine, ni complément)", async () => {
    const { parseMatchRows, parseSearchRow, toProductSearch } = await import("../src/lib/searchRows.js");
    const before = toProductSearch(parseSearchRow(BASE_ROW)!, parseMatchRows([MATCH])!, new Map(), new Map());
    const defaults = {
      ...BASE_ROW,
      complement_status: null,
      shopping_calls: 0,
      lens_from_cache: false,
      served_from_cache: false,
      text_suggested: false,
      text_requested_at: null,
      text_status: null,
      total_seconds: null,
    };
    const migrated = toProductSearch(parseSearchRow(defaults)!, parseMatchRows([{ ...MATCH, origin: "lens" }])!, new Map(), new Map());
    expect(JSON.stringify(migrated)).toBe(JSON.stringify(before));
    expect(before).not.toHaveProperty("complement");
    expect(before.matches[0]).not.toHaveProperty("origin");
  });

  it("alertes prix (lot 2) : « alertTrackable » seulement sur une pièce qui a une clé (jamais une place de marché, une page de liste ou de Google sans productid)", async () => {
    const { parseMatchRows, parseSearchRow, toProductSearch } = await import("../src/lib/searchRows.js");
    const matches = parseMatchRows([
      MATCH,
      { ...MATCH, id: "00000000-0000-4000-8000-000000000011", rank: 2, merchant_url: "https://www.amazon.fr/dp/B000123", merchant_name: "Amazon" },
      { ...MATCH, id: "00000000-0000-4000-8000-000000000012", rank: 3, merchant_url: "https://boutique-exemple.fr/collections/vestes" },
      { ...MATCH, id: "00000000-0000-4000-8000-000000000013", rank: 4, merchant_url: "https://www.google.fr/search?ibp=oshop&q=veste", merchant_name: "Boutique" },
      { ...MATCH, id: "00000000-0000-4000-8000-000000000014", rank: 5, merchant_url: "https://www.google.fr/search?prds=productid:123", merchant_name: "eBay - vendeur" },
    ])!;
    const search = toProductSearch(parseSearchRow(BASE_ROW)!, matches, new Map(), new Map());
    expect(search.matches.map((match) => match.alertTrackable ?? false)).toEqual([true, false, false, false, false]);
    expect(search.matches[1]).not.toHaveProperty("alertTrackable");
  });

  it("voie C lancée : origine des propositions des boutiques et de vos mots, complément relu ; l'invitation disparaît une fois vos mots lancés ; jamais la requête", async () => {
    const { parseMatchRows, parseSearchRow, toProductSearch } = await import("../src/lib/searchRows.js");
    const row = { ...BASE_ROW, complement_status: "empty", shopping_calls: 1, lens_from_cache: true, served_from_cache: false, text_suggested: true, text_requested_at: null, text_status: null, total_seconds: 9 };
    const matches = parseMatchRows([
      { ...MATCH, origin: "lens" },
      { ...MATCH, id: "00000000-0000-4000-8000-000000000004", rank: 2, origin: "shopping" },
      { ...MATCH, id: "00000000-0000-4000-8000-000000000005", rank: 3, origin: "words" },
    ])!;
    const search = toProductSearch(parseSearchRow(row)!, matches, new Map(), new Map(), true);
    expect(search.complement).toEqual({ status: "empty", suggestText: true, textStatus: null });
    expect(search.matches.map((match) => match.origin)).toEqual([undefined, "shopping", "words"]);
    const used = toProductSearch(parseSearchRow({ ...row, text_requested_at: "2026-11-02T10:01:00Z", text_status: "shown", shopping_calls: 2 })!, matches, new Map(), new Map(), true);
    expect(used.complement).toEqual({ status: "empty", suggestText: false, textStatus: "shown" });
    expect(JSON.stringify(used)).not.toContain("query\":\"");
  });

  it("voie C coupée depuis l'enregistrement : l'invitation n'est plus annoncée (la route répondrait 404) ; l'issue et les origines restent", async () => {
    const { parseMatchRows, parseSearchRow, toProductSearch } = await import("../src/lib/searchRows.js");
    const row = parseSearchRow({ ...BASE_ROW, complement_status: "no_query", shopping_calls: 0, lens_from_cache: false, served_from_cache: false, text_suggested: true, text_requested_at: null, text_status: null, total_seconds: 4 })!;
    const matches = parseMatchRows([{ ...MATCH, origin: "shopping" }])!;
    for (const off of [toProductSearch(row, matches, new Map(), new Map(), false), toProductSearch(row, matches, new Map(), new Map())]) {
      expect(off.complement).toEqual({ status: "no_query", suggestText: false, textStatus: null });
      expect(off.matches[0]!.origin).toBe("shopping");
    }
  });

  it("servie entièrement par le cache : « Que cherchez-vous ? » annoncé le jour (de Paris) de sa création seulement ; une recherche ordinaire, toujours", async () => {
    const { complementOf, parseSearchRow, textSearchCountable } = await import("../src/lib/searchRows.js");
    const columns = { complement_status: "no_query", shopping_calls: 0, lens_from_cache: true, served_from_cache: true, text_suggested: true, text_requested_at: null, text_status: null, total_seconds: 1 };
    const served = parseSearchRow({ ...BASE_ROW, ...columns })!;
    // Créée le 2 novembre à 11 h (Paris) : annoncée le jour même, plus le lendemain.
    expect(complementOf(served, true, new Date("2026-11-02T22:59:00Z"))).toEqual({ status: "no_query", suggestText: true, textStatus: null });
    expect(complementOf(served, true, new Date("2026-11-02T23:00:00Z"))).toEqual({ status: "no_query", suggestText: false, textStatus: null });
    expect(textSearchCountable(served, new Date("2026-11-03T08:00:00Z"))).toBe(false);
    // Jour de Paris, pas jour UTC : créée le 3 novembre à 0 h 30 (Paris), soit le 2 à 23 h 30 UTC.
    const lateNight = parseSearchRow({ ...BASE_ROW, ...columns, created_at: "2026-11-02T23:30:00Z" })!;
    expect(textSearchCountable(lateNight, new Date("2026-11-03T20:00:00Z"))).toBe(true);
    // Une recherche ordinaire (comptée le jour de son lancement), Lens venu du cache ou non : toujours annoncée.
    const ordinary = parseSearchRow({ ...BASE_ROW, ...columns, served_from_cache: false })!;
    expect(complementOf(ordinary, true, new Date("2026-11-20T10:00:00Z"))?.suggestText).toBe(true);
    expect(textSearchCountable(parseSearchRow(BASE_ROW)!, new Date("2027-01-01T10:00:00Z"))).toBe(true);
  });

  it("valeur inconnue (origine, issue) : ligne illisible, comme toute valeur hors liste", async () => {
    const { parseMatchRows, parseSearchRow } = await import("../src/lib/searchRows.js");
    expect(parseMatchRows([{ ...MATCH, origin: "juge" }])).toBeNull();
    expect(parseSearchRow({ ...BASE_ROW, complement_status: "inconnue" })).toBeNull();
  });
});

describe("mesure et limites de la voie C", () => {
  it("« Mesure recherche » : sans fromCache quand la voie C est coupée (ligne d'avant), avec quand elle a tourné", async () => {
    const { measuredColumns, measureLogLine } = await import("../src/lib/searchMeasure.js");
    const columns = measuredColumns({ removedIncomplete: 0, removedSocial: 0, removedProfessional: 0, removedDuplicates: 0, received: 3, kept: 3, keptWithPrice: 3, keptOtherCurrency: 0, distinctSites: 3, sections: ["visual_matches"], googleState: null }, 4);
    const reply = { provider: "serpapi", statusCode: 200 };
    expect(measureLogLine(columns, [], reply)).not.toHaveProperty("fromCache");
    expect(measureLogLine(columns, [], reply, true)).toMatchObject({ fromCache: true });
  });

  it("limites : IA des boutiques 300 par jour pour tout le service ; lancements servis par le cache 30 par heure et par personne", async () => {
    const { RATE_LIMITS } = await import("../src/lib/rateLimits.js");
    expect(RATE_LIMITS.shoppingQueryAiGlobal).toEqual({ max: 300, windowMs: 24 * 60 * 60 * 1000, scope: "global" });
    expect(RATE_LIMITS.searchCacheServed).toEqual({ max: 30, windowMs: 60 * 60 * 1000 });
  });

  it("consumeRateLimit : compte et dit si c'était permis ; toujours permis quand les limites sont coupées (tests)", async () => {
    const { consumeRateLimit } = await import("../src/plugins/rateLimit.js");
    const request = { user: { id: `utilisateur-${Math.random()}` }, ip: "203.0.113.1" } as unknown as Parameters<typeof consumeRateLimit>[0];
    expect(consumeRateLimit(request, "searchCacheServed")).toBe(true);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const allowed = Array.from({ length: 31 }, () => consumeRateLimit(request, "searchCacheServed"));
      expect(allowed.filter(Boolean)).toHaveLength(30);
      expect(allowed.at(-1)).toBe(false);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe("voieCSchemaReady — la migration 0028 est-elle là ?", () => {
  function fakeFastify(missing: () => boolean) {
    const probes: string[] = [];
    const error = vi.fn();
    const fastify = {
      log: { error, warn: vi.fn(), info: vi.fn() },
      supabaseAdmin: {
        from: (table: string) => ({
          select: (columns: string) => ({
            limit: async (count: number) => {
              probes.push(`${table}:${columns}:${count}`);
              return { data: [], error: missing() && table === "search_cache" ? { code: "PGRST205", message: "Could not find the table" } : null };
            },
          }),
        }),
      },
    } as unknown as Parameters<typeof import("../src/lib/voieC.js").voieCSchemaReady>[0];
    return { fastify, probes, error };
  }

  it("absente : un journal d'erreur (code seulement), Lens seul ; sonde refaite au bout de 5 minutes seulement ; vue : mémorisée", async () => {
    const { voieCSchemaReady, resetVoieCSchemaProbe } = await import("../src/lib/voieC.js");
    resetVoieCSchemaProbe();
    let missing = true;
    let time = 0;
    const { fastify, probes, error } = fakeFastify(() => missing);
    expect(await voieCSchemaReady(fastify, () => time)).toBe(false);
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]![0]).toEqual({ code: "PGRST205" });
    expect(probes).toContain("search_cache:key, step, payload, created_at, expires_at:0");
    expect(probes).toContain("product_matches:origin:0");

    time = 4 * 60_000;
    expect(await voieCSchemaReady(fastify, () => time)).toBe(false);
    expect(probes).toHaveLength(3);
    expect(error).toHaveBeenCalledOnce();

    missing = false;
    time = 5 * 60_000 + 1;
    expect(await voieCSchemaReady(fastify, () => time)).toBe(true);
    expect(probes).toHaveLength(6);
    expect(await voieCSchemaReady(fastify, () => time)).toBe(true);
    expect(probes).toHaveLength(6);
    resetVoieCSchemaProbe();
  });

  it("interrupteur coupé (par défaut) : voieCActive ne sonde jamais la base", async () => {
    const { voieCActive, resetVoieCSchemaProbe } = await import("../src/lib/voieC.js");
    resetVoieCSchemaProbe();
    const { fastify, probes } = fakeFastify(() => false);
    expect(await voieCActive(fastify)).toBe(false);
    expect(probes).toEqual([]);
  });
});
