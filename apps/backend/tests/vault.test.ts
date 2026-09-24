import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

async function insertVaultItem(
  app: FastifyInstance,
  userId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const { data, error } = await app.supabaseAdmin
    .from("vault_items")
    .insert({
      user_id: userId,
      title: "vault test item",
      image_url: "https://example.com/fake.jpg",
      category: "other",
      verified: false,
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

// La création (POST /api/vault) exige un corps multipart et n'est pas
// couverte ici — les objets de test sont insérés directement en base,
// comme pour les publications. Lecture, mise à jour, suppression et
// pagination passent bien par les routes HTTP réelles.
describe("vault", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let other: TestUser;
  const itemIds: string[] = [];

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "vlta");
    other = await createTestUser(app, "vltb");
  });

  afterAll(async () => {
    if (itemIds.length) await app.supabaseAdmin.from("vault_items").delete().in("id", itemIds);
    await deleteTestUser(app, user.id);
    await deleteTestUser(app, other.id);
    await app.close();
  });

  it("returns an empty page with totalCount 0", async () => {
    const res = await app.inject({ method: "GET", url: "/api/vault", headers: authHeaders(user.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], nextCursor: null, totalCount: 0 });
  });

  it("paginates by cursor, newest first, no duplicates, correct totalCount", async () => {
    const baseTime = Date.now();
    for (let i = 0; i < 26; i++) {
      const id = await insertVaultItem(app, user.id, {
        title: `vault-${i}`,
        created_at: new Date(baseTime + i * 1000).toISOString(),
      });
      itemIds.push(id);
    }

    const page1 = await app.inject({ method: "GET", url: "/api/vault", headers: authHeaders(user.token) });
    const body1 = page1.json();
    expect(body1.items).toHaveLength(24);
    expect(body1.items[0].title).toBe("vault-25");
    expect(body1.totalCount).toBe(26);
    expect(typeof body1.nextCursor).toBe("string");

    const page2 = await app.inject({
      method: "GET",
      url: `/api/vault?cursor=${encodeURIComponent(body1.nextCursor)}`,
      headers: authHeaders(user.token),
    });
    const body2 = page2.json();
    expect(body2.items).toHaveLength(2);
    expect(body2.nextCursor).toBeNull();
    // Pas de vrai total au-delà de la première page (verrait uniquement les
    // objets restants après le curseur, pas le vrai total) — le bug qui a
    // motivé ce test précis a été trouvé lors de l'implémentation initiale.
    expect(body2.totalCount).toBeNull();

    const titles = new Set([...body1.items, ...body2.items].map((i: { title: string }) => i.title));
    expect(titles.size).toBe(26);
  });

  it("rejects an invalid cursor", async () => {
    const res = await app.inject({ method: "GET", url: "/api/vault?cursor=nope", headers: authHeaders(user.token) });
    expect(res.statusCode).toBe(400);
  });

  it("never returns another user's vault item by id", async () => {
    const otherId = await insertVaultItem(app, other.id, { title: "not yours" });
    itemIds.push(otherId);

    const res = await app.inject({
      method: "GET",
      url: `/api/vault/${otherId}`,
      headers: authHeaders(user.token),
    });
    expect(res.statusCode).toBe(404);
  });

  it("updates title/category", async () => {
    const id = await insertVaultItem(app, user.id, { title: "before" });
    itemIds.push(id);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/vault/${id}`,
      headers: authHeaders(user.token),
      payload: { title: "after", category: "watches" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("after");
    expect(res.json().category).toBe("watches");
    expect(res.json()).not.toHaveProperty("privacy");
  });

  // Décision 5 du Lot Q : le Vault est toujours entièrement privé.
  it("Vault toujours privé : aucune confidentialité par pièce, et un autre utilisateur n'accède à rien", async () => {
    const id = await insertVaultItem(app, user.id, { title: "privée" });
    itemIds.push(id);

    // Un ancien client qui envoie encore « privacy » : ignoré (corps vide → 400).
    const onlyPrivacy = await app.inject({ method: "PATCH", url: `/api/vault/${id}`, headers: authHeaders(user.token), payload: { privacy: "public" } });
    expect(onlyPrivacy.statusCode).toBe(400);

    const asOther = (method: "GET" | "PATCH" | "DELETE" | "POST", url: string, payload?: object) =>
      app.inject({ method, url, headers: authHeaders(other.token), ...(payload ? { payload } : {}) });
    expect((await asOther("GET", `/api/vault/${id}`)).statusCode).toBe(404);
    expect((await asOther("PATCH", `/api/vault/${id}`, { title: "piratée" })).statusCode).toBe(404);
    expect((await asOther("DELETE", `/api/vault/${id}`)).statusCode).toBe(404);
    expect((await asOther("POST", `/api/vault/${id}/photo`)).statusCode).toBe(404);
    const list = await asOther("GET", "/api/vault");
    expect(list.json().items.map((item: { id: string }) => item.id)).not.toContain(id);

    const still = await app.inject({ method: "GET", url: `/api/vault/${id}`, headers: authHeaders(user.token) });
    expect(still.json().title).toBe("privée");
  });

  it("rejects an update from a non-owner", async () => {
    const id = await insertVaultItem(app, user.id, { title: "owned" });
    itemIds.push(id);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/vault/${id}`,
      headers: authHeaders(other.token),
      payload: { title: "hijacked" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("deletes an item", async () => {
    const id = await insertVaultItem(app, user.id, { title: "to delete" });

    const res = await app.inject({ method: "DELETE", url: `/api/vault/${id}`, headers: authHeaders(user.token) });
    expect(res.statusCode).toBe(204);

    const getRes = await app.inject({ method: "GET", url: `/api/vault/${id}`, headers: authHeaders(user.token) });
    expect(getRes.statusCode).toBe(404);
  });
});
