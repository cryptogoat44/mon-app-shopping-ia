import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import type { FriendVaultPage, FriendWishPage, Profile, UserProfile, WishlistItem } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { downloadPublicImage } from "../src/lib/publicImage.js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Étagères des amis (migration 0058), sur la vraie base de développement
// (spotto-dev-2, sur le Mac du fondateur) : ce que seule une vraie base prouve
// — les réglages allumés d'office mais fermés tant que l'information n'a pas
// été vue, une collection « Privée » qui garde ses envies, les vrais
// abonnements dans les deux sens,
// un vrai blocage, la copie d'une image dans le vrai stockage faite à
// l'ouverture (jamais à l'allumage) et effacée à l'extinction. Sans la
// migration 0058, seul le test « sans 0058 » tourne (aucune étagère, réglage
// « indisponible »), les autres sont passés (« skip »). Le téléchargement de
// l'image d'une envie est simulé : aucun site extérieur n'est appelé.
// Les règles, cas par cas : etageresAmis.test.ts (hors base).
vi.mock("../src/lib/publicImage.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/publicImage.js")>();
  return { ...original, downloadPublicImage: vi.fn() };
});
const downloadMock = vi.mocked(downloadPublicImage);

const service = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const migrated = !(await service.from("profiles").select("wishes_shown_to_friends, vault_shown_to_friends, friend_shelves_informed_at").limit(0)).error;
const collectionsMigrated = !(await service.from("collection_image_copies").select("wishlist_item_id").limit(0)).error;
const OUR_STORAGE = `${env.SUPABASE_URL}/storage/v1/object/public/post-media/`;
const MERCHANT_IMAGE = "https://images.marchand.test/sac.jpg";

describe("étagères des amis, sur la base de développement (0058)", () => {
  let app: FastifyInstance;
  let alice: TestUser; // montre ses étagères
  let bruno: TestUser; // ami d'Alice (chacun suit l'autre)
  let chloe: TestUser; // suit Alice, sans retour
  let wish: WishlistItem;

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  const ownFiles = async (user: TestUser) => {
    const { data, error } = await app.supabaseAdmin.storage.from("post-media").list(user.id, { limit: 100 });
    if (error) throw error;
    return (data ?? []).map((file) => file.name);
  };

  beforeAll(async () => {
    app = await buildTestApp();
    [alice, bruno, chloe] = await Promise.all([createTestUser(app, "eta"), createTestUser(app, "etb"), createTestUser(app, "etc")]);
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

  it("sans 0058 : aucune étagère annoncée, pages vides, réglage « indisponible »", async (context) => {
    if (migrated) return context.skip();
    expect("friendShelves" in ((await request(bruno, "GET", `/api/users/${alice.id}`)).json() as object)).toBe(false);
    expect((await request(bruno, "GET", `/api/users/${alice.id}/wishlist`)).json()).toEqual({ items: [], nextCursor: null });
    expect((await request(alice, "PUT", "/api/me/friend-shelves", { wishes: true })).statusCode).toBe(404);
  });

  it("allumés d'office, mais rien pour l'ami tant qu'Alice n'a pas vu l'information", async (context) => {
    if (!migrated) return context.skip();
    const me = (await request(alice, "GET", "/api/me")).json() as Profile;
    expect([me.showWishesToFriends, me.showVaultToFriends, me.friendShelvesInformed]).toEqual([true, true, false]);
    expect("friendShelves" in ((await request(bruno, "GET", `/api/users/${alice.id}`)).json() as object)).toBe(false);
    expect((await request(bruno, "GET", `/api/users/${alice.id}/wishlist`)).json()).toEqual({ items: [], nextCursor: null });
    expect((await request(bruno, "GET", `/api/users/${alice.id}/vault`)).json()).toEqual({ items: [], nextCursor: null });
  });

  it("information vue (« Compris ») : l'ami voit l'envie (copie faite à l'ouverture, jamais avant) ; le simple abonné, rien", async (context) => {
    if (!migrated || !collectionsMigrated) return context.skip();
    const before = await ownFiles(alice);
    expect((await request(alice, "PUT", "/api/me/friend-shelves", { informed: true })).statusCode).toBe(204);
    expect(((await request(alice, "GET", "/api/me")).json() as Profile).friendShelvesInformed).toBe(true);
    expect(await ownFiles(alice)).toEqual(before);
    expect(((await request(bruno, "GET", `/api/users/${alice.id}`)).json() as UserProfile).friendShelves).toEqual({ wishes: true, vault: true });
    const page = (await request(bruno, "GET", `/api/users/${alice.id}/wishlist`)).json() as FriendWishPage;
    expect(page.items.map((item) => item.id)).toEqual([wish.id]);
    expect(page.items[0]!.imageUrl?.startsWith(`${OUR_STORAGE}${alice.id}/`)).toBe(true);
    expect(page.items[0]!.collections).toEqual([]);
    expect(JSON.stringify(page)).not.toContain("Note privée");
    expect(JSON.stringify(page)).not.toContain(MERCHANT_IMAGE);
    expect((await ownFiles(alice)).length).toBe(before.length + 2);
    expect("friendShelves" in ((await request(chloe, "GET", `/api/users/${alice.id}`)).json() as object)).toBe(false);
    expect((await request(chloe, "GET", `/api/users/${alice.id}/wishlist`)).json()).toEqual({ items: [], nextCursor: null });
    expect((await request(chloe, "GET", `/api/users/${alice.id}/vault`)).json()).toEqual({ items: [], nextCursor: null });
  });

  it("un vrai blocage coupe l'accès aussitôt ; levé, l'accès revient", async (context) => {
    if (!migrated) return context.skip();
    expect((await request(alice, "POST", `/api/blocks/${bruno.id}`)).statusCode).toBeLessThan(300);
    expect((await request(bruno, "GET", `/api/users/${alice.id}/vault`)).json()).toEqual({ items: [], nextCursor: null } satisfies FriendVaultPage);
    expect((await request(bruno, "GET", `/api/users/${alice.id}/wishlist`)).json()).toEqual({ items: [], nextCursor: null });
    await request(alice, "DELETE", `/api/blocks/${bruno.id}`);
    // Un blocage retire les abonnements : il faut redevenir amis.
    await request(alice, "POST", `/api/follows/${bruno.id}`);
    await request(bruno, "POST", `/api/follows/${alice.id}`);
    expect(((await request(bruno, "GET", `/api/users/${alice.id}`)).json() as UserProfile).friendShelves).toMatchObject({ vault: true });
  });

  it("« Privée » reste privée : l'envie rangée dans une collection privée quitte l'étagère, son nom n'apparaît jamais ; « Mes amis » : visible, avec son nom", async (context) => {
    if (!migrated || !collectionsMigrated) return context.skip();
    const collection = (await request(alice, "POST", "/api/collections", { name: "Secret" })).json() as { id: string; visibility: string };
    expect(collection.visibility).toBe("private");
    expect((await request(alice, "PUT", `/api/wishlist/${wish.id}/collections`, { collectionIds: [collection.id] })).statusCode).toBe(200);
    const hidden = await request(bruno, "GET", `/api/users/${alice.id}/wishlist`);
    expect(hidden.json()).toEqual({ items: [], nextCursor: null });
    expect(hidden.body).not.toContain("Secret");
    expect((await request(alice, "PATCH", `/api/collections/${collection.id}`, { visibility: "friends" })).statusCode).toBe(200);
    expect(((await request(bruno, "GET", `/api/users/${alice.id}/wishlist`)).json() as FriendWishPage).items.map((item) => [item.id, item.collections])).toEqual([[wish.id, ["Secret"]]]);
    expect((await request(alice, "PUT", `/api/wishlist/${wish.id}/collections`, { collectionIds: [] })).statusCode).toBe(200);
    expect((await request(alice, "DELETE", `/api/collections/${collection.id}`)).statusCode).toBeLessThan(300);
  });

  it("modération : une envie d'une collection masquée et une pièce d'une publication masquée ne sont plus montrées ; rendues, elles reviennent", async (context) => {
    if (!migrated || !collectionsMigrated) return context.skip();
    const moderated = !(await service.from("collections").select("hidden_at").limit(0)).error;
    if (!moderated) return context.skip();
    // Envie : rangée dans une collection « Mes amis », que la modération masque.
    const collection = (await request(alice, "POST", "/api/collections", { name: "Hiver" })).json() as { id: string };
    expect((await request(alice, "PUT", `/api/wishlist/${wish.id}/collections`, { collectionIds: [collection.id] })).statusCode).toBe(200);
    expect((await request(alice, "PATCH", `/api/collections/${collection.id}`, { visibility: "friends" })).statusCode).toBe(200);
    expect(((await request(bruno, "GET", `/api/users/${alice.id}/wishlist`)).json() as FriendWishPage).items.map((item) => item.id)).toEqual([wish.id]);
    expect((await service.from("collections").update({ hidden_at: new Date().toISOString() }).eq("id", collection.id)).error).toBeNull();
    expect((await request(bruno, "GET", `/api/users/${alice.id}/wishlist`)).json()).toEqual({ items: [], nextCursor: null });
    expect((await service.from("collections").update({ hidden_at: null }).eq("id", collection.id)).error).toBeNull();
    expect(((await request(bruno, "GET", `/api/users/${alice.id}/wishlist`)).json() as FriendWishPage).items.map((item) => item.id)).toEqual([wish.id]);
    // Pièce du Vault : sa publication « achat » masquée par la modération.
    const piece = await service.from("vault_items").insert({ user_id: alice.id, title: "Veste", image_url: MERCHANT_IMAGE, category: "clothing" }).select("id").single();
    expect(piece.error).toBeNull();
    const post = await service.from("posts").insert({ user_id: alice.id, type: "purchase", vault_item_id: piece.data!.id, media_kind: "photo", media_url: MERCHANT_IMAGE }).select("id").single();
    expect(post.error).toBeNull();
    expect(((await request(bruno, "GET", `/api/users/${alice.id}/vault`)).json() as FriendVaultPage).items.map((item) => item.id)).toEqual([piece.data!.id]);
    expect((await service.from("posts").update({ hidden_at: new Date().toISOString() }).eq("id", post.data!.id)).error).toBeNull();
    expect((await request(bruno, "GET", `/api/users/${alice.id}/vault`)).json()).toEqual({ items: [], nextCursor: null });
    expect((await service.from("posts").update({ hidden_at: null }).eq("id", post.data!.id)).error).toBeNull();
    expect(((await request(bruno, "GET", `/api/users/${alice.id}/vault`)).json() as FriendVaultPage).items.map((item) => item.id)).toEqual([piece.data!.id]);
  });

  it("éteint : l'étagère se ferme et la copie de l'image est effacée du stockage", async (context) => {
    if (!migrated || !collectionsMigrated) return context.skip();
    expect((await request(alice, "PUT", "/api/me/friend-shelves", { wishes: false, vault: false })).statusCode).toBe(204);
    expect("friendShelves" in ((await request(bruno, "GET", `/api/users/${alice.id}`)).json() as object)).toBe(false);
    const copies = await app.supabaseAdmin.from("collection_image_copies").select("wishlist_item_id").eq("user_id", alice.id);
    expect(copies.error).toBeNull();
    expect(copies.data).toEqual([]);
  });
});
