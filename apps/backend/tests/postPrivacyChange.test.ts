import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Lot F — l'auteur modifie la visibilité de sa publication sans la
// supprimer : « j'aime » et commentaires conservés, et toutes les règles
// (fil, profil, détail, commentaires, lien de partage) suivent aussitôt.
describe("modifier la visibilité d'une publication", () => {
  let app: FastifyInstance;
  let author: TestUser;
  let follower: TestUser;
  let stranger: TestUser;
  let postId = "";

  const as = (user: TestUser, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  const setPrivacy = (user: TestUser, privacy: string) => as(user, "PATCH", `/api/posts/${postId}`, { privacy });
  const sees = async (user: TestUser) => {
    const feed = (await as(user, "GET", "/api/feed")).json().posts.map((p: { id: string }) => p.id);
    const profileRes = await as(user, "GET", `/api/users/${author.id}/posts`);
    const profile = profileRes.statusCode === 200 ? profileRes.json().posts.map((p: { id: string }) => p.id) : [];
    return {
      feed: feed.includes(postId),
      profile: profile.includes(postId),
      detail: (await as(user, "GET", `/api/posts/${postId}`)).statusCode === 200,
      comments: (await as(user, "GET", `/api/posts/${postId}/comments`)).statusCode === 200,
    };
  };

  beforeAll(async () => {
    app = await buildTestApp();
    [author, follower, stranger] = await Promise.all([createTestUser(app, "pva"), createTestUser(app, "pvf"), createTestUser(app, "pvs")]);
    await as(follower, "POST", `/api/follows/${author.id}`);
    const photo = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#321" } }).jpeg().toBuffer();
    const mp = buildMultipart({ type: "lifestyle", privacy: "public", caption: "Visibilité" }, { fieldname: "file", filename: "p.jpg", contentType: "image/jpeg", data: photo });
    postId = (await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(author.token), ...mp.headers }, payload: mp.payload })).json().id;
    await as(follower, "POST", `/api/posts/${postId}/react`);
    await as(follower, "POST", `/api/posts/${postId}/comments`, { body: "Je garde mon commentaire" });
  });

  afterAll(async () => {
    for (const user of [author, follower, stranger]) await deleteTestUser(app, user.id);
    await app.close();
  });

  it("Public → Abonnés → Privé → Public : chaque règle suit aussitôt, « j'aime » et commentaires conservés", async () => {
    expect(await sees(follower)).toEqual({ feed: true, profile: true, detail: true, comments: true });
    expect(await sees(stranger)).toEqual({ feed: false, profile: true, detail: true, comments: true });

    const followersOnly = await setPrivacy(author, "followers");
    expect(followersOnly.statusCode).toBe(200);
    expect(followersOnly.json()).toMatchObject({ privacy: "followers", reactionCount: 1, commentCount: 1 });
    expect(await sees(follower)).toEqual({ feed: true, profile: true, detail: true, comments: true });
    expect(await sees(stranger)).toEqual({ feed: false, profile: false, detail: false, comments: false });
    expect((await as(stranger, "POST", `/api/posts/${postId}/comments`, { body: "Plus possible" })).statusCode).toBe(404);

    await setPrivacy(author, "private");
    expect(await sees(follower)).toEqual({ feed: false, profile: false, detail: false, comments: false });
    // L'auteur, lui, la voit toujours, dans son fil compris.
    expect(await sees(author)).toEqual({ feed: true, profile: true, detail: true, comments: true });

    const backToPublic = await setPrivacy(author, "public");
    expect(backToPublic.json()).toMatchObject({ privacy: "public", reactionCount: 1, commentCount: 1 });
    expect(await sees(stranger)).toEqual({ feed: false, profile: true, detail: true, comments: true });
  });

  it("seul l'auteur peut la modifier ; valeur invalide refusée", async () => {
    expect((await setPrivacy(follower, "private")).statusCode).toBe(404);
    expect((await setPrivacy(author, "tout-le-monde")).statusCode).toBe(400);
    expect((await as(author, "GET", `/api/posts/${postId}`)).json().privacy).toBe("public");
  });
});
