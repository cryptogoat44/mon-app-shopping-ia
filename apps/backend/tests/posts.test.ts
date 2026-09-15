import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

async function insertPost(
  app: FastifyInstance,
  userId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const { data, error } = await app.supabaseAdmin
    .from("posts")
    .insert({
      user_id: userId,
      type: "lifestyle",
      caption: "test post",
      media_kind: "photo",
      media_url: "https://example.com/fake.jpg",
      privacy: "public",
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

describe("posts / feed", () => {
  let app: FastifyInstance;
  let viewer: TestUser;
  let author: TestUser;
  let stranger: TestUser;
  const postIds: string[] = [];

  beforeAll(async () => {
    app = await buildTestApp();
    viewer = await createTestUser(app, "pstv");
    author = await createTestUser(app, "psta");
    stranger = await createTestUser(app, "psts");

    await app.inject({ method: "POST", url: `/api/follows/${author.id}`, headers: authHeaders(viewer.token) });
  });

  afterAll(async () => {
    if (postIds.length) await app.supabaseAdmin.from("posts").delete().in("id", postIds);
    await deleteTestUser(app, viewer.id);
    await deleteTestUser(app, author.id);
    await deleteTestUser(app, stranger.id);
    await app.close();
  });

  it("returns an empty feed with no followees", async () => {
    const res = await app.inject({ method: "GET", url: "/api/feed", headers: authHeaders(stranger.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ posts: [], nextCursor: null });
  });

  it("paginates the feed by cursor, newest first, no duplicates", async () => {
    const baseTime = Date.now();
    for (let i = 0; i < 17; i++) {
      const id = await insertPost(app, author.id, {
        caption: `feed-post-${i}`,
        created_at: new Date(baseTime + i * 1000).toISOString(),
      });
      postIds.push(id);
    }

    const page1 = await app.inject({ method: "GET", url: "/api/feed", headers: authHeaders(viewer.token) });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json();
    expect(body1.posts).toHaveLength(15);
    expect(body1.posts[0].caption).toBe("feed-post-16");
    expect(typeof body1.nextCursor).toBe("string");

    const page2 = await app.inject({
      method: "GET",
      url: `/api/feed?cursor=${encodeURIComponent(body1.nextCursor)}`,
      headers: authHeaders(viewer.token),
    });
    const body2 = page2.json();
    expect(body2.posts).toHaveLength(2);
    expect(body2.nextCursor).toBeNull();

    const captions = new Set([...body1.posts, ...body2.posts].map((p: { caption: string }) => p.caption));
    expect(captions.size).toBe(17);
  });

  it("rejects an invalid cursor", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/feed?cursor=not-a-date",
      headers: authHeaders(viewer.token),
    });
    expect(res.statusCode).toBe(400);
  });

  it("never shows a followee's private post", async () => {
    const privateId = await insertPost(app, author.id, { caption: "private-post", privacy: "private" });
    postIds.push(privateId);

    const res = await app.inject({ method: "GET", url: "/api/feed", headers: authHeaders(viewer.token) });
    expect(res.json().posts.some((p: { caption: string }) => p.caption === "private-post")).toBe(false);
  });

  it("hides a followers-only post from a non-follower reacting to it directly", async () => {
    const followersOnlyId = await insertPost(app, author.id, { caption: "followers-only", privacy: "followers" });
    postIds.push(followersOnlyId);

    const res = await app.inject({
      method: "POST",
      url: `/api/posts/${followersOnlyId}/react`,
      headers: authHeaders(stranger.token),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("posts / reactions", () => {
  let app: FastifyInstance;
  let author: TestUser;
  let liker: TestUser;
  let postId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    author = await createTestUser(app, "rcta");
    liker = await createTestUser(app, "rctl");
    postId = await insertPost(app, author.id, { caption: "reaction test" });
  });

  afterAll(async () => {
    await app.supabaseAdmin.from("posts").delete().eq("id", postId);
    await deleteTestUser(app, author.id);
    await deleteTestUser(app, liker.id);
    await app.close();
  });

  it("404s reacting to a non-existent post", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/posts/00000000-0000-0000-0000-000000000000/react",
      headers: authHeaders(liker.token),
    });
    expect(res.statusCode).toBe(404);
  });

  it("reacts, then un-reacts, toggling reactionCount", async () => {
    const react1 = await app.inject({ method: "POST", url: `/api/posts/${postId}/react`, headers: authHeaders(liker.token) });
    expect(react1.statusCode).toBe(200);
    expect(react1.json()).toEqual({ reactionCount: 1, viewerHasReacted: true });

    const react2 = await app.inject({ method: "POST", url: `/api/posts/${postId}/react`, headers: authHeaders(liker.token) });
    expect(react2.json()).toEqual({ reactionCount: 0, viewerHasReacted: false });
  });

  it("blocks reacting once a block exists between viewer and author", async () => {
    await app.inject({ method: "POST", url: `/api/blocks/${liker.id}`, headers: authHeaders(author.token) });

    const res = await app.inject({ method: "POST", url: `/api/posts/${postId}/react`, headers: authHeaders(liker.token) });
    expect(res.statusCode).toBe(404);

    await app.inject({ method: "DELETE", url: `/api/blocks/${liker.id}`, headers: authHeaders(author.token) });
  });
});
