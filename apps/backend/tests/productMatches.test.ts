import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Crée une recherche + un résultat + un lien affilié pour l'utilisateur
// donné — la route de clic a besoin de ces trois lignes pour exister.
async function createMatchFixture(app: FastifyInstance, userId: string) {
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

  const { data: link, error: linkError } = await app.supabaseAdmin
    .from("affiliate_links")
    .insert({ product_match_id: match.id, network: "direct", affiliate_url: "https://marchand.example.com/sac?aff=1" })
    .select("id, affiliate_url")
    .single();
  if (linkError || !link) throw linkError ?? new Error("Échec de création de l'affiliate_link de test.");

  return { searchId: search.id as string, matchId: match.id as string, affiliateUrl: link.affiliate_url as string };
}

describe("product-matches click", () => {
  let app: FastifyInstance;
  let owner: TestUser;
  let other: TestUser;
  let fixture: { searchId: string; matchId: string; affiliateUrl: string };

  beforeAll(async () => {
    app = await buildTestApp();
    owner = await createTestUser(app, "pmown");
    other = await createTestUser(app, "pmoth");
    fixture = await createMatchFixture(app, owner.id);
  });

  afterAll(async () => {
    await deleteTestUser(app, owner.id);
    await deleteTestUser(app, other.id);
    await app.close();
  });

  it("rejects a request with no token", async () => {
    const res = await app.inject({ method: "POST", url: `/api/product-matches/${fixture.matchId}/click` });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid context", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/product-matches/${fixture.matchId}/click`,
      headers: authHeaders(owner.token),
      payload: { context: "not_a_real_context" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for a match belonging to another user's search", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/product-matches/${fixture.matchId}/click`,
      headers: authHeaders(other.token),
      payload: { context: "result" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("records a valid click with its context and returns the affiliate URL", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/product-matches/${fixture.matchId}/click`,
      headers: authHeaders(owner.token),
      payload: { context: "result" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: fixture.affiliateUrl });

    const { data } = await app.supabaseAdmin
      .from("affiliate_clicks")
      .select("*")
      .eq("user_id", owner.id)
      .order("clicked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(data?.context).toBe("result");
    expect(data).not.toHaveProperty("ip_hash");
  });

  it("accepts a click without a context", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/product-matches/${fixture.matchId}/click`,
      headers: authHeaders(owner.token),
    });
    expect(res.statusCode).toBe(200);
  });
});
