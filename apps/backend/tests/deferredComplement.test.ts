import { describe, expect, it, vi } from "vitest";
import { startDeadline, VOIE_C_BUDGET } from "../src/lib/deadline.js";
import {
  COMPLEMENT_PENDING_MAX_MS,
  COMPLEMENT_RUNNING_MAX_MS,
  deferredComplementReady,
  deferredPending,
  deferredStateOf,
  hasLensRanks,
  lensInGoogleOrder,
  resetDeferredSchemaProbe,
} from "../src/lib/deferredComplement.js";
import { complementLogLine } from "../src/lib/searchMeasure.js";
import { complementOf, parseMatchRows, parseSearchRow, type MatchRow } from "../src/lib/searchRows.js";
import { complementNeedsCalls, emptyComplementMeasure, runComplement, type ComplementPorts } from "../src/lib/voieC.js";
import type { VisualMatch } from "../src/services/visualSearch.js";

// Boutiques ensuite (2026-11-08, migration 0031) : la logique sans réseau —
// l'état de l'étape différée, l'ordre de Google relu dans la base, et la
// règle « une boutique à chercher ». Aucun appel : ni base, ni SerpApi, ni Anthropic.
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, VOIE_C_ENABLED: false, VOIE_C_AI_ENABLED: false, ANTHROPIC_PHOTO_ENABLED: false } };
});

const NOW = Date.parse("2026-11-08T10:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("état de l'étape différée", () => {
  it("sans état : « none » ; fait : « done », quel que soit l'âge", () => {
    expect(deferredStateOf({ complement_deferred: null, complement_deferred_at: null }, NOW)).toBe("none");
    expect(deferredStateOf({}, NOW)).toBe("none");
    expect(deferredStateOf({ complement_deferred: "done", complement_deferred_at: ago(30 * 24 * 3_600_000) }, NOW)).toBe("done");
  });

  it("en attente : « pending » 5 minutes, puis « expired » ; en cours : « running » une minute, puis « stale »", () => {
    expect(deferredStateOf({ complement_deferred: "pending", complement_deferred_at: ago(0) }, NOW)).toBe("pending");
    expect(deferredStateOf({ complement_deferred: "pending", complement_deferred_at: ago(COMPLEMENT_PENDING_MAX_MS) }, NOW)).toBe("pending");
    expect(deferredStateOf({ complement_deferred: "pending", complement_deferred_at: ago(COMPLEMENT_PENDING_MAX_MS + 1) }, NOW)).toBe("expired");
    expect(deferredStateOf({ complement_deferred: "running", complement_deferred_at: ago(COMPLEMENT_RUNNING_MAX_MS) }, NOW)).toBe("running");
    expect(deferredStateOf({ complement_deferred: "running", complement_deferred_at: ago(COMPLEMENT_RUNNING_MAX_MS + 1) }, NOW)).toBe("stale");
  });

  it("heure illisible ou absente : jamais d'étape payante (expirée, ou abandonnée)", () => {
    expect(deferredStateOf({ complement_deferred: "pending", complement_deferred_at: null }, NOW)).toBe("expired");
    expect(deferredStateOf({ complement_deferred: "pending", complement_deferred_at: "pas une date" }, NOW)).toBe("expired");
    expect(deferredStateOf({ complement_deferred: "running", complement_deferred_at: null }, NOW)).toBe("stale");
  });

  it("les boutiques peuvent encore arriver : « pending » et « running » seulement", () => {
    expect((["none", "pending", "expired", "running", "stale", "done"] as const).filter(deferredPending)).toEqual(["pending", "running"]);
  });
});

const BASE_ROW = {
  id: "33333333-3333-4333-8333-333333333333",
  user_id: "11111111-1111-4111-8111-111111111111",
  source_url: null,
  source_platform: "photo",
  method: "manual_screenshot",
  thumbnail_url: null,
  screenshot_url: null,
  status: "completed",
  error_message: null,
  query: null,
  created_at: "2026-11-08T09:59:50Z",
  refused_before_call: 0,
  failure_kind: null,
  provider: "serpapi",
  run_started_at: "2026-11-08T09:59:50Z",
};

describe("complément relu (GET) : `pending` tant que les boutiques peuvent arriver", () => {
  it("en attente ou en cours, voie C en service : pending ; expirée, faite ou voie C coupée : absent", () => {
    const at = (complement_deferred: string, age: number) => parseSearchRow({ ...BASE_ROW, complement_deferred, complement_deferred_at: ago(age) })!;
    const now = new Date(NOW);
    expect(complementOf(at("pending", 1_000), true, now)).toEqual({ status: null, suggestText: false, textStatus: null, pending: true });
    expect(complementOf(at("running", 1_000), true, now)).toEqual({ status: null, suggestText: false, textStatus: null, pending: true });
    expect(complementOf(at("pending", COMPLEMENT_PENDING_MAX_MS + 1), true, now)).toEqual({ status: null, suggestText: false, textStatus: null });
    expect(complementOf(at("pending", 1_000), false, now)).toEqual({ status: null, suggestText: false, textStatus: null });
    const done = parseSearchRow({ ...BASE_ROW, complement_deferred: "done", complement_deferred_at: ago(1_000), complement_status: "shown", shopping_calls: 1 })!;
    expect(complementOf(done, true, now)).toEqual({ status: "shown", suggestText: false, textStatus: null });
  });

  it("recherche d'avant 0031 (sans les colonnes) : inchangée", () => {
    expect(complementOf(parseSearchRow(BASE_ROW)!, true, new Date(NOW))).toBeUndefined();
  });
});

const matchRow = (rank: number, lensRank: number | null, origin?: "lens" | "shopping"): unknown => ({
  id: `m${rank}`,
  search_id: BASE_ROW.id,
  rank,
  product_name: `Pièce ${rank}`,
  brand: null,
  image_url: `https://images.lens.example/${rank}.jpg`,
  image_hd_url: null,
  price_min: rank === 2 ? "59.90" : null,
  price_max: null,
  currency: rank === 2 ? "€" : null,
  merchant_name: "Marchand",
  merchant_url: `https://marchand.example/${rank}`,
  ...(origin ? { origin } : {}),
  lens_rank: lensRank,
});

describe("l'ordre de Google relu dans la base", () => {
  it("sans rang de Google (pas de mots, ou mots sans effet) : l'ordre des rangs", () => {
    const rows = parseMatchRows([matchRow(2, null), matchRow(1, null), matchRow(3, null)])!;
    expect(lensInGoogleOrder(rows).map((match) => match.productName)).toEqual(["Pièce 1", "Pièce 2", "Pièce 3"]);
    expect(hasLensRanks(rows)).toBe(false);
  });

  it("avec les rangs de Google (vos mots ont changé l'ordre) : l'ordre de Google, jamais celui des mots", () => {
    // Rangs du tri par les mots : 1, 2, 3 ; ordre de Google : la 1ʳᵉ affichée était la 3ᵉ de Google.
    const rows = parseMatchRows([matchRow(1, 3), matchRow(2, 1), matchRow(3, 2)])!;
    expect(lensInGoogleOrder(rows).map((match) => match.productName)).toEqual(["Pièce 2", "Pièce 3", "Pièce 1"]);
    expect(hasLensRanks(rows)).toBe(true);
  });

  it("les propositions du complément sont écartées ; prix lu comme un nombre, rangs 1..n", () => {
    const rows = parseMatchRows([matchRow(1, null), matchRow(2, null), matchRow(3, null, "shopping")])!;
    const lens = lensInGoogleOrder(rows);
    expect(lens).toEqual<VisualMatch[]>([
      { rank: 1, productName: "Pièce 1", imageUrl: "https://images.lens.example/1.jpg", imageHdUrl: null, merchantName: "Marchand", merchantUrl: "https://marchand.example/1", priceValue: null, currency: null },
      { rank: 2, productName: "Pièce 2", imageUrl: "https://images.lens.example/2.jpg", imageHdUrl: null, merchantName: "Marchand", merchantUrl: "https://marchand.example/2", priceValue: 59.9, currency: "€" },
    ]);
  });

  it("une ligne sans lens_rank (base d'avant 0031) reste lisible", () => {
    const rows = parseMatchRows([{ ...(matchRow(1, null) as object), lens_rank: undefined }]) as MatchRow[];
    expect(lensInGoogleOrder(rows)).toHaveLength(1);
  });
});

describe("une boutique à chercher (complementNeedsCalls) = runComplement aura besoin d'un port", () => {
  const LENS: VisualMatch[] = [
    { rank: 1, productName: "Exemplor veste", imageUrl: "https://i.example/1.jpg", imageHdUrl: null, merchantName: null, merchantUrl: "https://m.example/1", priceValue: null, currency: null },
  ];

  /** Des ports qui lèvent une erreur dès qu'on touche à l'un d'eux. */
  function trippedPorts(): { ports: ComplementPorts; touched: string[] } {
    const touched: string[] = [];
    const ports = new Proxy({} as ComplementPorts, {
      get(_target, name) {
        if (name === "socketDestroyed") return () => false;
        if (name === "log") return { warn: () => {}, error: () => {} };
        if (name === "then") return undefined;
        return (..._args: unknown[]) => {
          touched.push(String(name));
          throw new Error(`port ${String(name)}`);
        };
      },
    });
    return { ports, touched };
  }

  it("pour chaque cas, faux exactement quand aucun port n'est touché", async () => {
    for (const lensFailed of [false, true]) {
      for (const lens of [[], LENS]) {
        for (const aiEnabled of [false, true]) {
          const { ports, touched } = trippedPorts();
          const input = { lens, lensFailed, lensCalled: true, shoppingCalls: 0, locale: { country: "fr", hl: "fr" }, deadline: startDeadline(0, VOIE_C_BUDGET.totalMs, () => 0), aiEnabled };
          await runComplement(ports, input);
          expect(touched.length > 0, JSON.stringify({ lensFailed, lens: lens.length, aiEnabled })).toBe(complementNeedsCalls(input));
        }
      }
    }
  });
});

describe("« Mesure complément » : boutiques ensuite notées comme telles", () => {
  it("deferred vrai seulement pour l'étape différée ; faux au lancement, comme les lignes d'avant", () => {
    const measure = { ...emptyComplementMeasure("ai"), status: "shown" as const, calls: 1 };
    expect(complementLogLine(measure, { lensFromCache: false, totalMs: 3_200, deferred: true })).toMatchObject({ deferred: true, totalMs: 3_200, overBudget: false });
    expect(complementLogLine(measure, { lensFromCache: false, totalMs: 9_000 })).toMatchObject({ deferred: false });
  });
});

describe("sonde de la migration 0031", () => {
  function fakeFastify(missing: boolean) {
    const selects: string[] = [];
    const warn = vi.fn();
    const fastify = {
      log: { warn },
      supabaseAdmin: {
        from: () => ({
          select: (columns: string) => {
            selects.push(columns);
            return { limit: async () => ({ data: [], error: missing && columns.includes("lens_rank") ? { code: "42703" } : null }) };
          },
        }),
      },
    };
    return { fastify: fastify as unknown as Parameters<typeof deferredComplementReady>[0], selects, warn };
  }

  it("présente : vue une fois, puis plus aucune lecture", async () => {
    resetDeferredSchemaProbe();
    const { fastify, selects } = fakeFastify(false);
    expect(await deferredComplementReady(fastify)).toBe(true);
    expect(await deferredComplementReady(fastify)).toBe(true);
    expect(selects).toEqual(["complement_deferred, complement_deferred_at", "lens_rank"]);
  });

  it("absente : un avertissement sans contenu, puis plus aucune lecture pendant 5 minutes", async () => {
    resetDeferredSchemaProbe();
    let now = NOW;
    const { fastify, selects, warn } = fakeFastify(true);
    expect(await deferredComplementReady(fastify, () => now)).toBe(false);
    now += 4 * 60_000;
    expect(await deferredComplementReady(fastify, () => now)).toBe(false);
    expect(selects).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toEqual({ code: "42703" });
    now += 2 * 60_000;
    await deferredComplementReady(fastify, () => now);
    expect(selects).toHaveLength(4);
    resetDeferredSchemaProbe();
  });
});
