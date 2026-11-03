import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

async function insertWishlistItem(
  app: FastifyInstance,
  userId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const { data, error } = await app.supabaseAdmin
    .from("wishlist_items")
    .insert({
      user_id: userId,
      title: "wishlist test item",
      image_url: "https://example.com/fake.jpg",
      currency: "EUR",
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

describe("wishlist", () => {
  let app: FastifyInstance;
  let user: TestUser;
  const itemIds: string[] = [];

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "wsha");
  });

  afterAll(async () => {
    if (itemIds.length) await app.supabaseAdmin.from("wishlist_items").delete().in("id", itemIds);
    await deleteTestUser(app, user.id);
    await app.close();
  });

  it("rejects a request with no token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/wishlist" });
    expect(res.statusCode).toBe(401);
  });

  it("returns an empty page", async () => {
    const res = await app.inject({ method: "GET", url: "/api/wishlist", headers: authHeaders(user.token) });
    expect(res.json()).toEqual({ items: [], nextCursor: null });
  });

  it("rejects an invalid body (missing title)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/wishlist",
      headers: authHeaders(user.token),
      payload: { imageUrl: "https://example.com/x.jpg" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates an item and returns it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/wishlist",
      headers: authHeaders(user.token),
      payload: { title: "Created via test", imageUrl: "https://example.com/created.jpg", priceMin: 199 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe("Created via test");
    expect(body.priceMin).toBe(199);
    itemIds.push(body.id);
  });

  it("paginates by cursor, newest first, no duplicates", async () => {
    const baseTime = Date.now();
    for (let i = 0; i < 25; i++) {
      const id = await insertWishlistItem(app, user.id, {
        title: `wish-${i}`,
        created_at: new Date(baseTime + i * 1000).toISOString(),
      });
      itemIds.push(id);
    }

    const page1 = await app.inject({ method: "GET", url: "/api/wishlist", headers: authHeaders(user.token) });
    const body1 = page1.json();
    expect(body1.items).toHaveLength(24);
    expect(typeof body1.nextCursor).toBe("string");

    const page2 = await app.inject({
      method: "GET",
      url: `/api/wishlist?cursor=${encodeURIComponent(body1.nextCursor)}`,
      headers: authHeaders(user.token),
    });
    const body2 = page2.json();
    expect(body2.nextCursor).toBeNull();

    const titles = new Set([...body1.items, ...body2.items].map((i: { title: string }) => i.title));
    // 25 seeded + 1 created via the route above = 26 unique total.
    expect(titles.size).toBe(26);
    expect(body1.items.length + body2.items.length).toBe(26);
  });

  it("rejects an invalid cursor", async () => {
    const res = await app.inject({ method: "GET", url: "/api/wishlist?cursor=nope", headers: authHeaders(user.token) });
    expect(res.statusCode).toBe(400);
  });

  it("deletes an item", async () => {
    const id = await insertWishlistItem(app, user.id, { title: "to delete" });

    const res = await app.inject({ method: "DELETE", url: `/api/wishlist/${id}`, headers: authHeaders(user.token) });
    expect(res.statusCode).toBe(204);

    const { data } = await app.supabaseAdmin.from("wishlist_items").select("id").eq("id", id).maybeSingle();
    expect(data).toBeNull();
  });
});

// Liens d'une envie : http et https seulement (lib/validation.ts, isWebUrl),
// réponse 400 « invalid_body » inchangée. Une envie venue d'un résultat du
// Spotter : seulement un résultat d'une de SES recherches (même règle que
// POST /api/vault), et ses liens sont repris de la base, jamais de la requête
// (la copie que l'app envoie alors n'est pas lue).
describe("envie : liens web seulement, résultat d'une de ses propres recherches", () => {
  let app: FastifyInstance;
  let owner: TestUser;
  let other: TestUser;
  let ownMatchId = "";
  let otherMatchId = "";
  const MATCH_IMAGE = "https://encrypted-tbn.example/vignette-robe.jpg";
  const MATCH_MERCHANT = "https://marchand.example/robe";
  const OTHER_MERCHANT = "https://marchand.example/autre-robe";
  const REFUSED_TITLE = "Lien refusé";

  const postWish = (user: TestUser, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/wishlist", headers: authHeaders(user.token), payload });

  /** Les envies de `user` portant ce titre, lues directement en base. */
  async function storedWishes(user: TestUser, title: string) {
    const { data, error } = await app.supabaseAdmin
      .from("wishlist_items")
      .select("id, image_url, merchant_url, product_match_id")
      .eq("user_id", user.id)
      .eq("title", title);
    expect(error).toBeNull();
    return data ?? [];
  }

  /** Une recherche de `user` et son résultat, avec ces liens (insérés directement : aucun appel SerpApi). */
  async function insertMatch(user: TestUser, links: { imageUrl: string; merchantUrl: string }): Promise<string> {
    const { data: search, error: searchError } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: user.id, source_url: null, source_platform: "photo", method: "manual_screenshot", status: "completed" })
      .select("id")
      .single();
    if (searchError || !search) throw searchError ?? new Error("Recherche non créée");
    const { data: match, error } = await app.supabaseAdmin
      .from("product_matches")
      .insert({ search_id: search.id, rank: 1, product_name: "Robe noire", image_url: links.imageUrl, merchant_url: links.merchantUrl })
      .select("id")
      .single();
    if (error || !match) throw error ?? new Error("Résultat non créé");
    return match.id as string;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    [owner, other] = await Promise.all([createTestUser(app, "wlo"), createTestUser(app, "wlx")]);
    ownMatchId = await insertMatch(owner, { imageUrl: MATCH_IMAGE, merchantUrl: MATCH_MERCHANT });
    otherMatchId = await insertMatch(other, { imageUrl: MATCH_IMAGE, merchantUrl: OTHER_MERCHANT });
  });

  afterAll(async () => {
    // Recherches, résultats et envies sont supprimés avec les comptes (cascade).
    for (const user of [owner, other].filter(Boolean)) await deleteTestUser(app, user.id);
    await app.close();
  });

  it.each([
    ["imageUrl", "javascript:alert(1)"],
    ["imageUrl", "data:text/html,<script>alert(1)</script>"],
    ["merchantUrl", "javascript:alert(document.cookie)"],
    ["merchantUrl", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
    ["merchantUrl", "JAVASCRIPT:alert(1)"],
    ["merchantUrl", " javascript:alert(1)"],
    ["merchantUrl", "java\tscript:alert(1)"],
    ["merchantUrl", "//marchand.example/robe"],
  ] as const)("%s = %j : refusé (400 invalid_body), rien n'est rangé", async (field, link) => {
    const res = await postWish(owner, {
      title: REFUSED_TITLE,
      imageUrl: "https://images.example/robe.jpg",
      merchantUrl: "https://marchand.example/robe",
      [field]: link,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_body" });
    expect(await storedWishes(owner, REFUSED_TITLE)).toEqual([]);
  });

  it("la même envie avec des liens http et https ordinaires est rangée telle quelle", async () => {
    const imageUrl = "HTTP://IMAGES.EXAMPLE/robe.jpg";
    const merchantUrl = "https://marchand.example:8443/robe?taille=38&couleur=noir";
    const res = await postWish(owner, { title: REFUSED_TITLE, imageUrl, merchantUrl });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ imageUrl, merchantUrl, productMatchId: null });
    expect(await storedWishes(owner, REFUSED_TITLE)).toEqual([
      { id: res.json().id, image_url: imageUrl, merchant_url: merchantUrl, product_match_id: null },
    ]);
  });

  it("un résultat de la recherche d'une autre personne est refusé (404), rien n'est rangé", async () => {
    const title = "Résultat d'une autre personne";
    const payload = { title, imageUrl: MATCH_IMAGE, merchantUrl: OTHER_MERCHANT, productMatchId: otherMatchId };
    const refused = await postWish(owner, payload);
    expect(refused.statusCode).toBe(404);
    expect(refused.json()).toMatchObject({ error: "product_match_not_found" });
    expect(await storedWishes(owner, title)).toEqual([]);

    // Un identifiant qui ne désigne aucun résultat : la même réponse.
    const unknown = await postWish(owner, { ...payload, productMatchId: randomUUID() });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ error: "product_match_not_found" });
    expect(await storedWishes(owner, title)).toEqual([]);

    // La même demande, par la personne dont c'est la recherche : acceptée (le refus venait bien de la propriété).
    const accepted = await postWish(other, payload);
    expect(accepted.statusCode).toBe(200);
    expect(await storedWishes(other, title)).toEqual([
      { id: accepted.json().id, image_url: MATCH_IMAGE, merchant_url: OTHER_MERCHANT, product_match_id: otherMatchId },
    ]);
  });

  it("un résultat d'une de ses recherches est accepté ; ses liens viennent de la base, jamais de la requête", async () => {
    const title = "Robe noire";
    // Ce que l'app envoie : les liens du résultat, tels quels.
    const kept = await postWish(owner, { title, imageUrl: MATCH_IMAGE, merchantUrl: MATCH_MERCHANT, productMatchId: ownMatchId });
    expect(kept.statusCode).toBe(200);
    expect(kept.json()).toMatchObject({ productMatchId: ownMatchId, imageUrl: MATCH_IMAGE, merchantUrl: MATCH_MERCHANT });

    // D'autres liens (http et https valides) avec le même résultat : la même envie, avec les liens du résultat.
    const tampered = await postWish(owner, {
      title,
      imageUrl: "https://ailleurs.example/image.jpg",
      merchantUrl: "https://ailleurs.example/boutique",
      productMatchId: ownMatchId,
    });
    expect(tampered.statusCode).toBe(200);
    expect(tampered.json()).toMatchObject({ id: kept.json().id, imageUrl: MATCH_IMAGE, merchantUrl: MATCH_MERCHANT });
    expect(await storedWishes(owner, title)).toEqual([
      { id: kept.json().id, image_url: MATCH_IMAGE, merchant_url: MATCH_MERCHANT, product_match_id: ownMatchId },
    ]);
  });

  it("avec un résultat d'une de ses recherches, la copie des liens n'est pas lue : « Garder » marche même au-delà de 2 048 caractères", async () => {
    // Liens d'un résultat tels que la recherche les a rangés : http et https ordinaires, mais très longs (paramètres de suivi).
    const longImage = `https://encrypted-tbn.example/vignette-longue.jpg?suivi=${"i".repeat(2100)}`;
    const longMerchant = `https://marchand.example/robe-longue?suivi=${"m".repeat(2100)}`;
    const longMatchId = await insertMatch(owner, { imageUrl: longImage, merchantUrl: longMerchant });
    const title = "Robe aux longs liens";

    // Ce que l'app envoie : les liens du résultat, tels quels.
    const kept = await postWish(owner, { title, imageUrl: longImage, merchantUrl: longMerchant, productMatchId: longMatchId });
    expect(kept.statusCode).toBe(200);
    expect(kept.json()).toMatchObject({ productMatchId: longMatchId, imageUrl: longImage, merchantUrl: longMerchant });

    // Une copie inutilisable (ancien client) : pas lue non plus ; la même envie garde les liens du résultat.
    const unusable = await postWish(owner, { title, imageUrl: "x".repeat(3000), productMatchId: longMatchId });
    expect(unusable.statusCode).toBe(200);
    expect(unusable.json()).toMatchObject({ id: kept.json().id, imageUrl: longImage, merchantUrl: longMerchant });
    expect(await storedWishes(owner, title)).toEqual([
      { id: kept.json().id, image_url: longImage, merchant_url: longMerchant, product_match_id: longMatchId },
    ]);

    // Sans résultat, ces liens seraient rangés tels quels : au-delà de 2 048 caractères, refusés (400), rien n'est rangé.
    const typedTitle = "Liens trop longs, sans résultat";
    const typed = await postWish(owner, { title: typedTitle, imageUrl: longImage, merchantUrl: longMerchant });
    expect(typed.statusCode).toBe(400);
    expect(typed.json()).toMatchObject({ error: "invalid_body" });
    expect(await storedWishes(owner, typedTitle)).toEqual([]);
  });
});
