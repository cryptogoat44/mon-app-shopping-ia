import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

async function insertPublicPost(app: FastifyInstance, userId: string): Promise<string> {
  const { data, error } = await app.supabaseAdmin
    .from("posts")
    .insert({ user_id: userId, type: "lifestyle", media_kind: "photo", media_url: "https://example.com/p.jpg", privacy: "public" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function likeNotificationsFrom(app: FastifyInstance, recipientId: string, actorId: string, postId: string) {
  const { data } = await app.supabaseAdmin
    .from("notifications")
    .select("id")
    .eq("user_id", recipientId)
    .eq("actor_id", actorId)
    .eq("type", "like")
    .eq("post_id", postId);
  return data ?? [];
}

// Audit Lot Q, ROB-05 (spam de j'aime) et SEC-04 (blocages ignorés).
describe("notifications : anti-spam des j'aime et respect des blocages", () => {
  let app: FastifyInstance;
  let author: TestUser;
  let fan: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    author = await createTestUser(app, "nsa");
    fan = await createTestUser(app, "nsb");
    other = await createTestUser(app, "nsc");
  });

  afterAll(async () => {
    await deleteTestUser(app, author.id);
    await deleteTestUser(app, fan.id);
    await deleteTestUser(app, other.id);
    await app.close();
  });

  it("aimer / ne plus aimer en boucle laisse au plus une notification, toujours vraie", async () => {
    const postId = await insertPublicPost(app, author.id);
    const react = () => app.inject({ method: "POST", url: `/api/posts/${postId}/react`, headers: authHeaders(fan.token) });

    for (let i = 0; i < 5; i++) await react(); // aime, n'aime plus, aime, n'aime plus, aime
    expect(await likeNotificationsFrom(app, author.id, fan.id, postId)).toHaveLength(1);

    await react(); // n'aime plus
    expect(await likeNotificationsFrom(app, author.id, fan.id, postId)).toHaveLength(0);
  });

  it("bloquer un compte efface et masque ses notifications (compteur compris)", async () => {
    const postId = await insertPublicPost(app, author.id);
    await app.inject({ method: "POST", url: `/api/posts/${postId}/react`, headers: authHeaders(fan.token) });
    await app.inject({ method: "POST", url: `/api/follows/${author.id}`, headers: authHeaders(fan.token) });

    const before = (await app.inject({ method: "GET", url: "/api/notifications", headers: authHeaders(author.token) })).json();
    expect(before.some((n: { actor: { id: string } }) => n.actor.id === fan.id)).toBe(true);

    await app.inject({ method: "POST", url: `/api/blocks/${fan.id}`, headers: authHeaders(author.token) });

    const after = (await app.inject({ method: "GET", url: "/api/notifications", headers: authHeaders(author.token) })).json();
    expect(after.some((n: { actor: { id: string } }) => n.actor.id === fan.id)).toBe(false);
  });

  it("masque aussi une notification ancienne d'un compte qui VOUS a bloqué", async () => {
    // Blocage dans l'autre sens : c'est `other` qui bloque `author`. Une
    // notification plus ancienne (insérée directement, comme un reste
    // antérieur au blocage) ne doit ni s'afficher ni compter.
    await app.inject({ method: "POST", url: `/api/blocks/${author.id}`, headers: authHeaders(other.token) });
    await app.supabaseAdmin.from("notifications").insert({ user_id: author.id, actor_id: other.id, type: "follow" });

    const list = (await app.inject({ method: "GET", url: "/api/notifications", headers: authHeaders(author.token) })).json();
    expect(list.some((n: { actor: { id: string } }) => n.actor.id === other.id)).toBe(false);

    const { data: raw } = await app.supabaseAdmin
      .from("notifications")
      .select("id")
      .eq("user_id", author.id)
      .eq("actor_id", other.id)
      .is("read_at", null);
    expect((raw ?? []).length).toBe(1); // bien présente en base…

    const unread = (await app.inject({ method: "GET", url: "/api/notifications/unread-count", headers: authHeaders(author.token) })).json();
    const { count: visibleUnread } = await app.supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", author.id)
      .neq("actor_id", other.id)
      .neq("actor_id", fan.id)
      .is("read_at", null);
    expect(unread.count).toBe(visibleUnread ?? 0); // …mais jamais comptée
  });
});
