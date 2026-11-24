import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Crée une recherche complète avec un product_match et son affiliate_link —
// le mobile doit pouvoir ouvrir le lien marchand dès la réponse de
// recherche, sans appel supplémentaire au moment du clic (voir
// correctif-lien-web-2 : l'ancien flux attendait cet appel avant d'ouvrir
// le lien, ce qui cassait l'ouverture synchrone sur le web).
async function createSearchWithMatch(
  app: FastifyInstance,
  userId: string,
  options?: { withAffiliateLink?: boolean }
) {
  const { data: search, error: searchError } = await app.supabaseAdmin
    .from("product_searches")
    .insert({
      user_id: userId,
      source_url: "https://example.com/video",
      source_platform: "tiktok",
      method: "oembed",
      status: "completed",
    })
    .select("id")
    .single();
  if (searchError || !search) throw searchError ?? new Error("Échec de création de la recherche de test.");

  const { data: match, error: matchError } = await app.supabaseAdmin
    .from("product_matches")
    .insert({
      search_id: search.id,
      rank: 1,
      product_name: "Sac de test",
      image_url: "https://example.com/sac.jpg",
      merchant_url: "https://marchand.example.com/sac",
    })
    .select("id")
    .single();
  if (matchError || !match) throw matchError ?? new Error("Échec de création du product_match de test.");

  let affiliateUrl: string | null = null;
  if (options?.withAffiliateLink !== false) {
    const { data: link, error: linkError } = await app.supabaseAdmin
      .from("affiliate_links")
      .insert({ product_match_id: match.id, network: "direct", affiliate_url: "https://marchand.example.com/sac?aff=1" })
      .select("affiliate_url")
      .single();
    if (linkError || !link) throw linkError ?? new Error("Échec de création de l'affiliate_link de test.");
    affiliateUrl = link.affiliate_url as string;
  }

  return { searchId: search.id as string, matchId: match.id as string, affiliateUrl };
}

describe("search results carry the affiliate link", () => {
  let app: FastifyInstance;
  let owner: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    owner = await createTestUser(app, "srchaf");
  });

  afterAll(async () => {
    await deleteTestUser(app, owner.id);
    await app.close();
  });

  it("includes affiliateUrl on each match of GET /api/searches/:id", async () => {
    const fixture = await createSearchWithMatch(app, owner.id);

    const res = await app.inject({
      method: "GET",
      url: `/api/searches/${fixture.searchId}`,
      headers: authHeaders(owner.token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].affiliateUrl).toBe(fixture.affiliateUrl);
  });

  it("includes affiliateUrl on the recent-searches list (GET /api/searches)", async () => {
    const fixture = await createSearchWithMatch(app, owner.id);

    const res = await app.inject({
      method: "GET",
      url: "/api/searches?limit=20",
      headers: authHeaders(owner.token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; matches: { affiliateUrl: string }[] }[];
    const entry = body.find((s) => s.id === fixture.searchId);
    expect(entry?.matches[0]?.affiliateUrl).toBe(fixture.affiliateUrl);
  });

  it("falls back to merchant_url when a match has no affiliate_link row", async () => {
    const fixture = await createSearchWithMatch(app, owner.id, { withAffiliateLink: false });

    const res = await app.inject({
      method: "GET",
      url: `/api/searches/${fixture.searchId}`,
      headers: authHeaders(owner.token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matches[0].affiliateUrl).toBe("https://marchand.example.com/sac");
  });
});

// Audit Lot Q, ROB-04 : une recherche réussie dont les rangs ne commencent
// pas à 1 (premier résultat Google filtré car réseau social) disparaissait
// de « Récemment spottées ».
describe("recherches récentes : meilleur rang existant", () => {
  let app: FastifyInstance;
  let owner: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    owner = await createTestUser(app, "srank");
  });

  afterAll(async () => {
    await deleteTestUser(app, owner.id);
    await app.close();
  });

  it("garde une recherche sans rang 1, avec son meilleur résultat", async () => {
    const { data: search } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: owner.id, source_url: "https://example.com/video", source_platform: "tiktok", method: "oembed", status: "completed" })
      .select("id")
      .single();
    await app.supabaseAdmin.from("product_matches").insert([
      { search_id: search!.id, rank: 4, product_name: "Moins bon", image_url: "https://example.com/b.jpg", merchant_url: "https://example.com/b" },
      { search_id: search!.id, rank: 2, product_name: "Meilleur", image_url: "https://example.com/a.jpg", merchant_url: "https://example.com/a" },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/searches", headers: authHeaders(owner.token) });
    expect(res.statusCode).toBe(200);
    const entry = (res.json() as { id: string; matches: { productName: string }[] }[]).find((s) => s.id === search!.id);
    expect(entry).toBeDefined();
    expect(entry!.matches).toHaveLength(1);
    expect(entry!.matches[0]!.productName).toBe("Meilleur");
  });
});

// Retours du build 2, lot « historique » : `before` et `q` sur la vraie base
// (PostgREST : lectures par identifiant et dates avec fuseau). Les mêmes règles, cas par
// cas, sans base : historiqueRecherches.test.ts.
describe("historique : `before` et `q` sur la vraie base", () => {
  let app: FastifyInstance;
  let owner: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    owner = await createTestUser(app, "shist");
    other = await createTestUser(app, "shist2");
  });

  afterAll(async () => {
    await deleteTestUser(app, owner.id);
    await deleteTestUser(app, other.id);
    await app.close();
  });

  async function searchWith(userId: string, createdAt: string, names: string[]): Promise<string> {
    const { data: search } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: userId, source_url: null, source_platform: "photo", method: "manual_screenshot", status: "completed", created_at: createdAt })
      .select("id")
      .single();
    await app.supabaseAdmin.from("product_matches").insert(
      names.map((name, index) => ({ search_id: search!.id, rank: index + 1, product_name: name, image_url: `https://example.com/${index}.jpg`, merchant_url: `https://example.com/p/${index}` }))
    );
    return search!.id as string;
  }

  it("permis : la suite plus ancienne que `before`, et la proposition qui correspond à `q` ; refusé : la recherche d'un autre membre, un joker tapé", async () => {
    const older = await searchWith(owner.id, "2026-11-20T10:00:00.000001+00:00", ["Pull bleu", "Veste en daim (100%), marron"]);
    const newer = await searchWith(owner.id, "2026-11-21T10:00:00.000002+00:00", ["Sac noir", "Ceinture"]);
    await searchWith(other.id, "2026-11-21T11:00:00Z", ["Veste en daim de quelqu'un d'autre"]);
    const get = (params: Record<string, string>) =>
      app.inject({ method: "GET", url: `/api/searches?${new URLSearchParams(params).toString()}`, headers: authHeaders(owner.token) });

    const first = (await get({ limit: "20" })).json() as { id: string; createdAt: string }[];
    expect(first.map((search) => search.id)).toEqual([newer, older]);
    const next = (await get({ limit: "20", before: first[0]!.createdAt })).json() as { id: string }[];
    expect(next.map((search) => search.id)).toEqual([older]);
    expect((await get({ limit: "20", before: first[1]!.createdAt })).json()).toEqual([]);

    const found = (await get({ q: "daim (100%)", limit: "20" })).json() as { id: string; matches: { productName: string }[] }[];
    expect(found.map((search) => search.id)).toEqual([older]);
    expect(found[0]!.matches[0]!.productName).toBe("Veste en daim (100%), marron");
    for (const q of ["%%", "**", "a,b(c)"]) expect((await get({ q, limit: "20" })).json(), q).toEqual([]);
    expect((await get({ q: "a" })).statusCode).toBe(400);
  });
});
