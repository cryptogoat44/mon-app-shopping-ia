import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

// Ordre des boutiques (migration 0054) sur la VRAIE base de développement
// (spotto-dev-2, sur le Mac du fondateur) : ce que seule une vraie base
// prouve — le « oui » écrit sur la seule ligne de la boutique officielle de
// la marque de la pièce quand les boutiques sont enregistrées, la relecture
// qui la met en tête de sa section, et la contrainte qui refuse « non ».
// Sans la colonne (0054 absente), chaque test est passé (« skip »). Aucun
// appel réel : Google Lens, l'IA et Google Shopping sont simulés, le plafond
// des recherches, la limite de l'IA et le cache aussi (comme dans
// boutiquesEnsuite.test.ts). Un seul compte, effacé à la fin avec ses
// recherches. Les règles, cas par cas, sans base : boutiquesDouteuses.test.ts
// et boutiquesEnsuiteRoute.test.ts. Boutiques et titres fictifs (sauf les
// adresses des listes du fondateur).
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, VOIE_C_ENABLED: false, VOIE_C_AI_ENABLED: false, ANTHROPIC_API_KEY: "faux-anthropic", ANTHROPIC_PHOTO_ENABLED: false } };
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
vi.mock("../src/lib/searchCache.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/searchCache.js")>();
  return { ...original, readCache: vi.fn(async () => null), writeCache: vi.fn(async () => undefined) };
});

import { env } from "../src/env.js";
import { searchProductsByImageUrl, type VisualMatch } from "../src/services/visualSearch.js";
import { serpApiTextProvider } from "../src/services/serpapi.js";
import { askShoppingQuery } from "../src/services/shoppingQueryAi.js";
import { releaseReservation, reserveSearch, searchCapacityBeforeComplementAi } from "../src/lib/searchCapacity.js";
import { aiQuotaFor } from "../src/lib/aiQuota.js";
import { resetBrandShopColumnProbe } from "../src/lib/brandShopColumn.js";
import type { TextSearchResponse } from "../src/services/searchProvider.js";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

const lensMock = vi.mocked(searchProductsByImageUrl);
const shoppingMock = vi.mocked(serpApiTextProvider.searchByText);
const aiMock = vi.mocked(askShoppingQuery);

const lensMatch = (rank: number, productName: string): VisualMatch => ({
  rank,
  productName,
  imageUrl: `https://images.lens.example/marque-${rank}.jpg`,
  imageHdUrl: null,
  merchantName: "Marchand Exemple",
  merchantUrl: `https://marchand.example/marque-${rank}`,
  priceValue: 40 + rank,
  currency: "€",
});
/** La marque de la pièce (Zara) est dans deux titres de la recherche visuelle. */
const LENS = [lensMatch(1, "Zara top satiné noir"), lensMatch(2, "Top satin Zara"), lensMatch(3, "Top satiné")];

/** Google Shopping : un revendeur, zara.com (la marque de la pièce), un autre, mango.com (une autre marque). */
function shopping(): TextSearchResponse {
  const item = (position: number, title: string, link: string) => ({
    position,
    title,
    link,
    source: "Boutique",
    price: "29,99 €",
    extracted_price: 29.99,
    thumbnail: `https://images.boutique.example/marque-${position}.jpg`,
  });
  return {
    items: [
      item(1, "Top satiné noir", "https://boutique-c.example/marque-1"),
      item(2, "Zara top satiné", "https://boutique-d.example/marque-2"),
      item(3, "Zara top satiné noir", "https://boutique-e.example/marque-3"),
      item(4, "TOP SATINÉ - Noir", "https://www.zara.com/fr/marque-4"),
      item(5, "Blouse satinée", "https://shop.mango.com/fr/marque-5"),
    ],
    received: 5,
    statusCode: 200,
  };
}

const probeColumn = async (app: FastifyInstance) => !(await app.supabaseAdmin.from("product_matches").select("brand_shop").limit(0)).error;

describe("ordre des boutiques : le « oui » de la boutique de la marque de la pièce, sur la base (0054)", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let photo: Buffer;
  let has0054 = false;
  const switches = { VOIE_C_ENABLED: env.VOIE_C_ENABLED, VOIE_C_AI_ENABLED: env.VOIE_C_AI_ENABLED };

  beforeAll(async () => {
    app = await buildTestApp();
    has0054 = await probeColumn(app);
    if (!has0054) return;
    user = await createTestUser(app, "bqm");
    photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#202020" } }).jpeg().toBuffer();
  });

  afterAll(async () => {
    Object.assign(env, switches);
    if (user) {
      await app.supabaseAdmin.from("product_searches").delete().eq("user_id", user.id);
      await deleteTestUser(app, user.id);
    }
    await app.close();
  });

  beforeEach(() => {
    resetBrandShopColumnProbe();
    Object.assign(env, { VOIE_C_ENABLED: true, VOIE_C_AI_ENABLED: true });
    lensMock.mockReset();
    lensMock.mockResolvedValue({
      matches: structuredClone(LENS),
      measure: { removedIncomplete: 0, removedSocial: 0, removedProfessional: 0, removedDuplicates: 0, received: 3, kept: 3, keptWithPrice: 3, keptOtherCurrency: 0, distinctSites: 3, sections: ["visual_matches"], googleState: null },
      addedRanks: [],
      statusCode: 200,
    });
    shoppingMock.mockReset();
    shoppingMock.mockResolvedValue(shopping());
    aiMock.mockReset();
    aiMock.mockResolvedValue({ kind: "query", value: { query: "Zara top satiné noir", brand: "Zara", model: "" }, usage: { inputTokens: 900, outputTokens: 40 } });
    let reservation = 9_000;
    vi.mocked(reserveSearch).mockReset();
    vi.mocked(reserveSearch).mockImplementation(async () => ({ allowed: true, reservationId: (reservation += 1) }));
    vi.mocked(releaseReservation).mockReset();
    vi.mocked(releaseReservation).mockResolvedValue(true);
    vi.mocked(searchCapacityBeforeComplementAi).mockReset();
    vi.mocked(searchCapacityBeforeComplementAi).mockResolvedValue({ allowed: true });
    vi.mocked(aiQuotaFor).mockReset();
    vi.mocked(aiQuotaFor).mockResolvedValue({ allowed: true });
  });

  /** Une recherche préparée puis lancée, boutiques cherchées au lancement (comme une app déjà installée). */
  async function launchedSearch(): Promise<{ id: string; body: { matches: { origin?: string; merchantUrl: string; offerMark?: string }[] } }> {
    const prepared = await app.inject({ method: "POST", url: "/api/searches/prepare", headers: authHeaders(user.token), payload: {} });
    expect(prepared.statusCode).toBe(200);
    const id = z.object({ id: z.string() }).parse(prepared.json()).id;
    const mp = buildMultipart({}, { fieldname: "file", filename: "photo.jpg", contentType: "image/jpeg", data: photo });
    const res = await app.inject({ method: "POST", url: `/api/searches/${id}/run`, headers: { ...authHeaders(user.token), ...mp.headers, "accept-language": "fr-FR" }, payload: mp.payload });
    expect(res.statusCode).toBe(200);
    return { id, body: res.json() };
  }

  async function shoppingRows(id: string) {
    const { data, error } = await app.supabaseAdmin.from("product_matches").select("rank, origin, merchant_url, brand_shop").eq("search_id", id).order("rank");
    expect(error).toBeNull();
    return (data as { rank: number; origin: string; merchant_url: string; brand_shop: boolean | null }[]).filter((row) => row.origin === "shopping");
  }

  const hostsOf = (body: { matches: { origin?: string; merchantUrl: string }[] }) =>
    body.matches.filter((match) => match.origin === "shopping").map((match) => new URL(match.merchantUrl).hostname);

  it("permis : la marque validée (Zara) est celle de zara.com — le oui sur cette seule ligne, la marque jamais rangée ; à la relecture, zara.com en tête de sa section", async (context) => {
    if (!has0054) context.skip();
    const { id, body } = await launchedSearch();
    const rows = await shoppingRows(id);
    expect(rows).toHaveLength(5);
    expect(rows.filter((row) => row.brand_shop === true).map((row) => new URL(row.merchant_url).hostname)).toEqual(["www.zara.com"]);
    expect(rows.filter((row) => row.brand_shop !== true).every((row) => row.brand_shop === null)).toBe(true);
    // zara.com n'était pas la première enregistrée : seule la relecture la met en tête.
    expect(new URL(rows[0]!.merchant_url).hostname).not.toBe("www.zara.com");
    for (const answer of [body, (await app.inject({ method: "GET", url: `/api/searches/${id}`, headers: authHeaders(user.token) })).json()]) {
      const hosts = hostsOf(answer);
      expect(hosts[0]).toBe("www.zara.com");
      expect(hosts).toHaveLength(5);
    }
    // La recherche visuelle garde l'ordre reçu.
    const lens = body.matches.filter((match) => (match.origin ?? "lens") === "lens").map((match) => match.merchantUrl);
    expect(lens).toEqual(LENS.map((match) => match.merchantUrl));
  });

  it("refusé : une marque qui n'est celle d'aucune boutique de la section — aucun oui ; et la base refuse « non » (seuls oui et vide existent)", async (context) => {
    if (!has0054) context.skip();
    aiMock.mockResolvedValue({ kind: "query", value: { query: "Exemplor top satiné", brand: "Exemplor", model: "" }, usage: { inputTokens: 900, outputTokens: 40 } });
    const { id } = await launchedSearch();
    const rows = await shoppingRows(id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.brand_shop === null)).toBe(true);
    const line = (rank: number, brandShop: boolean | null) => ({
      search_id: id,
      rank,
      product_name: "Top test",
      image_url: "https://images.boutique.example/test.jpg",
      merchant_url: "https://www.zara.com/fr/test",
      origin: "shopping",
      brand_shop: brandShop,
    });
    const refused = await app.supabaseAdmin.from("product_matches").insert(line(90, false));
    expect(refused.error).not.toBeNull();
    expect(refused.error?.code).toBe("23514");
    // Contrôle : oui et vide sont acceptés sur la même ligne.
    expect((await app.supabaseAdmin.from("product_matches").insert([line(91, true), line(92, null)])).error).toBeNull();
    expect((await shoppingRows(id)).filter((row) => row.rank >= 90).map((row) => row.brand_shop)).toEqual([true, null]);
  });
});
