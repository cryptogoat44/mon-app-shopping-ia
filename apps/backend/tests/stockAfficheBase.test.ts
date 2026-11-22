import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

// Stock affiché (migration 0056) sur la VRAIE base de développement
// (spotto-dev-2, sur le Mac du fondateur) : ce que seule une vraie base
// prouve — le oui ou le non de Google Lens écrit sur la ligne de la
// proposition, rien quand Google ne dit rien, et la relecture qui le rend à
// l'app. Sans la colonne (0056 absente), chaque test est passé (« skip »).
// Aucun appel réel : Google Lens est simulé, voie C coupée (ni IA ni Google
// Shopping). Un seul compte, effacé à la fin avec ses recherches. Les règles,
// cas par cas, sans base : boutiquesEnsuiteRoute.test.ts (« stock affiché »).
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, VOIE_C_ENABLED: false, VOIE_C_AI_ENABLED: false } };
});
vi.mock("../src/services/visualSearch.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/visualSearch.js")>();
  return { ...original, searchProductsByImageUrl: vi.fn() };
});
vi.mock("../src/lib/searchCapacity.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/searchCapacity.js")>();
  return { ...original, reserveSearch: vi.fn(), releaseReservation: vi.fn() };
});

import { searchProductsByImageUrl, type VisualMatch } from "../src/services/visualSearch.js";
import { releaseReservation, reserveSearch } from "../src/lib/searchCapacity.js";
import { resetStockColumnProbe } from "../src/lib/stockColumn.js";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

const lensMock = vi.mocked(searchProductsByImageUrl);

const lensMatch = (rank: number, inStock?: boolean): VisualMatch => ({
  rank,
  productName: `Veste test ${rank}`,
  imageUrl: `https://images.lens.example/stock-${rank}.jpg`,
  imageHdUrl: null,
  merchantName: "Marchand Exemple",
  merchantUrl: `https://marchand.example/stock-${rank}`,
  priceValue: 40 + rank,
  currency: "€",
  ...(inStock === undefined ? {} : { inStock }),
});

const probeColumn = async (app: FastifyInstance) => !(await app.supabaseAdmin.from("product_matches").select("in_stock").limit(0)).error;

describe("stock affiché : le oui ou le non de Google rangé avec la proposition, sur la base (0056)", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let photo: Buffer;
  let has0056 = false;

  beforeAll(async () => {
    app = await buildTestApp();
    has0056 = await probeColumn(app);
    if (!has0056) return;
    user = await createTestUser(app, "stk");
    photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#305070" } }).jpeg().toBuffer();
  });

  afterAll(async () => {
    if (user) {
      await app.supabaseAdmin.from("product_searches").delete().eq("user_id", user.id);
      await deleteTestUser(app, user.id);
    }
    await app.close();
  });

  beforeEach(() => {
    resetStockColumnProbe();
    let reservation = 9_500;
    vi.mocked(reserveSearch).mockReset();
    vi.mocked(reserveSearch).mockImplementation(async () => ({ allowed: true, reservationId: (reservation += 1) }));
    vi.mocked(releaseReservation).mockReset();
    vi.mocked(releaseReservation).mockResolvedValue(true);
  });

  async function launchedSearch(matches: VisualMatch[]): Promise<{ id: string; body: { matches: { inStock?: boolean }[] } }> {
    lensMock.mockReset();
    lensMock.mockResolvedValue({
      matches,
      measure: { removedIncomplete: 0, removedSocial: 0, removedProfessional: 0, removedDuplicates: 0, received: matches.length, kept: matches.length, keptWithPrice: matches.length, keptOtherCurrency: 0, distinctSites: matches.length, sections: ["visual_matches"], googleState: null },
      addedRanks: [],
      statusCode: 200,
    });
    const prepared = await app.inject({ method: "POST", url: "/api/searches/prepare", headers: authHeaders(user.token), payload: {} });
    expect(prepared.statusCode).toBe(200);
    const id = z.object({ id: z.string() }).parse(prepared.json()).id;
    const mp = buildMultipart({}, { fieldname: "file", filename: "photo.jpg", contentType: "image/jpeg", data: photo });
    const res = await app.inject({ method: "POST", url: `/api/searches/${id}/run`, headers: { ...authHeaders(user.token), ...mp.headers, "accept-language": "fr-FR" }, payload: mp.payload });
    expect(res.statusCode).toBe(200);
    return { id, body: res.json() };
  }

  async function stockRows(id: string) {
    const { data, error } = await app.supabaseAdmin.from("product_matches").select("rank, in_stock").eq("search_id", id).order("rank");
    expect(error).toBeNull();
    return (data as { rank: number; in_stock: boolean | null }[]).map((row) => row.in_stock);
  }

  const stockOf = (body: { matches: { inStock?: boolean }[] }) => body.matches.map((match) => ("inStock" in match ? match.inStock : "inconnu"));

  it("permis : en stock, épuisée et inconnue rangées telles quelles (vide pour l'inconnue), et rendues à l'app au lancement comme à la relecture", async (context) => {
    if (!has0056) context.skip();
    const { id, body } = await launchedSearch([lensMatch(1, true), lensMatch(2, false), lensMatch(3)]);
    expect(await stockRows(id)).toEqual([true, false, null]);
    const reread = (await app.inject({ method: "GET", url: `/api/searches/${id}`, headers: authHeaders(user.token) })).json();
    for (const answer of [body, reread]) expect(stockOf(answer)).toEqual([true, false, "inconnu"]);
  });

  it("refusé : Google ne dit rien du stock — aucune ligne n'a de oui ni de non, aucune proposition n'en renvoie", async (context) => {
    if (!has0056) context.skip();
    const { id, body } = await launchedSearch([lensMatch(1), lensMatch(2)]);
    expect(await stockRows(id)).toEqual([null, null]);
    expect(stockOf(body)).toEqual(["inconnu", "inconnu"]);
  });
});
