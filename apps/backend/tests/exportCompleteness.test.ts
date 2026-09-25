import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { LEGAL_DOCUMENT_VERSIONS } from "@monapp/shared-types";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

// Chaque section de données personnelles que l'export doit contenir — et
// qu'on remplit ci-dessous avant d'exporter. Une section ajoutée à l'export
// sans être ajoutée ici (ou l'inverse) fait échouer le test.
const NON_EMPTY_SECTIONS = [
  "productSearches",
  "productMatches",
  "vaultItems",
  "wishlistItems",
  "posts",
  "postTaggedPieces",
  "reactionsGiven",
  "followers",
  "following",
  "blockedAccounts",
  "reportsSubmitted",
  "comments",
  "notifications",
  "affiliateClicks",
  "consents",
  "dataExportRequests",
] as const;

// Audit Lot Q, SEC-01 : l'export oubliait Envies, blocages, signalements,
// notifications, j'aime, demandes d'export, et le contexte des clics.
describe("export RGPD complet", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let friend: TestUser;
  let stranger: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "exa");
    friend = await createTestUser(app, "exb");
    stranger = await createTestUser(app, "exc");

    // Abonnements dans les deux sens (+ notification "follow" reçue).
    await app.inject({ method: "POST", url: `/api/follows/${user.id}`, headers: authHeaders(friend.token) });
    await app.inject({ method: "POST", url: `/api/follows/${friend.id}`, headers: authHeaders(user.token) });

    // Recherche + résultat (insérés directement : aucun appel SerpApi).
    const { data: search } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: user.id, source_url: "https://www.tiktok.com/@x/video/1", source_platform: "tiktok", method: "oembed", status: "completed" })
      .select("id")
      .single();
    const { data: match } = await app.supabaseAdmin
      .from("product_matches")
      .insert({ search_id: search!.id, rank: 1, product_name: "Sac", image_url: "https://example.com/a.jpg", merchant_url: "https://example.com/p" })
      .select("id")
      .single();
    await app.supabaseAdmin.from("affiliate_links").insert({ product_match_id: match!.id, network: "direct", affiliate_url: "https://example.com/p" });

    // Clic marchand avec contexte.
    await app.inject({
      method: "POST",
      url: `/api/product-matches/${match!.id}/click`,
      headers: { ...authHeaders(user.token), "user-agent": "test-agent" },
      payload: { context: "result" },
    });

    // Publication avec la pièce taguée.
    const post = buildMultipart(
      { type: "lifestyle", privacy: "public", taggedPieces: JSON.stringify([{ productMatchId: match!.id }]) },
      { fieldname: "file", filename: "a.png", contentType: "image/png", data: PNG }
    );
    await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(user.token), ...post.headers }, payload: post.payload });

    // J'aime donné sur la publication d'un ami.
    const friendPost = buildMultipart({ type: "lifestyle", privacy: "public" }, { fieldname: "file", filename: "b.png", contentType: "image/png", data: PNG });
    const friendPostId = (
      await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(friend.token), ...friendPost.headers }, payload: friendPost.payload })
    ).json().id;
    await app.inject({ method: "POST", url: `/api/posts/${friendPostId}/react`, headers: authHeaders(user.token) });
    // Commentaire sur la publication de l'ami (Lot F).
    await app.inject({ method: "POST", url: `/api/posts/${friendPostId}/comments`, headers: authHeaders(user.token), payload: { body: "Superbe" } });

    // Vault, Envie, blocage, signalement, consentement.
    await app.supabaseAdmin.from("vault_items").insert({ user_id: user.id, title: "Montre", image_url: "https://example.com/m.jpg", category: "watches" });
    await app.inject({ method: "POST", url: "/api/wishlist", headers: authHeaders(user.token), payload: { title: "Envie", imageUrl: "https://example.com/e.jpg" } });
    await app.inject({ method: "POST", url: `/api/blocks/${stranger.id}`, headers: authHeaders(user.token) });
    await app.inject({ method: "POST", url: "/api/reports", headers: authHeaders(user.token), payload: { targetType: "user", targetId: stranger.id, reason: "spam" } });
    await app.inject({ method: "POST", url: "/api/consents", headers: authHeaders(user.token), payload: { consents: [{ type: "terms", version: LEGAL_DOCUMENT_VERSIONS.terms }] } });

    // Un premier export, pour que le second contienne cette demande.
    await app.inject({ method: "GET", url: "/api/me/export", headers: authHeaders(user.token) });
  });

  afterAll(async () => {
    await deleteTestUser(app, user.id);
    await deleteTestUser(app, friend.id);
    await deleteTestUser(app, stranger.id);
    await app.close();
  });

  it("contient chaque catégorie de données personnelles", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/export", headers: authHeaders(user.token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.profile.id).toBe(user.id);
    for (const section of NON_EMPTY_SECTIONS) {
      expect(Array.isArray(body[section]), section).toBe(true);
      expect(body[section].length, section).toBeGreaterThan(0);
    }
    expect(Array.isArray(body.affiliateConversions)).toBe(true);
  });

  it("inclut le contexte et le navigateur des clics marchands", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/me/export", headers: authHeaders(user.token) })).json();
    expect(body.affiliateClicks[0].context).toBe("result");
    expect(body.affiliateClicks[0].user_agent).toBe("test-agent");
  });

  it("inclut la version des documents acceptés", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/me/export", headers: authHeaders(user.token) })).json();
    expect(body.consents[0].document_version).toBe(LEGAL_DOCUMENT_VERSIONS.terms);
  });

  it("ne contient que les données de l'utilisateur lui-même", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/me/export", headers: authHeaders(user.token) })).json();
    for (const n of body.notifications) expect(n.user_id).toBe(user.id);
    for (const r of body.reportsSubmitted) expect(r.reporter_id).toBe(user.id);
    for (const w of body.wishlistItems) expect(w.user_id).toBe(user.id);
    for (const p of body.posts) expect(p.user_id).toBe(user.id);
  });
});
