import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

type Privacy = "public" | "followers" | "private";

// Un produit (recherche de l'auteur) tagué dans une publication de l'auteur
// avec la confidentialité donnée.
async function taggedMatch(app: FastifyInstance, authorId: string, privacy: Privacy): Promise<string> {
  const { data: search } = await app.supabaseAdmin
    .from("product_searches")
    .insert({ user_id: authorId, source_url: "https://www.tiktok.com/@x/video/1", source_platform: "tiktok", method: "oembed", status: "completed" })
    .select("id")
    .single();
  const { data: match } = await app.supabaseAdmin
    .from("product_matches")
    .insert({ search_id: search!.id, rank: 1, product_name: "Sac", image_url: "https://example.com/a.jpg", merchant_url: "https://example.com/p" })
    .select("id")
    .single();
  await app.supabaseAdmin.from("affiliate_links").insert({ product_match_id: match!.id, network: "direct", affiliate_url: "https://example.com/p" });
  const { data: post } = await app.supabaseAdmin
    .from("posts")
    .insert({ user_id: authorId, type: "lifestyle", media_kind: "photo", media_url: "https://example.com/post.jpg", privacy })
    .select("id")
    .single();
  await app.supabaseAdmin.from("post_tagged_pieces").insert({ post_id: post!.id, product_match_id: match!.id, position: 0 });
  return match!.id as string;
}

// Audit Lot Q, DON-02 : un clic sur une pièce taguée dans la publication
// d'un autre était toujours refusé (404) et jamais enregistré.
describe("suivi des clics sur les pièces taguées des publications", () => {
  let app: FastifyInstance;
  let author: TestUser;
  let follower: TestUser;
  let stranger: TestUser;
  let blocked: TestUser;
  const matches: Record<Privacy, string> = { public: "", followers: "", private: "" };

  beforeAll(async () => {
    app = await buildTestApp();
    author = await createTestUser(app, "pca");
    follower = await createTestUser(app, "pcb");
    stranger = await createTestUser(app, "pcc");
    blocked = await createTestUser(app, "pcd");

    await app.inject({ method: "POST", url: `/api/follows/${author.id}`, headers: authHeaders(follower.token) });
    await app.inject({ method: "POST", url: `/api/blocks/${blocked.id}`, headers: authHeaders(author.token) });

    for (const privacy of ["public", "followers", "private"] as const) {
      matches[privacy] = await taggedMatch(app, author.id, privacy);
    }
  });

  afterAll(async () => {
    for (const u of [author, follower, stranger, blocked]) await deleteTestUser(app, u.id);
    await app.close();
  });

  const click = (user: TestUser, matchId: string) =>
    app.inject({
      method: "POST",
      url: `/api/product-matches/${matchId}/click`,
      headers: authHeaders(user.token),
      payload: { context: "post" },
    });

  const cases: [string, Privacy, number, () => TestUser][] = [
    ["abonné", "public", 200, () => follower],
    ["abonné", "followers", 200, () => follower],
    ["abonné", "private", 404, () => follower],
    ["non-abonné", "public", 200, () => stranger],
    ["non-abonné", "followers", 404, () => stranger],
    ["non-abonné", "private", 404, () => stranger],
    ["bloqué", "public", 404, () => blocked],
    ["bloqué", "followers", 404, () => blocked],
    ["bloqué", "private", 404, () => blocked],
  ];

  it.each(cases)("%s, publication %s → %i", async (_label, privacy, expected, viewer) => {
    const res = await click(viewer(), matches[privacy]);
    expect(res.statusCode).toBe(expected);
  });

  it("enregistre le clic avec le contexte « post » pour le lecteur", async () => {
    await click(stranger, matches.public);
    const { data } = await app.supabaseAdmin
      .from("affiliate_clicks")
      .select("context")
      .eq("user_id", stranger.id)
      .eq("context", "post");
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("l'auteur peut toujours cliquer sur ses propres pièces, même dans une publication privée", async () => {
    expect((await click(author, matches.private)).statusCode).toBe(200);
  });
});
