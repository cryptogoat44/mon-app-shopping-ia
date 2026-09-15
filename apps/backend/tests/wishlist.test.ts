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
