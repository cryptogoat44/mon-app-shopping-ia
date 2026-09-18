import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  authHeaders,
  buildMultipart,
  buildTestApp,
  createTestUser,
  deleteTestUser,
  type TestUser,
} from "./helpers.js";

function objectPathFromPublicUrl(imageUrl: string): string {
  const path = new URL(imageUrl).pathname.split("/vault-media/")[1];
  if (!path) throw new Error("URL de stockage inattendue dans le test.");
  return path;
}

describe("vault storage ownership", () => {
  let app: FastifyInstance;
  let victim: TestUser;
  let attacker: TestUser;
  let victimImageUrl: string;
  const itemIds: string[] = [];

  beforeAll(async () => {
    app = await buildTestApp();
    victim = await createTestUser(app, "vsva");
    attacker = await createTestUser(app, "vsvb");

    const { payload, headers } = buildMultipart(
      { title: "photo de la victime", category: "other" },
      { fieldname: "file", filename: "victim.jpg", contentType: "image/jpeg", data: Buffer.from("fake-image-bytes") }
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/vault",
      headers: { ...authHeaders(victim.token), ...headers },
      payload,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    victimImageUrl = body.imageUrl;
    itemIds.push(body.id);
  });

  afterAll(async () => {
    if (itemIds.length) await app.supabaseAdmin.from("vault_items").delete().in("id", itemIds);
    await deleteTestUser(app, victim.id);
    await deleteTestUser(app, attacker.id);
    await app.close();
  });

  it("refuses to create a vault item with another user's storage URL", async () => {
    const { payload, headers } = buildMultipart({ title: "vol", category: "other", imageUrl: victimImageUrl });
    const res = await app.inject({
      method: "POST",
      url: "/api/vault",
      headers: { ...authHeaders(attacker.token), ...headers },
      payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses to create a vault item with an external URL", async () => {
    const { payload, headers } = buildMultipart({
      title: "externe",
      category: "other",
      imageUrl: "https://evil.example.com/photo.jpg",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/vault",
      headers: { ...authHeaders(attacker.token), ...headers },
      payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it("deletes its own file normally", async () => {
    const { payload, headers } = buildMultipart(
      { title: "à supprimer", category: "other" },
      { fieldname: "file", filename: "todelete.jpg", contentType: "image/jpeg", data: Buffer.from("bytes-to-delete") }
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/vault",
      headers: { ...authHeaders(victim.token), ...headers },
      payload,
    });
    const item = created.json();

    const del = await app.inject({
      method: "DELETE",
      url: `/api/vault/${item.id}`,
      headers: authHeaders(victim.token),
    });
    expect(del.statusCode).toBe(204);

    const path = objectPathFromPublicUrl(item.imageUrl);
    const { data: remaining } = await app.supabaseAdmin.storage.from("vault-media").list(victim.id);
    expect((remaining ?? []).some((f) => `${victim.id}/${f.name}` === path)).toBe(false);
  });

  it("does not delete another user's file, even from a tampered row", async () => {
    // Simule une ligne corrompue (donnée héritée d'avant le correctif, ou
    // une future régression) : impossible à créer via l'API désormais,
    // donc insérée directement en base pour tester le filet de sécurité de
    // la suppression elle-même, indépendamment de comment la ligne existe.
    const { data: tampered, error } = await app.supabaseAdmin
      .from("vault_items")
      .insert({
        user_id: attacker.id,
        title: "ligne corrompue",
        image_url: victimImageUrl,
        category: "other",
        privacy: "private",
        verified: false,
      })
      .select("id")
      .single();
    expect(error).toBeNull();

    const del = await app.inject({
      method: "DELETE",
      url: `/api/vault/${tampered!.id as string}`,
      headers: authHeaders(attacker.token),
    });
    expect(del.statusCode).toBe(204);

    const path = objectPathFromPublicUrl(victimImageUrl);
    const { data: remaining } = await app.supabaseAdmin.storage.from("vault-media").list(victim.id);
    expect((remaining ?? []).some((f) => `${victim.id}/${f.name}` === path)).toBe(true);
  });
});
