import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

// Audit Lot Q, SEC-02 et SEC-03 : toute entrée est validée, toute erreur
// respecte le contrat { error, message } en français — jamais un message
// interne brut.
describe("validation des entrées et filet d'erreurs", () => {
  let app: FastifyInstance;
  let user: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "val");
  });

  afterAll(async () => {
    await deleteTestUser(app, user.id);
    await app.close();
  });

  function expectContract(res: { statusCode: number; json: () => Record<string, unknown> }, status = 400) {
    expect(res.statusCode).toBe(status);
    const body = res.json();
    expect(typeof body.error).toBe("string");
    expect(typeof body.message).toBe("string");
    expect(body).not.toHaveProperty("statusCode");
  }

  it("un JSON mal formé sur une route réelle respecte le contrat d'erreur (filet d'erreurs actif)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/wishlist",
      headers: { ...authHeaders(user.token), "content-type": "application/json" },
      payload: "{pas du json",
    });
    expectContract(res);
    expect(res.json().message).toBe("Requête invalide.");
  });

  it("un signalement sans corps est refusé proprement (plus d'erreur 500)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/reports", headers: authHeaders(user.token) });
    expectContract(res);
  });

  it("un signalement avec une cible qui n'est pas un identifiant est refusé", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/reports",
      headers: authHeaders(user.token),
      payload: { targetType: "user", targetId: "pas-un-id", reason: "spam" },
    });
    expectContract(res);
  });

  it.each([
    ["GET", "/api/vault/pas-un-id"],
    ["DELETE", "/api/vault/pas-un-id"],
    ["GET", "/api/searches/pas-un-id"],
    ["DELETE", "/api/wishlist/pas-un-id"],
    ["POST", "/api/follows/pas-un-id"],
    ["DELETE", "/api/follows/pas-un-id"],
    ["POST", "/api/blocks/pas-un-id"],
    ["DELETE", "/api/blocks/pas-un-id"],
    ["POST", "/api/posts/pas-un-id/react"],
    ["POST", "/api/product-matches/pas-un-id/click"],
  ] as const)("%s %s : identifiant invalide refusé (400)", async (method, url) => {
    const res = await app.inject({ method, url, headers: authHeaders(user.token) });
    expectContract(res);
    expect(res.json().error).toBe("invalid_params");
  });

  it("un curseur de pagination invalide est refusé", async () => {
    for (const url of ["/api/feed?cursor=hier", "/api/vault?cursor=hier", "/api/wishlist?cursor=hier"]) {
      const res = await app.inject({ method: "GET", url, headers: authHeaders(user.token) });
      expectContract(res);
    }
  });

  it("une limite non numérique pour les recherches récentes est refusée", async () => {
    const res = await app.inject({ method: "GET", url: "/api/searches?limit=beaucoup", headers: authHeaders(user.token) });
    expectContract(res);
  });

  it("un contexte de clic inconnu est refusé", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/product-matches/00000000-0000-0000-0000-000000000000/click",
      headers: authHeaders(user.token),
      payload: { context: "ailleurs" },
    });
    expectContract(res);
  });

  it("un ajout au Vault avec un identifiant de produit fantaisiste est refusé", async () => {
    const mp = buildMultipart({ title: "Sac", category: "bags", productMatchId: "pas-un-id" });
    const res = await app.inject({ method: "POST", url: "/api/vault", headers: { ...authHeaders(user.token), ...mp.headers }, payload: mp.payload });
    expectContract(res);
  });

  it("« Je l'ai achetée » reste accepté même avec une imageUrl inutilisable (compatibilité ancien site)", async () => {
    const { data: search } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: user.id, source_url: "https://www.tiktok.com/@x/video/1", source_platform: "tiktok", method: "oembed", status: "completed" })
      .select("id")
      .single();
    const { data: match } = await app.supabaseAdmin
      .from("product_matches")
      .insert({ search_id: search!.id, rank: 1, product_name: "Sac", image_url: "https://example.com/sac.jpg", merchant_url: "https://example.com/p" })
      .select("id")
      .single();

    const mp = buildMultipart({ title: "Sac", category: "bags", productMatchId: match!.id, imageUrl: "x".repeat(3000) });
    const res = await app.inject({ method: "POST", url: "/api/vault", headers: { ...authHeaders(user.token), ...mp.headers }, payload: mp.payload });
    expect(res.statusCode).toBe(200);
    expect(res.json().imageUrl).toBe("https://example.com/sac.jpg");
  });

  it("une confidentialité inconnue est refusée au lieu d'être remplacée en silence", async () => {
    const mp = buildMultipart(
      { type: "lifestyle", privacy: "tout-le-monde" },
      { fieldname: "file", filename: "a.png", contentType: "image/png", data: PNG }
    );
    const res = await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(user.token), ...mp.headers }, payload: mp.payload });
    expectContract(res);
  });

  it("une publication achat avec un objet fantaisiste est refusée", async () => {
    const mp = buildMultipart({ type: "purchase", vaultItemId: "pas-un-id" });
    const res = await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(user.token), ...mp.headers }, payload: mp.payload });
    expectContract(res);
  });

  it("une modification vide d'un objet du Vault est refusée (400, pas 404)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/vault/00000000-0000-0000-0000-000000000000",
      headers: authHeaders(user.token),
      payload: {},
    });
    expectContract(res);
  });
});
