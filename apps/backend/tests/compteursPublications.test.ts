import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { Post } from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import postsRoutes from "../src/routes/posts.js";
import usersRoutes from "../src/routes/users.js";
import { fetchPostCounts } from "../src/lib/postCounts.js";
import { fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Compteurs des publications au-delà de 1 000 lignes (lot « corrections en
// ligne », fiche E1), SANS base : les vraies routes sur la fausse base
// (tests/fakeSupabase.ts), qui imite le plafond « Max rows » de Supabase
// (1 000 lignes par lecture, sans erreur, le compte exact restant juste).
// Le même cas sur la vraie base : compteursPublicationsBase.test.ts (Mac).

const AUTHOR = "a0000000-0000-4000-8000-000000000001";
const VIEWER = "b0000000-0000-4000-8000-000000000002";
const MAX_ROWS = 1000;
const postId = (i: number) => `e0000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

function profile(id: string, username: string): Row {
  return { id, username, display_name: username, avatar_url: null, bio: null };
}

function post(i: number): Row {
  return {
    id: postId(i),
    user_id: AUTHOR,
    type: "lifestyle",
    vault_item_id: null,
    wishlist_item_id: null,
    caption: `Publication ${i}`,
    media_url: `https://stockage.example/post-media/${i}.jpg`,
    media_thumb_url: null,
    media_removed_at: null,
    privacy: "public",
    hidden_at: null,
    created_at: new Date(Date.UTC(2026, 10, 1, 12, i)).toISOString(),
  };
}

/** `n` « j'aime » d'autres membres sur la publication `i`. */
const likes = (i: number, n: number): Row[] => Array.from({ length: n }, () => ({ post_id: postId(i), user_id: randomUUID(), created_at: "2026-11-01T12:00:00Z" }));
/** `n` commentaires d'autres membres ; `hidden` : masqués par la modération. */
const comments = (i: number, n: number, hidden = false): Row[] =>
  Array.from({ length: n }, () => ({
    id: randomUUID(),
    post_id: postId(i),
    user_id: randomUUID(),
    body: "Très belle veste",
    hidden_at: hidden ? "2026-11-02T12:00:00Z" : null,
    created_at: "2026-11-01T12:00:00Z",
  }));

function seeded(postCount: number, options: FakeDbOptions = {}) {
  const fake = fakeSupabase({ maxRows: MAX_ROWS, ...options });
  fake.table("profiles").push(profile(AUTHOR, "autrice"), profile(VIEWER, "lecteur"));
  for (let i = 0; i < postCount; i++) fake.table("posts").push(post(i));
  return fake;
}

/** Compte les requêtes envoyées à la base (une par appel à `from`). */
function counted(db: ReturnType<typeof fakeSupabase>["db"]) {
  const tables: string[] = [];
  const from = db.from;
  return { db: { ...db, from: (name: string) => (tables.push(name), from(name)) }, tables };
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function postsApp(db: unknown): Promise<FastifyInstance> {
  app = Fastify({ logger: false });
  app.decorate("supabaseAdmin", db as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const id = request.headers["x-test-user"];
    if (typeof id !== "string") return reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification manquant." });
    request.user = { id, email: `${id.slice(0, 4)}@example.com` };
  });
  await app.register(rateLimitPlugin);
  await app.register(moderationPlugin);
  await app.register(postsRoutes);
  await app.register(usersRoutes);
  await app.ready();
  return app;
}

async function profilePage(db: unknown): Promise<Post[]> {
  const target = await postsApp(db);
  const res = await target.inject({ method: "GET", url: `/api/users/${AUTHOR}/posts`, headers: { "x-test-user": VIEWER } });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { posts: Post[] }).posts;
}
const byId = (posts: Post[], i: number) => posts.find((p) => p.id === postId(i))!;
const silentLog = { warn: () => {} } as unknown as FastifyInstance["log"];

describe("compteurs des publications au-delà de 1 000 lignes", () => {
  it("la fausse base imite bien le plafond : une lecture simple de 1 200 « j'aime » n'en rend que 1 000", async () => {
    const fake = seeded(2);
    fake.table("post_reactions").push(...likes(0, 700), ...likes(1, 500));
    const plain = (await fake.db.from("post_reactions").select("post_id, user_id").in("post_id", [postId(0), postId(1)])) as { data: Row[] };
    expect(plain.data).toHaveLength(MAX_ROWS);
  });

  it("une page de profil dont les « j'aime » dépassent 1 000 au total : chaque nombre est exact, la forme de la réponse ne change pas", async () => {
    const fake = seeded(18);
    fake.table("post_reactions").push(...likes(2, 700), ...likes(9, 500), ...likes(15, 3));
    const posts = await profilePage(fake.db);
    expect(posts).toHaveLength(18);
    expect(byId(posts, 2).reactionCount).toBe(700);
    expect(byId(posts, 9).reactionCount).toBe(500);
    expect(byId(posts, 15).reactionCount).toBe(3);
    expect(byId(posts, 0).reactionCount).toBe(0);
    for (const p of posts) {
      expect(Object.keys(p).filter((key) => /count|reacted/i.test(key)).sort()).toEqual(["commentCount", "reactionCount", "viewerHasReacted"]);
      expect(typeof p.reactionCount).toBe("number");
      expect(typeof p.commentCount).toBe("number");
      expect(typeof p.viewerHasReacted).toBe("boolean");
    }
  });

  it("une seule publication plus aimée que le plafond : son nombre exact (détail d'une publication)", async () => {
    const fake = seeded(1);
    fake.table("post_reactions").push(...likes(0, 2500));
    const target = await postsApp(fake.db);
    const res = await target.inject({ method: "GET", url: `/api/posts/${postId(0)}`, headers: { "x-test-user": VIEWER } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Post).reactionCount).toBe(2500);
  });

  it("« vous avez aimé » est juste quand la ligne du lecteur tombe au-delà du plafond ; le « j'aime » d'un autre ne compte jamais pour vous", async () => {
    const fake = seeded(18);
    // Le « j'aime » du lecteur est la toute dernière ligne, après 1 200 autres.
    fake.table("post_reactions").push(...likes(3, 600), ...likes(12, 600), { post_id: postId(12), user_id: VIEWER, created_at: "2026-11-03T12:00:00Z" });
    const posts = await profilePage(fake.db);
    expect(byId(posts, 12)).toMatchObject({ reactionCount: 601, viewerHasReacted: true });
    expect(byId(posts, 3)).toMatchObject({ reactionCount: 600, viewerHasReacted: false });
    expect(posts.filter((p) => p.viewerHasReacted).map((p) => p.id)).toEqual([postId(12)]);
  });

  it("commentaires masqués toujours exclus, même au-delà de 1 000 commentaires", async () => {
    const fake = seeded(18);
    fake.table("comments").push(...comments(4, 650), ...comments(4, 40, true), ...comments(11, 450), ...comments(11, 900, true), ...comments(17, 2));
    const posts = await profilePage(fake.db);
    expect(byId(posts, 4).commentCount).toBe(650);
    expect(byId(posts, 11).commentCount).toBe(450);
    expect(byId(posts, 17).commentCount).toBe(2);
    expect(byId(posts, 0).commentCount).toBe(0);
  });

  it("lecture impossible : comme avant, les nombres de cette table valent 0 et la page s'affiche", async () => {
    const withoutReactions = seeded(3, { missing: ["post_reactions"] });
    withoutReactions.table("comments").push(...comments(1, 5));
    const posts = await profilePage(withoutReactions.db);
    expect(posts.map((p) => [p.reactionCount, p.viewerHasReacted])).toEqual([
      [0, false],
      [0, false],
      [0, false],
    ]);
    expect(byId(posts, 1).commentCount).toBe(5);

    await app?.close();
    const withoutComments = seeded(3, { missing: ["comments"] });
    withoutComments.table("post_reactions").push(...likes(0, 4), { post_id: postId(0), user_id: VIEWER, created_at: "2026-11-03T12:00:00Z" });
    const again = await profilePage(withoutComments.db);
    expect(byId(again, 0)).toMatchObject({ reactionCount: 5, viewerHasReacted: true, commentCount: 0 });
  });
});

describe("nombre de requêtes pour une page de 20 publications", () => {
  const twenty = Array.from({ length: 20 }, (_, i) => postId(i));

  it("cas courant (moins de 1 000 lignes) : 3 requêtes, une par table et une pour « vous avez aimé »", async () => {
    const fake = seeded(20);
    fake.table("post_reactions").push(...likes(0, 300), ...likes(7, 200));
    fake.table("comments").push(...comments(7, 40));
    const { db, tables } = counted(fake.db);
    const counts = await fetchPostCounts({ supabaseAdmin: db as unknown as FastifyInstance["supabaseAdmin"], log: silentLog }, twenty, VIEWER);
    expect(counts.reactionCount.get(postId(0))).toBe(300);
    expect(counts.commentCount.get(postId(7))).toBe(40);
    expect(tables.sort()).toEqual(["comments", "post_reactions", "post_reactions"]);
  });

  it("2 634 « j'aime » sur la page : 7 requêtes en tout (contre 41 en comptant publication par publication), nombres exacts", async () => {
    const fake = seeded(20);
    const spread = new Map<number, number>([[3, 1500], [10, 800], [15, 300]]);
    for (let i = 0; i < 20; i++) fake.table("post_reactions").push(...likes(i, spread.get(i) ?? 2));
    const { db, tables } = counted(fake.db);
    const counts = await fetchPostCounts({ supabaseAdmin: db as unknown as FastifyInstance["supabaseAdmin"], log: silentLog }, twenty, VIEWER);
    for (let i = 0; i < 20; i++) expect(counts.reactionCount.get(postId(i)), `publication ${i}`).toBe(spread.get(i) ?? 2);
    // « j'aime » : 3 lectures coupées ou complètes + 2 comptes par la base ;
    // commentaires : 1 ; « vous avez aimé » : 1.
    expect(tables.filter((t) => t === "post_reactions")).toHaveLength(6);
    expect(tables).toHaveLength(7);
  });

  it("au pire, une publication très aimée coûte deux requêtes de plus, jamais une par ligne", async () => {
    const fake = seeded(20);
    for (let i = 0; i < 20; i++) fake.table("post_reactions").push(...likes(i, 1001));
    const { db, tables } = counted(fake.db);
    const counts = await fetchPostCounts({ supabaseAdmin: db as unknown as FastifyInstance["supabaseAdmin"], log: silentLog }, twenty, VIEWER);
    expect([...counts.reactionCount.values()]).toEqual(Array(20).fill(1001));
    expect(tables.length).toBeLessThanOrEqual(2 * 20 + 2);
  });

  it("plus de 100 publications (« Mes publications », sans pagination) : lues par paquets de 100, nombres exacts", async () => {
    const fake = seeded(150);
    const ids = Array.from({ length: 150 }, (_, i) => postId(i));
    fake.table("post_reactions").push(...likes(120, 1200), ...likes(5, 3), { post_id: postId(140), user_id: VIEWER, created_at: "2026-11-03T12:00:00Z" });
    const { db, tables } = counted(fake.db);
    const counts = await fetchPostCounts({ supabaseAdmin: db as unknown as FastifyInstance["supabaseAdmin"], log: silentLog }, ids, VIEWER);
    expect(counts.reactionCount.get(postId(120))).toBe(1200);
    expect(counts.reactionCount.get(postId(5))).toBe(3);
    expect(counts.reactionCount.get(postId(140))).toBe(1);
    expect([...counts.viewerReacted]).toEqual([postId(140)]);
    expect(tables.length).toBeLessThanOrEqual(10);
  });
});
