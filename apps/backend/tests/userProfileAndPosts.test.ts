import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Lot Q, bloc 3 — décision 6 : profil d'un autre utilisateur et
// suppression d'une publication.
describe("profil d'un autre utilisateur", () => {
  let app: FastifyInstance;
  let author: TestUser;
  let follower: TestUser;
  let stranger: TestUser;
  let blocked: TestUser;
  let blocker: TestUser;
  const postIds: Record<"public" | "followers" | "private", string> = { public: "", followers: "", private: "" };
  let photo: Buffer;

  beforeAll(async () => {
    app = await buildTestApp();
    [author, follower, stranger, blocked, blocker] = await Promise.all([
      createTestUser(app, "upa"),
      createTestUser(app, "upf"),
      createTestUser(app, "ups"),
      createTestUser(app, "upb"),
      createTestUser(app, "upk"),
    ]);
    photo = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#777" } }).jpeg().toBuffer();
    for (const privacy of ["public", "followers", "private"] as const) {
      const mp = buildMultipart({ type: "lifestyle", privacy, caption: privacy }, { fieldname: "file", filename: "p.jpg", contentType: "image/jpeg", data: photo });
      const res = await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(author.token), ...mp.headers }, payload: mp.payload });
      postIds[privacy] = res.json().id;
    }
    // Une pièce dans le Vault de l'auteur : ne doit JAMAIS apparaître.
    const vault = buildMultipart({ title: "Montre secrète", category: "watches" }, { fieldname: "file", filename: "v.jpg", contentType: "image/jpeg", data: photo });
    await app.inject({ method: "POST", url: "/api/vault", headers: { ...authHeaders(author.token), ...vault.headers }, payload: vault.payload });

    await app.inject({ method: "POST", url: `/api/follows/${author.id}`, headers: authHeaders(follower.token) });
    // blocked : l'auteur l'a bloqué ; blocker : il a bloqué l'auteur.
    await app.inject({ method: "POST", url: `/api/blocks/${blocked.id}`, headers: authHeaders(author.token) });
    await app.inject({ method: "POST", url: `/api/blocks/${author.id}`, headers: authHeaders(blocker.token) });
  });

  afterAll(async () => {
    for (const user of [author, follower, stranger, blocked, blocker]) await deleteTestUser(app, user.id);
    await app.close();
  });

  it("montre identité, bio et compteurs — jamais le Vault ni son nombre de pièces", async () => {
    const res = await app.inject({ method: "GET", url: `/api/users/${author.id}`, headers: authHeaders(follower.token) });
    expect(res.statusCode).toBe(200);
    const profile = res.json();
    expect(profile).toMatchObject({ id: author.id, followersCount: 1, followingCount: 0, isFollowing: true, isMe: false });
    expect(Object.keys(profile).sort()).toEqual(
      ["avatarUrl", "bio", "displayName", "followersCount", "followingCount", "id", "isFollowing", "isMe", "username"].sort()
    );
    expect(JSON.stringify(profile)).not.toMatch(/vault|Montre secrète/i);
  });

  const cases: [string, () => TestUser, ("public" | "followers" | "private")[]][] = [
    ["abonné", () => follower, ["public", "followers"]],
    ["non-abonné", () => stranger, ["public"]],
    ["bloqué par l'auteur", () => blocked, []],
    ["qui a bloqué l'auteur", () => blocker, []],
  ];

  for (const [label, viewer, visible] of cases) {
    it(`${label} : voit exactement ${visible.length ? visible.join(" + ") : "rien"} (liste et détail)`, async () => {
      const token = viewer().token;
      const list = await app.inject({ method: "GET", url: `/api/users/${author.id}/posts`, headers: authHeaders(token) });
      if (visible.length === 0) {
        expect(list.statusCode).toBe(404);
        expect((await app.inject({ method: "GET", url: `/api/users/${author.id}`, headers: authHeaders(token) })).statusCode).toBe(404);
      } else {
        const listed = list.json().posts.map((p: { id: string }) => p.id).sort();
        expect(listed).toEqual(visible.map((v) => postIds[v]).sort());
      }
      for (const privacy of ["public", "followers", "private"] as const) {
        const detail = await app.inject({ method: "GET", url: `/api/posts/${postIds[privacy]}`, headers: authHeaders(token) });
        expect(detail.statusCode).toBe(visible.includes(privacy) ? 200 : 404);
      }
    });
  }

  it("l'auteur voit toutes ses publications sur son propre profil", async () => {
    const list = await app.inject({ method: "GET", url: `/api/users/${author.id}/posts`, headers: authHeaders(author.token) });
    expect(list.json().posts).toHaveLength(3);
    const me = await app.inject({ method: "GET", url: `/api/users/${author.id}`, headers: authHeaders(author.token) });
    expect(me.json().isMe).toBe(true);
  });
});

describe("supprimer une publication", () => {
  let app: FastifyInstance;
  let owner: TestUser;
  let other: TestUser;
  let photo: Buffer;

  beforeAll(async () => {
    app = await buildTestApp();
    owner = await createTestUser(app, "dpo");
    other = await createTestUser(app, "dpx");
    photo = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#555" } }).jpeg().toBuffer();
  });

  afterAll(async () => {
    await deleteTestUser(app, owner.id);
    await deleteTestUser(app, other.id);
    await app.close();
  });

  async function files(bucket: string): Promise<string[]> {
    const { data } = await app.supabaseAdmin.storage.from(bucket).list(owner.id);
    return (data ?? []).map((f) => f.name);
  }

  it("seul l'auteur peut la supprimer ; « j'aime » et photo supprimés avec elle", async () => {
    const mp = buildMultipart({ type: "lifestyle", privacy: "public" }, { fieldname: "file", filename: "p.jpg", contentType: "image/jpeg", data: photo });
    const post = (await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(owner.token), ...mp.headers }, payload: mp.payload })).json();
    await app.inject({ method: "POST", url: `/api/posts/${post.id}/react`, headers: authHeaders(other.token) });
    const fileName = post.mediaUrl.split("/").pop();
    expect(await files("post-media")).toContain(fileName);

    expect((await app.inject({ method: "DELETE", url: `/api/posts/${post.id}`, headers: authHeaders(other.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/posts/${post.id}`, headers: authHeaders(owner.token) })).statusCode).toBe(204);

    expect((await app.inject({ method: "GET", url: `/api/posts/${post.id}`, headers: authHeaders(owner.token) })).statusCode).toBe(404);
    const { data: reactions } = await app.supabaseAdmin.from("post_reactions").select("post_id").eq("post_id", post.id);
    expect(reactions).toEqual([]);
    expect(await files("post-media")).not.toContain(fileName);
  });

  it("supprimer une publication « achat » laisse la pièce et sa photo dans le Vault", async () => {
    const vault = buildMultipart({ title: "Sac", category: "bags" }, { fieldname: "file", filename: "v.jpg", contentType: "image/jpeg", data: photo });
    const item = (await app.inject({ method: "POST", url: "/api/vault", headers: { ...authHeaders(owner.token), ...vault.headers }, payload: vault.payload })).json();
    const mp = buildMultipart({ type: "purchase", vaultItemId: item.id, privacy: "public" });
    const post = (await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(owner.token), ...mp.headers }, payload: mp.payload })).json();

    expect((await app.inject({ method: "DELETE", url: `/api/posts/${post.id}`, headers: authHeaders(owner.token) })).statusCode).toBe(204);
    const stillThere = await app.inject({ method: "GET", url: `/api/vault/${item.id}`, headers: authHeaders(owner.token) });
    expect(stillThere.statusCode).toBe(200);
    expect(await files("vault-media")).toContain(item.imageUrl.split("/").pop());
  });
});
