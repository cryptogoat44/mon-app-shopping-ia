import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

describe("notifications", () => {
  let app: FastifyInstance;
  let author: TestUser;
  let follower: TestUser;
  let postId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    author = await createTestUser(app, "ntfa");
    follower = await createTestUser(app, "ntff");

    const { data: post, error } = await app.supabaseAdmin
      .from("posts")
      .insert({
        user_id: author.id,
        type: "lifestyle",
        caption: "notif test post",
        media_kind: "photo",
        media_url: "https://example.com/fake.jpg",
        privacy: "public",
      })
      .select("id")
      .single();
    if (error) throw error;
    postId = post.id;
  });

  afterAll(async () => {
    await app.supabaseAdmin.from("posts").delete().eq("id", postId);
    await deleteTestUser(app, author.id);
    await deleteTestUser(app, follower.id);
    await app.close();
  });

  it("starts with zero unread notifications", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/notifications/unread-count",
      headers: authHeaders(author.token),
    });
    expect(res.json().count).toBe(0);
  });

  it("notifies the followee on a new follow", async () => {
    await app.inject({ method: "POST", url: `/api/follows/${author.id}`, headers: authHeaders(follower.token) });

    const list = await app.inject({ method: "GET", url: "/api/notifications", headers: authHeaders(author.token) });
    const notif = list.json().find((n: { type: string; actor: { id: string } }) => n.type === "follow" && n.actor.id === follower.id);
    expect(notif).toBeDefined();
    expect(notif.read).toBe(false);

    const count = await app.inject({
      method: "GET",
      url: "/api/notifications/unread-count",
      headers: authHeaders(author.token),
    });
    expect(count.json().count).toBe(1);
  });

  it("does not notify again on a duplicate follow", async () => {
    await app.inject({ method: "POST", url: `/api/follows/${author.id}`, headers: authHeaders(follower.token) });

    const list = await app.inject({ method: "GET", url: "/api/notifications", headers: authHeaders(author.token) });
    const followNotifs = list.json().filter((n: { type: string }) => n.type === "follow");
    expect(followNotifs.length).toBe(1);
  });

  it("notifies the post author on a new like", async () => {
    await app.inject({ method: "POST", url: `/api/posts/${postId}/react`, headers: authHeaders(follower.token) });

    const list = await app.inject({ method: "GET", url: "/api/notifications", headers: authHeaders(author.token) });
    const likeNotif = list.json().find((n: { type: string; actor: { id: string } }) => n.type === "like" && n.actor.id === follower.id);
    expect(likeNotif).toBeDefined();
  });

  it("does not notify on your own like", async () => {
    // Un second post pour ne pas rejouer un toggle sur celui du test
    // précédent (qui est déjà "liked" par `follower`).
    const { data: ownPost, error } = await app.supabaseAdmin
      .from("posts")
      .insert({
        user_id: author.id,
        type: "lifestyle",
        caption: "self-like test",
        media_kind: "photo",
        media_url: "https://example.com/fake2.jpg",
        privacy: "public",
      })
      .select("id")
      .single();
    if (error || !ownPost) throw error ?? new Error("Échec de création du post de test.");

    await app.inject({ method: "POST", url: `/api/posts/${ownPost.id}/react`, headers: authHeaders(author.token) });

    const list = await app.inject({ method: "GET", url: "/api/notifications", headers: authHeaders(author.token) });
    const selfLike = list.json().find((n: { type: string; actor: { id: string } }) => n.type === "like" && n.actor.id === author.id);
    expect(selfLike).toBeUndefined();

    await app.supabaseAdmin.from("posts").delete().eq("id", ownPost.id);
  });

  it("marks all notifications as read", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/notifications/read-all",
      headers: authHeaders(author.token),
    });
    expect(res.statusCode).toBe(204);

    const count = await app.inject({
      method: "GET",
      url: "/api/notifications/unread-count",
      headers: authHeaders(author.token),
    });
    expect(count.json().count).toBe(0);

    const list = await app.inject({ method: "GET", url: "/api/notifications", headers: authHeaders(author.token) });
    expect(list.json().every((n: { read: boolean }) => n.read)).toBe(true);
  });
});
