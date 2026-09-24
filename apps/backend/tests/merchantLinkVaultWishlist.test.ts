import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// « Voir chez le marchand » depuis le Vault et les Envies (Lot S2) : le
// serveur fournit le lien marchand (et affilié) de la pièce identifiée
// d'origine, et rien pour une pièce ajoutée à la main.
describe("lien marchand d'une pièce du Vault et d'une Envie", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let matchId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "mlv");
    const { data: search } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: user.id, source_url: null, source_platform: "photo", method: "manual_screenshot", status: "completed" })
      .select("id")
      .single();
    const { data: match } = await app.supabaseAdmin
      .from("product_matches")
      .insert({
        search_id: search!.id,
        rank: 1,
        product_name: "Veste en daim",
        image_url: "https://encrypted-tbn.example/vignette.jpg",
        merchant_url: "https://marchand.example/veste",
        merchant_name: "Marchand",
      })
      .select("id")
      .single();
    matchId = match!.id;
    await app.supabaseAdmin.from("affiliate_links").insert({ product_match_id: matchId, network: "direct", affiliate_url: "https://affilie.example/veste" });
  });

  afterAll(async () => {
    await deleteTestUser(app, user.id);
    await app.close();
  });

  it("pièce du Vault venant du Spotter : nom du marchand, lien marchand et lien affilié", async () => {
    const mp = buildMultipart({ title: "Veste", category: "clothing", productMatchId: matchId });
    const created = await app.inject({ method: "POST", url: "/api/vault", headers: { ...authHeaders(user.token), ...mp.headers }, payload: mp.payload });
    expect(created.statusCode).toBe(200);
    const res = await app.inject({ method: "GET", url: `/api/vault/${created.json().id}`, headers: authHeaders(user.token) });
    expect(res.json()).toMatchObject({
      merchantName: "Marchand",
      merchantUrl: "https://marchand.example/veste",
      affiliateUrl: "https://affilie.example/veste",
    });
  });

  it("pièce du Vault ajoutée à la main : aucun lien", async () => {
    const photo = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#888" } }).png().toBuffer();
    const mp = buildMultipart({ title: "Montre", category: "watches" }, { fieldname: "file", filename: "m.png", contentType: "image/png", data: photo });
    const created = await app.inject({ method: "POST", url: "/api/vault", headers: { ...authHeaders(user.token), ...mp.headers }, payload: mp.payload });
    const res = await app.inject({ method: "GET", url: `/api/vault/${created.json().id}`, headers: authHeaders(user.token) });
    expect(res.json()).toMatchObject({ merchantName: null, merchantUrl: null, affiliateUrl: null });
  });

  it("Envies : lien affilié pour une pièce du Spotter, aucun pour une Envie sans pièce d'origine", async () => {
    await app.inject({
      method: "POST",
      url: "/api/wishlist",
      headers: authHeaders(user.token),
      payload: { title: "Veste", imageUrl: "https://encrypted-tbn.example/vignette.jpg", merchantUrl: "https://marchand.example/veste", productMatchId: matchId },
    });
    await app.inject({
      method: "POST",
      url: "/api/wishlist",
      headers: authHeaders(user.token),
      payload: { title: "Sans origine", imageUrl: "https://encrypted-tbn.example/autre.jpg" },
    });
    const res = await app.inject({ method: "GET", url: "/api/wishlist", headers: authHeaders(user.token) });
    const byTitle = Object.fromEntries(res.json().items.map((item: { title: string }) => [item.title, item]));
    expect(byTitle["Veste"]).toMatchObject({ merchantUrl: "https://marchand.example/veste", affiliateUrl: "https://affilie.example/veste" });
    expect(byTitle["Sans origine"]).toMatchObject({ merchantUrl: null, affiliateUrl: null });
  });
});
