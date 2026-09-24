import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Lot F — scénario de bout en bout à deux comptes (A suit B), fil avec ses
// propres publications, commentaires, partage d'une pièce du Vault.
describe("le fil vivant (Lot F)", () => {
  let app: FastifyInstance;
  let a: TestUser; // lectrice, suit B
  let b: TestUser; // autrice
  let c: TestUser; // ne suit personne
  let photo: Buffer;
  const bPosts: Record<"public" | "followers" | "private", string> = { public: "", followers: "", private: "" };
  let aOwnPrivate = "";

  async function lifestyle(user: TestUser, privacy: string, caption: string): Promise<string> {
    const mp = buildMultipart({ type: "lifestyle", privacy, caption }, { fieldname: "file", filename: "p.jpg", contentType: "image/jpeg", data: photo });
    const res = await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(user.token), ...mp.headers }, payload: mp.payload });
    expect(res.statusCode).toBe(200);
    return res.json().id;
  }
  const feedIds = async (user: TestUser) =>
    (await app.inject({ method: "GET", url: "/api/feed", headers: authHeaders(user.token) })).json().posts.map((p: { id: string }) => p.id) as string[];
  const comment = (user: TestUser, postId: string, body: string) =>
    app.inject({ method: "POST", url: `/api/posts/${postId}/comments`, headers: authHeaders(user.token), payload: { body } });
  const comments = async (user: TestUser, postId: string) =>
    app.inject({ method: "GET", url: `/api/posts/${postId}/comments`, headers: authHeaders(user.token) });

  beforeAll(async () => {
    app = await buildTestApp();
    [a, b, c] = await Promise.all([createTestUser(app, "lfa"), createTestUser(app, "lfb"), createTestUser(app, "lfc")]);
    photo = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#789" } }).jpeg().toBuffer();
    await app.inject({ method: "POST", url: `/api/follows/${b.id}`, headers: authHeaders(a.token) });
    bPosts.public = await lifestyle(b, "public", "B public");
    bPosts.followers = await lifestyle(b, "followers", "B abonnés");
    bPosts.private = await lifestyle(b, "private", "B privé");
    aOwnPrivate = await lifestyle(a, "private", "A privé");
  });

  afterAll(async () => {
    for (const user of [a, b, c]) await deleteTestUser(app, user.id);
    await app.close();
  });

  it("fil de A : ses propres publications (même privées) + celles de B publiques et abonnés, jamais la privée", async () => {
    const ids = await feedIds(a);
    expect(ids).toContain(aOwnPrivate);
    expect(ids).toContain(bPosts.public);
    expect(ids).toContain(bPosts.followers);
    expect(ids).not.toContain(bPosts.private);
    // Ordre chronologique : la plus récente d'abord (la publication de A).
    expect(ids[0]).toBe(aOwnPrivate);
  });

  it("fil de B : ses propres publications apparaissent ; celles de A non (B ne suit pas A)", async () => {
    const ids = await feedIds(b);
    expect(ids).toEqual(expect.arrayContaining([bPosts.public, bPosts.followers, bPosts.private]));
    expect(ids).not.toContain(aOwnPrivate);
  });

  it("fil de C (ne suit personne, n'a rien publié) : vide", async () => {
    expect(await feedIds(c)).toEqual([]);
  });

  it("commentaires : longueur, espaces, visibilité, notification, suppression", async () => {
    expect((await comment(a, bPosts.public, "x".repeat(1000))).statusCode).toBe(200);
    expect((await comment(a, bPosts.public, "x".repeat(1001))).statusCode).toBe(400);
    expect((await comment(a, bPosts.public, "   ")).statusCode).toBe(400);

    // C ne suit pas B : il peut commenter la publication publique, pas celle « abonnés » ; personne ne commente la privée.
    expect((await comment(c, bPosts.public, "Bonjour")).statusCode).toBe(200);
    expect((await comment(c, bPosts.followers, "Bonjour")).statusCode).toBe(404);
    expect((await comments(c, bPosts.followers)).statusCode).toBe(404);
    expect((await comment(a, bPosts.private, "Bonjour")).statusCode).toBe(404);

    const created = (await comment(a, bPosts.followers, "Très belle veste")).json();
    expect(created).toMatchObject({ body: "Très belle veste", canDelete: true });

    // Notification « comment » chez B, jamais pour son propre commentaire.
    await comment(b, bPosts.followers, "Merci !");
    const notifs = (await app.inject({ method: "GET", url: "/api/notifications", headers: authHeaders(b.token) })).json();
    const commentNotifs = notifs.filter((n: { type: string }) => n.type === "comment");
    expect(commentNotifs.every((n: { actor: { id: string } }) => n.actor.id !== b.id)).toBe(true);
    expect(commentNotifs.some((n: { actor: { id: string }; postId: string }) => n.actor.id === a.id && n.postId === bPosts.followers)).toBe(true);

    // Compteur sur la publication, et ordre chronologique.
    const list = (await comments(a, bPosts.followers)).json().comments.map((x: { body: string }) => x.body);
    expect(list).toEqual(["Très belle veste", "Merci !"]);
    const post = (await app.inject({ method: "GET", url: `/api/posts/${bPosts.followers}`, headers: authHeaders(a.token) })).json();
    expect(post.commentCount).toBe(2);

    // Suppression : C ne peut pas supprimer le commentaire de A ; B (autrice de la publication) peut.
    expect((await app.inject({ method: "DELETE", url: `/api/comments/${created.id}`, headers: authHeaders(c.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/comments/${created.id}`, headers: authHeaders(b.token) })).statusCode).toBe(204);
    // A supprime son propre commentaire.
    const own = (await comment(a, bPosts.public, "À supprimer")).json();
    expect((await app.inject({ method: "DELETE", url: `/api/comments/${own.id}`, headers: authHeaders(a.token) })).statusCode).toBe(204);
  });

  it("signaler un commentaire ; l'export RGPD contient ses commentaires", async () => {
    const own = (await comment(c, bPosts.public, "Commentaire exporté")).json();
    const report = await app.inject({ method: "POST", url: "/api/reports", headers: authHeaders(b.token), payload: { targetType: "comment", targetId: own.id, reason: "spam" } });
    expect(report.statusCode).toBe(204);
    const exported = (await app.inject({ method: "GET", url: "/api/me/export", headers: authHeaders(c.token) })).json();
    expect(exported.comments.map((x: { body: string }) => x.body)).toContain("Commentaire exporté");
  });

  it("un blocage coupe tout : fil, publication, commentaires", async () => {
    const before = (await comment(a, bPosts.public, "Avant le blocage")).json();
    await app.inject({ method: "POST", url: `/api/blocks/${a.id}`, headers: authHeaders(b.token) });

    const ids = await feedIds(a);
    expect(ids).not.toContain(bPosts.public);
    expect(ids).not.toContain(bPosts.followers);
    expect((await app.inject({ method: "GET", url: `/api/posts/${bPosts.public}`, headers: authHeaders(a.token) })).statusCode).toBe(404);
    expect((await comment(a, bPosts.public, "Après le blocage")).statusCode).toBe(404);
    // B ne voit plus le commentaire de A sous sa propre publication.
    const seenByB = (await comments(b, bPosts.public)).json().comments.map((x: { id: string }) => x.id);
    expect(seenByB).not.toContain(before.id);
  });

  it("la suppression du compte supprime ses commentaires", async () => {
    const temp = await createTestUser(app, "lft");
    const posted = (await comment(temp, bPosts.public, "Éphémère")).json();
    await deleteTestUser(app, temp.id);
    const { data } = await app.supabaseAdmin.from("comments").select("id").eq("id", posted.id);
    expect(data).toEqual([]);
  });
});

describe("partager une pièce du Vault (Lot F)", () => {
  let app: FastifyInstance;
  let owner: TestUser;
  let photo: Buffer;

  beforeAll(async () => {
    app = await buildTestApp();
    owner = await createTestUser(app, "lfs");
    photo = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#456" } }).jpeg().toBuffer();
  });

  afterAll(async () => {
    await deleteTestUser(app, owner.id);
    await app.close();
  });

  it("après le partage, le détail indique la publication et sa visibilité ; un second partage est refusé", async () => {
    const vault = buildMultipart({ title: "Sac", category: "bags" }, { fieldname: "file", filename: "v.jpg", contentType: "image/jpeg", data: photo });
    const item = (await app.inject({ method: "POST", url: "/api/vault", headers: { ...authHeaders(owner.token), ...vault.headers }, payload: vault.payload })).json();
    const before = (await app.inject({ method: "GET", url: `/api/vault/${item.id}`, headers: authHeaders(owner.token) })).json();
    expect(before.sharedPost).toBeNull();

    const share = () => {
      const mp = buildMultipart({ type: "purchase", vaultItemId: item.id, privacy: "public" });
      return app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(owner.token), ...mp.headers }, payload: mp.payload });
    };
    const first = await share();
    expect(first.statusCode).toBe(200);
    const after = (await app.inject({ method: "GET", url: `/api/vault/${item.id}`, headers: authHeaders(owner.token) })).json();
    expect(after.sharedPost).toMatchObject({ id: first.json().id, privacy: "public" });

    const second = await share();
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("already_shared");

    // Le partage apparaît dans son propre fil.
    const feed = (await app.inject({ method: "GET", url: "/api/feed", headers: authHeaders(owner.token) })).json();
    expect(feed.posts.map((p: { id: string }) => p.id)).toContain(first.json().id);

    // Après suppression de la publication, la pièce peut être partagée à nouveau.
    await app.inject({ method: "DELETE", url: `/api/posts/${first.json().id}`, headers: authHeaders(owner.token) });
    expect((await share()).statusCode).toBe(200);
  });
});
