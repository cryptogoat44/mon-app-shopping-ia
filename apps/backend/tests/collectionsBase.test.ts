import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import type { CollectionSummary, KeepSharedItemResponse, SharedCollectionPage, SharedCollectionsList, WishlistItem } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { downloadPublicImage } from "../src/lib/publicImage.js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Collections d'envies (lot collections, migration 0033), sur la vraie base
// de développement (spotto-dev-2, sur le Mac du fondateur) : le parcours
// complet avec les vraies tables, leurs contraintes (nom de 1 à 40
// caractères, envie et collection au même membre), les suppressions en
// cascade et la copie des images dans le vrai stockage. Sauté tant que 0033
// n'est pas appliquée sur la base des tests. Le téléchargement de l'image
// d'une envie est simulé : aucun site extérieur n'est appelé.
vi.mock("../src/lib/publicImage.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/publicImage.js")>();
  return { ...original, downloadPublicImage: vi.fn() };
});
const downloadMock = vi.mocked(downloadPublicImage);

const service = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const probe = await service.from("collections").select("id").limit(0);
const migrated = !probe.error;
const messagesMigrated = !(await service.from("messages").select("id").limit(0)).error;
const OUR_STORAGE = `${env.SUPABASE_URL}/storage/v1/object/public/post-media/`;
const MERCHANT_IMAGE = "https://images.marchand.test/sac.jpg";

describe.skipIf(!migrated)("collections d'envies, sur la base de développement (0033)", () => {
  let app: FastifyInstance;
  let alice: TestUser; // amie de Bruno (chacun suit l'autre)
  let bruno: TestUser;
  let chloe: TestUser; // suit Alice, sans retour
  let wish: WishlistItem;
  let gifts: CollectionSummary;
  let itemId = "";

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  const ownFiles = async (user: TestUser) => {
    const { data, error } = await app.supabaseAdmin.storage.from("post-media").list(user.id, { limit: 100 });
    if (error) throw error;
    return (data ?? []).map((file) => file.name);
  };

  beforeAll(async () => {
    app = await buildTestApp();
    [alice, bruno, chloe] = await Promise.all([createTestUser(app, "cola"), createTestUser(app, "colb"), createTestUser(app, "colc")]);
    await request(alice, "POST", `/api/follows/${bruno.id}`);
    await request(bruno, "POST", `/api/follows/${alice.id}`);
    await request(chloe, "POST", `/api/follows/${alice.id}`);
    downloadMock.mockResolvedValue(await sharp({ create: { width: 400, height: 500, channels: 3, background: "#806040" } }).jpeg().toBuffer());
    wish = (
      await request(alice, "POST", "/api/wishlist", {
        title: "Sac cabas",
        imageUrl: MERCHANT_IMAGE,
        reference: "Note privée",
        merchantName: "Marchand",
        merchantUrl: "https://marchand.test/sac",
        priceMin: 129,
        currency: "EUR",
      })
    ).json();
  }, 60_000);

  afterAll(async () => {
    for (const user of [alice, bruno, chloe]) if (user) await deleteTestUser(app, user.id);
    await app.close();
  });

  it("les collections sont disponibles ; une nouvelle collection est privée", async () => {
    expect((await request(alice, "GET", "/api/collections/status")).json()).toEqual({ enabled: true });
    const res = await request(alice, "POST", "/api/collections", { name: "Cadeaux" });
    expect(res.statusCode).toBe(201);
    gifts = res.json();
    expect(gifts).toMatchObject({ name: "Cadeaux", visibility: "private", itemCount: 0 });
    expect((await request(alice, "PUT", `/api/wishlist/${wish.id}/collections`, { collectionIds: [gifts.id] })).json()).toEqual({ collectionIds: [gifts.id] });
    expect((await request(bruno, "GET", `/api/collections/${gifts.id}/shared`)).statusCode).toBe(404);
    expect((await request(bruno, "GET", `/api/users/${alice.id}/collections`)).json()).toEqual({ collections: [] });
    expect(await ownFiles(alice)).toEqual([]);
  });

  it("« Mes amis » : copie de l'image dans notre stockage ; un ami la voit, les autres non", async () => {
    expect((await request(alice, "PATCH", `/api/collections/${gifts.id}`, { visibility: "friends" })).json()).toMatchObject({ visibility: "friends", itemCount: 1 });
    expect((await ownFiles(alice)).length).toBe(2);
    const res = await request(bruno, "GET", `/api/collections/${gifts.id}/shared`);
    expect(res.statusCode).toBe(200);
    const page: SharedCollectionPage = res.json();
    expect(page.items[0]!.imageUrl!.startsWith(`${OUR_STORAGE}${alice.id}/`)).toBe(true);
    expect(page.items[0]).toMatchObject({ title: "Sac cabas", priceMin: 129, merchantUrl: "https://marchand.test/sac" });
    expect(res.body).not.toContain("images.marchand.test");
    expect(res.body).not.toContain("Note privée");
    itemId = page.items[0]!.id;
    const list: SharedCollectionsList = (await request(bruno, "GET", `/api/users/${alice.id}/collections`)).json();
    expect(list.collections).toEqual([{ id: gifts.id, name: "Cadeaux", itemCount: 1, coverUrl: page.items[0]!.imageThumbUrl }]);
    // Chloé suit Alice sans retour : rien.
    expect((await request(chloe, "GET", `/api/collections/${gifts.id}/shared`)).statusCode).toBe(404);
    expect((await request(chloe, "GET", `/api/users/${alice.id}/collections`)).json()).toEqual({ collections: [] });
  });

  it("« Garder » : l'envie entre dans les Envies de Bruno, une seule fois", async () => {
    const kept = await request(bruno, "POST", `/api/collection-items/${itemId}/keep`);
    expect(kept.statusCode).toBe(201);
    const body: KeepSharedItemResponse = kept.json();
    expect(body.item).toMatchObject({ title: "Sac cabas", imageUrl: MERCHANT_IMAGE, merchantUrl: "https://marchand.test/sac", reference: null, productMatchId: null });
    expect((await request(bruno, "POST", `/api/collection-items/${itemId}/keep`)).json().alreadyKept).toBe(true);
  });

  it.skipIf(!messagesMigrated)("« En parler » : l'envie jointe à un message pour Alice", async () => {
    const res = await request(bruno, "POST", "/api/messages", { recipientId: alice.id, collectionItemId: itemId, text: "Il est beau" });
    expect(res.statusCode).toBe(201);
    expect(res.json().message.wish.imageUrl.startsWith(`${OUR_STORAGE}${bruno.id}/`)).toBe(true);
  });

  it("blocage : la collection disparaît, et revient au déblocage", async () => {
    expect((await request(alice, "POST", `/api/blocks/${bruno.id}`)).statusCode).toBe(204);
    expect((await request(bruno, "GET", `/api/collections/${gifts.id}/shared`)).statusCode).toBe(404);
    expect((await request(alice, "DELETE", `/api/blocks/${bruno.id}`)).statusCode).toBe(204);
    // Le blocage a retiré les abonnements : de nouveau amis pour la suite.
    await request(alice, "POST", `/api/follows/${bruno.id}`);
    await request(bruno, "POST", `/api/follows/${alice.id}`);
    expect((await request(bruno, "GET", `/api/collections/${gifts.id}/shared`)).statusCode).toBe(200);
  });

  it("contraintes de la base : nom de 1 à 40 caractères, envie et collection du même membre", async () => {
    const tooLong = await app.supabaseAdmin.from("collections").insert({ user_id: alice.id, name: "a".repeat(41) });
    expect(tooLong.error?.code).toBe("23514");
    const brunoWish = (await request(bruno, "GET", "/api/wishlist")).json().items[0] as WishlistItem;
    const mixed = await app.supabaseAdmin.from("collection_items").insert({ collection_id: gifts.id, wishlist_item_id: brunoWish.id, user_id: alice.id });
    expect(mixed.error?.code).toBe("23503");
    const twice = await app.supabaseAdmin.from("collection_items").insert({ collection_id: gifts.id, wishlist_item_id: wish.id, user_id: alice.id });
    expect(twice.error?.code).toBe("23505");
  });

  it("export : collections et envies rangées", async () => {
    const body = (await request(alice, "GET", "/api/me/export")).json();
    expect(body.collections).toEqual([expect.objectContaining({ id: gifts.id, name: "Cadeaux", visibility: "friends" })]);
    expect(body.collectionItems).toEqual([expect.objectContaining({ collection_id: gifts.id, wishlist_item_id: wish.id, wishlist_item_title: "Sac cabas" })]);
  });

  it("les tables restent fermées au public (aucune règle d'accès)", async () => {
    const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    for (const table of ["collections", "collection_items", "collection_image_copies"]) {
      const { data } = await anon.from(table).select("*").limit(1);
      expect(data ?? []).toEqual([]);
    }
  });

  it("revenue privée : copie effacée ; collection supprimée : l'envie reste", async () => {
    await request(alice, "PATCH", `/api/collections/${gifts.id}`, { visibility: "private" });
    expect(await ownFiles(alice)).toEqual([]);
    const { count: copies } = await app.supabaseAdmin.from("collection_image_copies").select("wishlist_item_id", { count: "exact", head: true }).eq("user_id", alice.id);
    expect(copies).toBe(0);
    expect((await request(alice, "DELETE", `/api/collections/${gifts.id}`)).statusCode).toBe(204);
    expect((await request(alice, "GET", `/api/wishlist/${wish.id}`)).statusCode).toBe(200);
    const { count: items } = await app.supabaseAdmin.from("collection_items").select("id", { count: "exact", head: true }).eq("user_id", alice.id);
    expect(items).toBe(0);
  });

  it("envie supprimée : elle quitte ses collections, et sa copie est effacée", async () => {
    const shared: CollectionSummary = (await request(alice, "POST", "/api/collections", { name: "Partagée" })).json();
    await request(alice, "PATCH", `/api/collections/${shared.id}`, { visibility: "friends" });
    await request(alice, "PUT", `/api/wishlist/${wish.id}/collections`, { collectionIds: [shared.id] });
    expect((await ownFiles(alice)).length).toBe(2);
    expect((await request(alice, "DELETE", `/api/wishlist/${wish.id}`)).statusCode).toBe(204);
    expect(await ownFiles(alice)).toEqual([]);
    const { count } = await app.supabaseAdmin.from("collection_items").select("id", { count: "exact", head: true }).eq("collection_id", shared.id);
    expect(count).toBe(0);
  });

  it("suppression du compte : ses collections partent avec lui", async () => {
    const dora = await createTestUser(app, "cold");
    const created: CollectionSummary = (await request(dora, "POST", "/api/collections", { name: "À supprimer" })).json();
    expect((await request(dora, "DELETE", "/api/me", { confirmation: "SUPPRIMER" })).statusCode).toBe(204);
    const { count } = await app.supabaseAdmin.from("collections").select("id", { count: "exact", head: true }).eq("id", created.id);
    expect(count).toBe(0);
  });
});
