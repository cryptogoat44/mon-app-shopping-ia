import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import type { Post } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Compteurs des publications au-delà de 1 000 lignes (lot « corrections en
// ligne », fiche E1) sur la vraie base de développement (spotto-dev-2, sur le
// Mac du fondateur) : ce que la fausse base ne peut pas prouver, le vrai
// plafond « Max rows » de Supabase (1 000 lignes par défaut).
//
// Plus de 1 000 COMMENTAIRES, pas 1 000 « j'aime » : un « j'aime » est unique
// par compte et par publication, et chaque compte est un vrai compte de
// connexion ; en créer un millier sur spotto-dev-2 prendrait de longues
// minutes. Les commentaires passent par la même fonction de comptage
// (lib/postCounts.ts) : 1 080 lignes écrites d'un coup par un seul compte
// suffisent. Les « j'aime » au-delà du plafond sont essayés sans base
// (compteursPublications.test.ts).

const VISIBLE = [600, 450] as const;
const HIDDEN = 30;

describe("compteurs des publications au-delà de 1 000 lignes, sur la base de développement", () => {
  let app: FastifyInstance;
  let author: TestUser;
  let viewer: TestUser;
  const postIds: string[] = [];

  const request = (user: TestUser, method: InjectOptions["method"], url: string) => app.inject({ method, url, headers: authHeaders(user.token) });

  beforeAll(async () => {
    app = await buildTestApp();
    [author, viewer] = await Promise.all([createTestUser(app, "cpa"), createTestUser(app, "cpv")]);
    // Deux publications publiques, écrites directement (aucun envoi d'image).
    for (const caption of ["Première", "Seconde"]) {
      const { data, error } = await app.supabaseAdmin
        .from("posts")
        .insert({ user_id: author.id, type: "lifestyle", media_kind: "photo", caption, media_url: `${env.SUPABASE_URL}/storage/v1/object/public/post-media/${author.id}/essai.jpg`, privacy: "public" })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("Publication de test non créée");
      postIds.push((data as { id: string }).id);
    }
    // 1 050 commentaires visibles, et 30 masqués par la modération sur la première.
    const rows = [
      ...VISIBLE.flatMap((n, index) => Array.from({ length: n }, (_, i) => ({ post_id: postIds[index], user_id: viewer.id, body: `Commentaire ${i}` }))),
      ...Array.from({ length: HIDDEN }, (_, i) => ({ post_id: postIds[0], user_id: viewer.id, body: `Masqué ${i}`, hidden_at: new Date().toISOString() })),
    ];
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await app.supabaseAdmin.from("comments").insert(rows.slice(i, i + 500));
      if (error) throw error;
    }
    // Un « j'aime » de chacun, sur une publication différente.
    const { error } = await app.supabaseAdmin.from("post_reactions").insert([
      { post_id: postIds[0], user_id: author.id },
      { post_id: postIds[1], user_id: viewer.id },
    ]);
    if (error) throw error;
  }, 60_000);

  afterAll(async () => {
    for (const user of [author, viewer]) if (user) await deleteTestUser(app, user.id);
    await app.close();
  });

  const expectExact = (posts: Post[], viewerLikesSecond: boolean) => {
    const [first, second] = postIds.map((id) => posts.find((post) => post.id === id));
    expect(first).toMatchObject({ commentCount: VISIBLE[0], reactionCount: 1, viewerHasReacted: !viewerLikesSecond });
    expect(second).toMatchObject({ commentCount: VISIBLE[1], reactionCount: 1, viewerHasReacted: viewerLikesSecond });
  };

  it("profil vu par un autre membre : nombres exacts, commentaires masqués exclus", async () => {
    const res = await request(viewer, "GET", `/api/users/${author.id}/posts`);
    expect(res.statusCode).toBe(200);
    expectExact((res.json() as { posts: Post[] }).posts, true);
  });

  it("fil de l'autrice : nombres exacts, « vous avez aimé » le sien", async () => {
    const res = await request(author, "GET", "/api/feed");
    expect(res.statusCode).toBe(200);
    expectExact((res.json() as { posts: Post[] }).posts, false);
  });

  it("détail d'une publication : le même nombre que la page", async () => {
    const res = await request(viewer, "GET", `/api/posts/${postIds[0]}`);
    expect(res.statusCode).toBe(200);
    expect((res.json() as Post).commentCount).toBe(VISIBLE[0]);
  });
});
