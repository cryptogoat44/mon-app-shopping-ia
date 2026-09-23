import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Crée une recherche + un résultat + un lien affilié pour l'utilisateur
// donné — même fixture que productMatches.test.ts, réutilisée ici pour
// disposer d'un product_match "taguable".
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
      merchant_name: "Marchand Test",
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

async function insertVaultItem(app: FastifyInstance, userId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await app.supabaseAdmin
    .from("vault_items")
    .insert({
      user_id: userId,
      title: "vault test item",
      image_url: "https://example.com/fake.jpg",
      category: "other",
      privacy: "private",
      verified: false,
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Échec de création de l'objet du vault de test.");
  return data.id as string;
}

describe("POST /api/posts — pièces taguées (étape 1.E)", () => {
  let app: FastifyInstance;
  let owner: TestUser;
  let stranger: TestUser;
  let ownVaultItemId: string;
  let ownPurchaseVaultItemId: string;
  let strangerVaultItemId: string;
  let match: { searchId: string; matchId: string; affiliateUrl: string };
  let strangerMatch: { searchId: string; matchId: string; affiliateUrl: string };
  const postIds: string[] = [];

  beforeAll(async () => {
    app = await buildTestApp();
    owner = await createTestUser(app, "tage");
    stranger = await createTestUser(app, "tags");

    match = await createMatchFixture(app, owner.id);
    strangerMatch = await createMatchFixture(app, stranger.id);
    ownVaultItemId = await insertVaultItem(app, owner.id, { title: "Sac privé", privacy: "private" });
    ownPurchaseVaultItemId = await insertVaultItem(app, owner.id, { title: "Objet acheté" });
    strangerVaultItemId = await insertVaultItem(app, stranger.id, { title: "Pas à toi" });
  });

  afterAll(async () => {
    if (postIds.length) await app.supabaseAdmin.from("posts").delete().in("id", postIds);
    await deleteTestUser(app, owner.id);
    await deleteTestUser(app, stranger.id);
    await app.close();
  });

  function purchasePayload(vaultItemId: string, taggedPieces?: unknown) {
    const fields: Record<string, string> = { type: "purchase", vaultItemId };
    if (taggedPieces !== undefined) fields.taggedPieces = JSON.stringify(taggedPieces);
    return buildMultipart(fields);
  }

  it("tague une pièce issue d'une recherche récente (product_match) et l'hydrate avec son lien affilié", async () => {
    const { payload, headers } = purchasePayload(ownPurchaseVaultItemId, [{ productMatchId: match.matchId }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { ...headers, ...authHeaders(owner.token) },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    postIds.push(body.id);
    expect(body.taggedPieces).toHaveLength(1);
    expect(body.taggedPieces[0]).toMatchObject({
      productName: "Sac de test",
      merchantName: "Marchand Test",
      merchantUrl: match.affiliateUrl,
      productMatchId: match.matchId,
    });
  });

  it("tague une pièce issue du Vault : titre/image seulement, jamais de lien marchand", async () => {
    const { payload, headers } = purchasePayload(ownPurchaseVaultItemId, [{ vaultItemId: ownVaultItemId }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { ...headers, ...authHeaders(owner.token) },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    postIds.push(body.id);
    expect(body.taggedPieces).toHaveLength(1);
    expect(body.taggedPieces[0]).toMatchObject({
      productName: "Sac privé",
      merchantName: null,
      merchantUrl: null,
      productMatchId: null,
    });
  });

  it("refuse de taguer un product_match appartenant à la recherche d'un autre utilisateur", async () => {
    const { payload, headers } = purchasePayload(ownPurchaseVaultItemId, [{ productMatchId: strangerMatch.matchId }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { ...headers, ...authHeaders(owner.token) },
      payload,
    });
    expect(res.statusCode).toBe(404);
  });

  it("refuse de taguer un objet du Vault d'un autre utilisateur", async () => {
    const { payload, headers } = purchasePayload(ownPurchaseVaultItemId, [{ vaultItemId: strangerVaultItemId }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { ...headers, ...authHeaders(owner.token) },
      payload,
    });
    expect(res.statusCode).toBe(404);
  });

  it("n'insère aucun tag si une seule pièce du lot échoue (tout ou rien)", async () => {
    const { payload, headers } = purchasePayload(ownPurchaseVaultItemId, [
      { productMatchId: match.matchId },
      { vaultItemId: strangerVaultItemId },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { ...headers, ...authHeaders(owner.token) },
      payload,
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejette un JSON invalide pour taggedPieces", async () => {
    const { payload, headers } = buildMultipart({
      type: "purchase",
      vaultItemId: ownPurchaseVaultItemId,
      taggedPieces: "{not json",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { ...headers, ...authHeaders(owner.token) },
      payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejette plus de 10 pièces taguées", async () => {
    const tooMany = Array.from({ length: 11 }, () => ({ productMatchId: match.matchId }));
    const { payload, headers } = purchasePayload(ownPurchaseVaultItemId, tooMany);
    const res = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { ...headers, ...authHeaders(owner.token) },
      payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it("dédoublonne une même pièce taguée deux fois dans la même publication", async () => {
    const { payload, headers } = purchasePayload(ownPurchaseVaultItemId, [
      { productMatchId: match.matchId },
      { productMatchId: match.matchId },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { ...headers, ...authHeaders(owner.token) },
      payload,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    postIds.push(body.id);
    expect(body.taggedPieces).toHaveLength(1);
  });

  it("ne casse pas une publication sans pièce taguée (champ absent)", async () => {
    const { payload, headers } = purchasePayload(ownPurchaseVaultItemId);
    const res = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { ...headers, ...authHeaders(owner.token) },
      payload,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    postIds.push(body.id);
    expect(body.taggedPieces).toEqual([]);
  });
});
