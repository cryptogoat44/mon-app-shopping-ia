import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Retours du build 3 (« pour les images floues des pièces je veux que tu
// étendes maintenant aux résultats ») : la grande image lue sur la page de la
// boutique pour les 8 premières cartes affichées « boutiques » et « vos mots »
// d'une recherche, derrière MERCHANT_IMAGE_RESULTS_ENABLED (éteint par
// défaut). SANS base ni réseau : résolutions et réponses des sites simulées,
// base en mémoire.
const { httpsRequest, switches } = vi.hoisted(() => ({ httpsRequest: vi.fn(), switches: { results: false, upgrade: false } }));
vi.mock("node:https", () => ({ default: { request: httpsRequest } }));
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return {
    env: new Proxy(original.env, {
      get: (target, key) =>
        key === "MERCHANT_IMAGE_RESULTS_ENABLED" ? switches.results : key === "MERCHANT_IMAGE_UPGRADE_ENABLED" ? switches.upgrade : target[key as keyof typeof target],
    }),
  };
});

import type { Resolver } from "../src/lib/publicImage.js";
import {
  RESULT_IMAGE_CONCURRENCY,
  RESULT_IMAGES_BUDGET_MS,
  RESULT_IMAGES_PER_MINUTE,
  RESULT_IMAGES_PER_SECTION,
  merchantImageResultsEnabled,
  queueResultMerchantImages,
  resetMerchantImageMemory,
  upgradeResultMerchantImages,
} from "../src/lib/merchantImage.js";
import { resultImageOrder, toProductSearch, trustOfferOf, type MatchRow, type SearchRow } from "../src/lib/searchRows.js";
import { fakeSupabase } from "./fakeSupabase.js";

const PUBLIC: Resolver = async () => [{ address: "93.184.215.14", family: 4 }];
const HTML = { "content-type": "text/html; charset=utf-8" };
const JPEG = { "content-type": "image/jpeg" };
const THUMB = "https://encrypted-tbn0.gstatic.com/images?q=tbn:pull";

type Answer = { status: number; headers?: Record<string, string>; body?: Buffer };

/** Chaque demande attend qu'on lui réponde : on voit ce qui tourne en même temps. */
const waiting: { url: string; answer: (answer: Answer) => void }[] = [];
function holdAll() {
  httpsRequest.mockImplementation((url: URL, _options: unknown, callback: (response: Readable) => void) => {
    const req = Object.assign(new EventEmitter(), {
      end: () => {
        waiting.push({
          url: String(url),
          answer: (answer) => callback(Object.assign(Readable.from(answer.body ? [answer.body] : []), { statusCode: answer.status, headers: answer.headers ?? {} })),
        });
      },
    });
    return req;
  });
}
/** Toutes les demandes répondent tout de suite par la même réponse. */
function answerAll(answer: (url: string) => Answer) {
  httpsRequest.mockImplementation((url: URL, _options: unknown, callback: (response: Readable) => void) => {
    const req = Object.assign(new EventEmitter(), {
      end: () => {
        setImmediate(() => {
          const a = answer(String(url));
          callback(Object.assign(Readable.from(a.body ? [a.body] : []), { statusCode: a.status, headers: a.headers ?? {} }));
        });
      },
    });
    return req;
  });
}

const id = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((done) => setImmediate(done));
};
const log = { info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger;

function store(rows: { id: string; merchant_url: string | null; image_hd_url?: string | null; image_url?: string }[]) {
  const fake = fakeSupabase();
  for (const row of rows) fake.table("product_matches").push({ image_url: THUMB, image_hd_url: null, ...row });
  return { fake, fastify: { supabaseAdmin: fake.db } as unknown as FastifyInstance };
}

let portrait: Buffer;
beforeAll(async () => {
  portrait = await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#203040" } })
    .jpeg()
    .toBuffer();
});

beforeEach(() => {
  httpsRequest.mockReset();
  waiting.length = 0;
  resetMerchantImageMemory();
  switches.results = false;
  switches.upgrade = false;
  vi.mocked(log.info).mockClear();
  vi.mocked(log.warn).mockClear();
});

const shop = (n: number) => `https://boutique-${n}.example/piece`;

describe("interrupteur MERCHANT_IMAGE_RESULTS_ENABLED", () => {
  it("refusé : éteint (par défaut), aucune lecture, même avec l'interrupteur des pièces gardées allumé", async () => {
    switches.upgrade = true;
    expect(merchantImageResultsEnabled()).toBe(false);
    const { fastify } = store([{ id: id(1), merchant_url: shop(1) }]);
    expect(await upgradeResultMerchantImages(fastify, log, [{ id: id(1), merchant_url: shop(1) }], PUBLIC)).toEqual({ written: 0, none: 0, abandoned: 0 });
    queueResultMerchantImages(fastify, log, [{ id: id(1), merchant_url: shop(1) }], PUBLIC);
    await flush();
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it("permis : allumé, la page est lue et la grande image rangée", async () => {
    switches.results = true;
    const found = "https://cdn.example/pull-1600.jpg";
    answerAll((url) => (url.startsWith("https://cdn.example") ? { status: 200, headers: JPEG, body: portrait } : { status: 200, headers: HTML, body: Buffer.from(`<meta property="og:image" content="${found}">`) }));
    const { fake, fastify } = store([{ id: id(1), merchant_url: shop(1) }]);
    expect(await upgradeResultMerchantImages(fastify, log, [{ id: id(1), merchant_url: shop(1) }], PUBLIC)).toEqual({ written: 1, none: 0, abandoned: 0 });
    expect(fake.table("product_matches")[0]!.image_hd_url).toBe(found);
  });
});

describe("quelles propositions", () => {
  it(`seules les ${RESULT_IMAGES_PER_SECTION} premières sont lues, dans l'ordre reçu ; la 9ᵉ jamais`, async () => {
    switches.results = true;
    answerAll(() => ({ status: 404 }));
    const rows = Array.from({ length: 9 }, (_, n) => ({ id: id(n + 1), merchant_url: shop(n + 1) }));
    const { fastify } = store(rows);
    expect(await upgradeResultMerchantImages(fastify, log, rows, PUBLIC)).toEqual({ written: 0, none: 8, abandoned: 0 });
    const urls = httpsRequest.mock.calls.map((call) => String(call[0]));
    expect(urls).toHaveLength(8);
    expect(urls).not.toContain(shop(9));
    // Les trois premières partent d'abord : l'ordre affiché, reçu tel quel de routes/searches.ts.
    expect(urls.slice(0, 3)).toEqual([shop(1), shop(2), shop(3)]);
  });

  it("refusé : une page de Google, une adresse http ou sans adresse n'est jamais lue (et compte dans les 8)", async () => {
    switches.results = true;
    answerAll(() => ({ status: 404 }));
    const rows = [
      { id: id(1), merchant_url: "https://www.google.com/shopping/product/1" },
      { id: id(2), merchant_url: "http://boutique.example/a" },
      { id: id(3), merchant_url: null },
      { id: id(4), merchant_url: shop(4) },
    ];
    const { fastify } = store(rows);
    await upgradeResultMerchantImages(fastify, log, rows, PUBLIC);
    expect(httpsRequest.mock.calls.map((call) => String(call[0]))).toEqual([shop(4)]);
  });

  it("une proposition déjà tentée dans la journée n'est pas relue", async () => {
    switches.results = true;
    answerAll(() => ({ status: 404 }));
    const rows = [{ id: id(1), merchant_url: shop(1) }];
    const { fastify } = store(rows);
    await upgradeResultMerchantImages(fastify, log, rows, PUBLIC);
    await upgradeResultMerchantImages(fastify, log, rows, PUBLIC);
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });
});

describe("rythme", () => {
  it(`${RESULT_IMAGE_CONCURRENCY} lectures à la fois au plus ; la suivante part quand une finit`, async () => {
    switches.results = true;
    holdAll();
    const rows = Array.from({ length: 6 }, (_, n) => ({ id: id(n + 1), merchant_url: shop(n + 1) }));
    const { fastify } = store(rows);
    const done = upgradeResultMerchantImages(fastify, log, rows, PUBLIC);
    await flush();
    expect(waiting).toHaveLength(3);
    waiting[0]!.answer({ status: 404 });
    await flush();
    expect(waiting).toHaveLength(4);
    for (let i = 1; i < 6; i++) {
      waiting[i]!.answer({ status: 404 });
      await flush();
    }
    expect(await done).toEqual({ written: 0, none: 6, abandoned: 0 });
  });

  it("refusé : deux propositions de la même boutique ne sont jamais lues en même temps ; permis : une autre boutique, oui", async () => {
    switches.results = true;
    holdAll();
    const same = "https://meme-boutique.example";
    const rows = [
      { id: id(1), merchant_url: `${same}/a` },
      { id: id(2), merchant_url: `${same}/b` },
      { id: id(3), merchant_url: shop(3) },
    ];
    const { fastify } = store(rows);
    const done = upgradeResultMerchantImages(fastify, log, rows, PUBLIC);
    await flush();
    expect(waiting.map((w) => w.url)).toEqual([`${same}/a`, shop(3)]);
    waiting[0]!.answer({ status: 404 });
    await flush();
    expect(waiting.map((w) => w.url)).toEqual([`${same}/a`, shop(3), `${same}/b`]);
    waiting[1]!.answer({ status: 404 });
    waiting[2]!.answer({ status: 404 });
    expect(await done).toEqual({ written: 0, none: 3, abandoned: 0 });
  });

  it("une boutique déjà lue pour une autre recherche attend aussi son tour (une seule lecture par boutique pour tout le serveur)", async () => {
    switches.results = true;
    holdAll();
    const { fastify } = store([]);
    const first = upgradeResultMerchantImages(fastify, log, [{ id: id(1), merchant_url: shop(1) }], PUBLIC);
    const second = upgradeResultMerchantImages(fastify, log, [{ id: id(2), merchant_url: `${shop(1)}?autre` }], PUBLIC);
    await flush();
    expect(waiting).toHaveLength(1);
    waiting[0]!.answer({ status: 404 });
    await flush();
    expect(waiting).toHaveLength(2);
    waiting[1]!.answer({ status: 404 });
    await Promise.all([first, second]);
  });

  it(`après ${RESULT_IMAGES_BUDGET_MS / 1000} s, aucune nouvelle lecture ne commence : le reste est abandonné`, async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      switches.results = true;
      holdAll();
      const rows = Array.from({ length: 5 }, (_, n) => ({ id: id(n + 1), merchant_url: shop(n + 1) }));
      const { fastify } = store(rows);
      const done = upgradeResultMerchantImages(fastify, log, rows, PUBLIC);
      await flush();
      expect(waiting).toHaveLength(3);
      vi.setSystemTime(Date.now() + RESULT_IMAGES_BUDGET_MS - 1);
      waiting[0]!.answer({ status: 404 });
      await flush();
      // Encore dans le temps : la 4ᵉ part.
      expect(waiting).toHaveLength(4);
      vi.setSystemTime(Date.now() + 2);
      for (const index of [1, 2, 3]) waiting[index]!.answer({ status: 404 });
      await flush();
      expect(waiting).toHaveLength(4);
      expect(await done).toEqual({ written: 0, none: 4, abandoned: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it(`plafond de ${RESULT_IMAGES_PER_MINUTE} lectures par minute pour tout le serveur : la ${RESULT_IMAGES_PER_MINUTE + 1}ᵉ est refusée, toutes recherches confondues`, async () => {
    switches.results = true;
    answerAll(() => ({ status: 404 }));
    const { fastify } = store([]);
    let n = 0;
    // Quatre recherches de 8 propositions : 32 demandées, 30 lues.
    const totals = { written: 0, none: 0, abandoned: 0 };
    for (let search = 0; search < 4; search++) {
      const rows = Array.from({ length: 8 }, () => {
        n += 1;
        return { id: id(n), merchant_url: shop(n) };
      });
      const counts = await upgradeResultMerchantImages(fastify, log, rows, PUBLIC);
      totals.none += counts.none;
      totals.abandoned += counts.abandoned;
    }
    expect(httpsRequest).toHaveBeenCalledTimes(RESULT_IMAGES_PER_MINUTE);
    expect(totals).toEqual({ written: 0, none: 30, abandoned: 2 });
  });
});

describe("écriture et journal", () => {
  const FOUND = "https://cdn.example/grande.jpg";
  const shopPage = () =>
    answerAll((url) => (url.startsWith("https://cdn.example") ? { status: 200, headers: JPEG, body: portrait } : { status: 200, headers: HTML, body: Buffer.from(`<meta property="og:image" content="${FOUND}">`) }));

  it("refusé : une colonne déjà remplie n'est jamais remplacée", async () => {
    switches.results = true;
    shopPage();
    const { fake, fastify } = store([{ id: id(1), merchant_url: shop(1), image_hd_url: "https://cdn.example/deja.jpg" }]);
    expect(await upgradeResultMerchantImages(fastify, log, [{ id: id(1), merchant_url: shop(1) }], PUBLIC)).toEqual({ written: 0, none: 1, abandoned: 0 });
    expect(fake.table("product_matches")[0]!.image_hd_url).toBe("https://cdn.example/deja.jpg");
  });

  it("refusé : aucune écriture si l'image trouvée est la vignette elle-même", async () => {
    switches.results = true;
    shopPage();
    const { fake, fastify } = store([{ id: id(1), merchant_url: shop(1), image_url: FOUND }]);
    await upgradeResultMerchantImages(fastify, log, [{ id: id(1), merchant_url: shop(1) }], PUBLIC);
    expect(fake.table("product_matches")[0]!.image_hd_url).toBeNull();
  });

  it("permis : écrite seulement si la colonne est encore vide ; le journal ne porte jamais d'adresse ni d'identifiant", async () => {
    switches.results = true;
    shopPage();
    const { fake, fastify } = store([{ id: id(1), merchant_url: shop(1) }]);
    await upgradeResultMerchantImages(fastify, log, [{ id: id(1), merchant_url: shop(1) }], PUBLIC);
    expect(fake.table("product_matches")[0]!.image_hd_url).toBe(FOUND);
    answerAll(() => ({ status: 403 }));
    await upgradeResultMerchantImages(fastify, log, [{ id: id(2), merchant_url: shop(2) }], PUBLIC);
    const journal = JSON.stringify([vi.mocked(log.info).mock.calls, vi.mocked(log.warn).mock.calls]);
    expect(journal).toContain("Grande image des résultats : trouvée et rangée");
    expect(journal).toContain("Grande image des résultats : non trouvée");
    expect(journal).toContain('"status":403');
    for (const secret of ["boutique-1", "boutique-2", "cdn.example", id(1), id(2)]) expect(journal).not.toContain(secret);
  });

  it("la mise en file rend la main tout de suite, même si la boutique ne répond jamais (la réponse de la route n'attend pas)", async () => {
    switches.results = true;
    holdAll();
    const { fastify } = store([{ id: id(1), merchant_url: shop(1) }]);
    const returned = queueResultMerchantImages(fastify, log, [{ id: id(1), merchant_url: shop(1) }], PUBLIC);
    expect(returned).toBeUndefined();
    // Rien ne part avant la fin de la réponse (après setImmediate).
    expect(httpsRequest).not.toHaveBeenCalled();
    await flush();
    expect(waiting).toHaveLength(1);
  });

  it("des lignes illisibles ne font jamais échouer le rangement", () => {
    switches.results = true;
    const hostile = new Proxy([], { get: () => { throw new Error("illisible"); } }) as unknown as { id: string; merchant_url: string }[];
    expect(() => queueResultMerchantImages({} as FastifyInstance, log, hostile)).not.toThrow();
  });
});

describe("branchement dans routes/searches.ts (lecture du code)", () => {
  const source = readFileSync(join(__dirname, "..", "src", "routes", "searches.ts"), "utf8");
  const save = source.slice(source.indexOf("async function saveComplementRows("), source.indexOf("\n}\n", source.indexOf("async function saveComplementRows(")));

  it("permis : une seule mise en file, dans saveComplementRows, après une insertion réussie, sans l'attendre, dans l'ordre affiché", () => {
    expect(source.match(/queueResultMerchantImages\(/g)).toHaveLength(1);
    expect(
      save.match(/queueResultMerchantImages\(fastify, fastify\.log, \(\) => resultImageOrder\(inserted\.data, matches, origin, brandShopNoted, others\)\);/g)
    ).toHaveLength(1);
    expect(source).not.toMatch(/await queueResultMerchantImages/);
  });

  it("refusé : jamais l'ordre d'insertion seul ; permis : les trois rangements passent les autres propositions de la recherche, sans rien relire", () => {
    expect(save).not.toMatch(/queueResultMerchantImages\(fastify, fastify\.log, inserted\.data\)/);
    expect(source).toContain('saveComplementRows(fastify, launch.id, complement.matches, "shopping", outcome.matches.length, outcome.matches)');
    expect(source).toContain('saveComplementRows(fastify, row.id, offered.matches, "shopping", lastRank, matches.map(trustOfferOf))');
    expect(source).toContain('saveComplementRows(fastify, id, text.matches, "words", lastRank, existing.map(trustOfferOf))');
    // Le oui de la boutique de la marque ne compte que s'il a été noté.
    expect(save).toMatch(/\(\{ data, error \} = await insertRows\(false, false\)\);\s*brandShopNoted = false;/);
  });

  it("refusé : jamais sur un échec d'insertion (la mise en file vient après le « return null » de l'échec)", () => {
    const failure = save.indexOf("if (error || !inserted.success) {");
    const failureReturn = save.indexOf("return null;", failure);
    expect(failure).toBeGreaterThan(-1);
    expect(save.indexOf("queueResultMerchantImages(")).toBeGreaterThan(failureReturn);
  });

  it("refusé : les propositions Lens (saveMatches) ne sont jamais lues", () => {
    const saveMatches = source.slice(source.indexOf("async function saveMatches("), source.indexOf("\n}\n", source.indexOf("async function saveMatches(")));
    expect(saveMatches.length).toBeGreaterThan(0);
    expect(saveMatches).not.toContain("queueResultMerchantImages");
  });
});

// La décision (retours du build 3) : les 8 pages lues sont celles des 8 cartes
// que le membre voit EN PREMIER, dans l'ordre de la relecture (GET
// /api/searches/:id, toProductSearch), sans règle d'ordre nouvelle.
describe("les 8 premières cartes affichées", () => {
  const SEARCH: SearchRow = {
    id: "recherche-1",
    user_id: "membre-1",
    source_url: null,
    source_platform: "photo",
    method: "manual_screenshot",
    screenshot_url: null,
    status: "completed",
    error_message: null,
    query: null,
    created_at: "2026-11-20T10:00:00.000Z",
    refused_before_call: 0,
    failure_kind: null,
    provider: "serpapi",
    run_started_at: "2026-11-20T10:00:00.000Z",
  };
  const OFFICIAL = "https://www.sezane.com/fr/piece";
  const FLAGGED = "https://moncler-outlet.shop/piece";
  const lens = [shop(101), shop(102)].map((merchantUrl, index) => ({ merchantUrl, priceValue: 100 + index, currency: "EUR" }));
  /** Dix propositions « boutiques » rangées après deux Lens (rangs 3 à 12) :
   * la 1ʳᵉ (rang 3) est une offre signalée, la dernière (rang 12) la boutique
   * officielle de la marque de la pièce. */
  const sent = Array.from({ length: 10 }, (_, n) => ({
    merchantUrl: n === 0 ? FLAGGED : n === 9 ? OFFICIAL : shop(n + 1),
    priceValue: 120 + n,
    currency: "EUR",
    ...(n === 9 ? { brandShop: true } : {}),
  }));
  const inserted = sent.map((m, n) => ({ id: id(n + 3), merchant_url: m.merchantUrl }));

  it("refusé : la carte signalée affichée en 10ᵉ n'est pas lue ; permis : la boutique de la marque, remontée en tête depuis le rang 12, est lue", async () => {
    switches.results = true;
    answerAll(() => ({ status: 404 }));
    const order = resultImageOrder(inserted, sent, "shopping", true, lens);
    expect(order[0]!.merchant_url).toBe(OFFICIAL);
    expect(order.at(-1)!.merchant_url).toBe(FLAGGED);
    // Dans l'ordre d'insertion, ce serait l'inverse.
    expect(inserted.slice(0, 8).map((row) => row.merchant_url)).toContain(FLAGGED);
    expect(inserted.slice(0, 8).map((row) => row.merchant_url)).not.toContain(OFFICIAL);
    const { fastify } = store(inserted);
    queueResultMerchantImages(fastify, log, () => order, PUBLIC);
    await flush();
    await flush();
    const urls = httpsRequest.mock.calls.map((call) => String(call[0]));
    expect(urls).toHaveLength(8);
    expect(urls).toContain(OFFICIAL);
    expect(urls).not.toContain(FLAGGED);
    expect(urls[0]).toBe(OFFICIAL);
  });

  it("le même ordre que la relecture (toProductSearch), pour « boutiques » et pour « vos mots »", () => {
    const asRow = (row: { id: string; merchant_url: string }, n: number, origin: "shopping" | "words", brandShop: boolean): MatchRow => ({
      id: row.id,
      search_id: SEARCH.id,
      rank: n + 3,
      product_name: `Pièce ${n}`,
      brand: null,
      image_url: THUMB,
      image_hd_url: null,
      price_min: sent[n]!.priceValue.toFixed(2),
      price_max: sent[n]!.priceValue.toFixed(2),
      currency: "EUR",
      merchant_name: "Boutique",
      merchant_url: row.merchant_url,
      origin,
      brand_shop: brandShop ? true : null,
    });
    const lensRows: MatchRow[] = lens.map((offer, n) => ({
      ...asRow({ id: id(201 + n), merchant_url: offer.merchantUrl }, 0, "shopping", false),
      rank: n + 1,
      price_min: offer.priceValue.toFixed(2),
      price_max: offer.priceValue.toFixed(2),
      origin: "lens",
    }));
    for (const origin of ["shopping", "words"] as const) {
      const rows = inserted.map((row, n) => asRow(row, n, origin, origin === "shopping" && sent[n]!.brandShop === true));
      const shown = toProductSearch(SEARCH, [...lensRows, ...rows].reverse(), new Map(), new Map())
        .matches.filter((match) => (match.origin ?? "lens") === origin)
        .map((match) => match.id);
      const ordered = resultImageOrder(inserted, sent, origin, true, lensRows.map(trustOfferOf)).map((row) => row.id);
      expect(ordered).toEqual(shown);
    }
  });

  it("refusé : dans « vos mots », rien n'est remonté (la boutique officielle au rang 12 reste 10ᵉ, non lue) ; permis : les 8 premières par rang y sont lues", async () => {
    switches.results = true;
    answerAll(() => ({ status: 404 }));
    const order = resultImageOrder(inserted, sent, "words", true, lens);
    expect(order).toEqual(inserted);
    const { fastify } = store(inserted);
    await upgradeResultMerchantImages(fastify, log, order, PUBLIC);
    const urls = httpsRequest.mock.calls.map((call) => String(call[0]));
    expect(urls).toHaveLength(8);
    expect(urls).toContain(FLAGGED);
    expect(urls).not.toContain(OFFICIAL);
  });

  it("refusé : un oui de boutique de la marque non noté (colonne absente) ne remonte rien de plus qu'à la relecture", () => {
    const order = resultImageOrder(inserted, sent, "shopping", false, lens);
    // Rangée comme une boutique connue : remontée de 2 places au plus, pas en tête.
    expect(order[0]!.merchant_url).not.toBe(OFFICIAL);
    expect(order.findIndex((row) => row.merchant_url === OFFICIAL)).toBe(6);
  });

  it("si l'insertion ne rend pas les lignes dans l'ordre envoyé : l'ordre reçu, sans tri", () => {
    const shuffled = [inserted[1]!, inserted[0]!, ...inserted.slice(2)];
    expect(resultImageOrder(shuffled, sent, "shopping", true, lens)).toEqual(shuffled);
  });

  it("refusé : les deux interrupteurs éteints, l'ordre n'est même pas calculé et rien n'est lu", async () => {
    const compute = vi.fn(() => resultImageOrder(inserted, sent, "shopping", true, lens));
    const { fastify } = store(inserted);
    queueResultMerchantImages(fastify, log, compute, PUBLIC);
    await flush();
    expect(compute).not.toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it("un calcul de l'ordre qui échoue ne fait jamais échouer le rangement", () => {
    switches.results = true;
    expect(() => queueResultMerchantImages({} as FastifyInstance, log, () => { throw new Error("illisible"); })).not.toThrow();
  });
});
