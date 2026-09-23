import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// PNG 1×1 valide — le contenu importe peu, seul le type "image/png" compte.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

async function createVaultItemWithPhoto(app: FastifyInstance, user: TestUser): Promise<{ id: string; imageUrl: string }> {
  const mp = buildMultipart(
    { title: "Montre partagée", category: "watches" },
    { fieldname: "file", filename: "a.png", contentType: "image/png", data: PNG }
  );
  const res = await app.inject({
    method: "POST",
    url: "/api/vault",
    headers: { ...authHeaders(user.token), ...mp.headers },
    payload: mp.payload,
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function sharePurchase(app: FastifyInstance, user: TestUser, vaultItemId: string): Promise<string> {
  const mp = buildMultipart({ type: "purchase", vaultItemId, privacy: "public" });
  const res = await app.inject({
    method: "POST",
    url: "/api/posts",
    headers: { ...authHeaders(user.token), ...mp.headers },
    payload: mp.payload,
  });
  expect(res.statusCode).toBe(200);
  return res.json().id as string;
}

async function listVaultFiles(app: FastifyInstance, userId: string): Promise<string[]> {
  const { data } = await app.supabaseAdmin.storage.from("vault-media").list(userId);
  return (data ?? []).map((f) => f.name);
}

// Audit Lot Q, DON-01 : retirer du Vault un objet déjà partagé échouait
// toujours (500). Décision du fondateur : la publication "achat" est
// supprimée avec l'objet, ainsi que tout ce qui en dépend.
describe("retrait d'un objet du vault déjà partagé", () => {
  let app: FastifyInstance;
  let owner: TestUser;
  let friend: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    owner = await createTestUser(app, "vpda");
    friend = await createTestUser(app, "vpdb");
    await app.inject({ method: "POST", url: `/api/follows/${owner.id}`, headers: authHeaders(friend.token) });
  });

  afterAll(async () => {
    await deleteTestUser(app, owner.id);
    await deleteTestUser(app, friend.id);
    await app.close();
  });

  it("annonce le nombre de publications achat dans le détail de l'objet", async () => {
    const item = await createVaultItemWithPhoto(app, owner);

    const before = await app.inject({ method: "GET", url: `/api/vault/${item.id}`, headers: authHeaders(owner.token) });
    expect(before.json().purchasePostCount).toBe(0);

    await sharePurchase(app, owner, item.id);

    const after = await app.inject({ method: "GET", url: `/api/vault/${item.id}`, headers: authHeaders(owner.token) });
    expect(after.json().purchasePostCount).toBe(1);
  });

  it("supprime l'objet, sa publication achat, ses j'aime, notifications et fichier — sans toucher au reste", async () => {
    const item = await createVaultItemWithPhoto(app, owner);
    const purchasePostId = await sharePurchase(app, owner, item.id);

    // Une photo lifestyle qui tague ce même objet : elle doit survivre, seul
    // le tag disparaît.
    const lifestyle = buildMultipart(
      { type: "lifestyle", privacy: "public", taggedPieces: JSON.stringify([{ vaultItemId: item.id }]) },
      { fieldname: "file", filename: "b.png", contentType: "image/png", data: PNG }
    );
    const lifestyleRes = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { ...authHeaders(owner.token), ...lifestyle.headers },
      payload: lifestyle.payload,
    });
    const lifestylePostId = lifestyleRes.json().id as string;

    // Un ami aime la publication achat → un j'aime + une notification.
    const like = await app.inject({
      method: "POST",
      url: `/api/posts/${purchasePostId}/react`,
      headers: authHeaders(friend.token),
    });
    expect(like.statusCode).toBe(200);

    const fileName = item.imageUrl.split("/").pop()!;
    expect(await listVaultFiles(app, owner.id)).toContain(fileName);

    const del = await app.inject({ method: "DELETE", url: `/api/vault/${item.id}`, headers: authHeaders(owner.token) });
    expect(del.statusCode).toBe(204);

    const [{ data: vaultRow }, { data: purchasePost }, { data: reactions }, { data: notifications }, { data: lifestylePost }, { data: tags }] =
      await Promise.all([
        app.supabaseAdmin.from("vault_items").select("id").eq("id", item.id).maybeSingle(),
        app.supabaseAdmin.from("posts").select("id").eq("id", purchasePostId).maybeSingle(),
        app.supabaseAdmin.from("post_reactions").select("post_id").eq("post_id", purchasePostId),
        app.supabaseAdmin.from("notifications").select("id").eq("post_id", purchasePostId),
        app.supabaseAdmin.from("posts").select("id").eq("id", lifestylePostId).maybeSingle(),
        app.supabaseAdmin.from("post_tagged_pieces").select("id").eq("post_id", lifestylePostId),
      ]);

    expect(vaultRow).toBeNull();
    expect(purchasePost).toBeNull();
    expect(reactions).toEqual([]);
    expect(notifications).toEqual([]);
    expect(lifestylePost).not.toBeNull();
    expect(tags).toEqual([]);
    expect(await listVaultFiles(app, owner.id)).not.toContain(fileName);
  });

  it("ne supprime jamais l'objet ni la publication d'un autre utilisateur", async () => {
    const item = await createVaultItemWithPhoto(app, owner);
    const postId = await sharePurchase(app, owner, item.id);

    const del = await app.inject({ method: "DELETE", url: `/api/vault/${item.id}`, headers: authHeaders(friend.token) });
    expect(del.statusCode).toBe(404);

    const { data: post } = await app.supabaseAdmin.from("posts").select("id").eq("id", postId).maybeSingle();
    expect(post).not.toBeNull();
  });
});
