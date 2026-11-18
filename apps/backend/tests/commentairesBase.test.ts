import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import type { AppNotification, CommentsPage, Post, PostComment, Profile } from "@monapp/shared-types";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Commentaires : réponses, « j'aime », mentions (lot « vie sociale »,
// migration 0046), sur la vraie base de développement (spotto-dev-2, sur le
// Mac du fondateur) : ce que seule une vraie base prouve — les règles de la
// base (une réponse rattachée, clés uniques, pseudo en minuscules), les
// suppressions en cascade (commentaire d'origine, compte), le blocage qui
// retire les mentions dans les deux sens, et le réglage de départ.
// Sans la migration 0046, chaque test est passé (« skip »).
// Les règles de visibilité, cas par cas : commentaires.test.ts (hors base).

describe("commentaires : réponses, « j'aime », mentions, sur la base de développement", () => {
  let app: FastifyInstance;
  let author: TestUser; // public : sa publication reçoit les commentaires
  let anna: TestUser;
  let carl: TestUser;
  let dora: TestUser;
  let gone: TestUser; // compte supprimé pendant les tests
  let postId = "";
  let migrated = false;

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  const comment = async (user: TestUser, body: string, parentId?: string): Promise<PostComment> => {
    const response = await request(user, "POST", `/api/posts/${postId}/comments`, { body, ...(parentId ? { parentId } : {}) });
    expect(response.statusCode).toBe(200);
    return response.json();
  };
  const thread = async (user: TestUser): Promise<PostComment[]> => ((await request(user, "GET", `/api/posts/${postId}/comments?v=2`)).json() as CommentsPage).comments;
  const replies = async (user: TestUser, id: string): Promise<PostComment[]> => ((await request(user, "GET", `/api/comments/${id}/replies`)).json() as CommentsPage).comments;
  const rows = async (table: string, column: string, value: string) => {
    const { data, error } = await app.supabaseAdmin.from(table).select("*").eq(column, value);
    if (error) throw error;
    return data ?? [];
  };
  const everyone = (user: TestUser) => request(user, "PUT", "/api/me/mentions-from", { mentionsFrom: "everyone" });

  beforeAll(async () => {
    app = await buildTestApp();
    [author, anna, carl, dora, gone] = (await Promise.all(["cma", "cmn", "cmc", "cmd", "cmg"].map((label) => createTestUser(app, label)))) as [TestUser, TestUser, TestUser, TestUser, TestUser];
    const created = await app.supabaseAdmin
      .from("posts")
      .insert({ user_id: author.id, type: "lifestyle", media_kind: "photo", media_url: "https://example.com/p.jpg", caption: "Commentaires", privacy: "public" })
      .select("id")
      .single();
    if (created.error || !created.data) throw created.error ?? new Error("Publication de test non créée.");
    postId = created.data.id as string;
    const probes = await Promise.all([
      app.supabaseAdmin.from("comments").select("parent_id").limit(0),
      app.supabaseAdmin.from("comment_reactions").select("comment_id").limit(0),
      app.supabaseAdmin.from("comment_mentions").select("comment_id, author_id").limit(0),
      app.supabaseAdmin.from("profiles").select("mentions_from").limit(0),
    ]);
    migrated = probes.every((probe) => !probe.error);
  }, 120_000);

  afterAll(async () => {
    for (const user of [author, anna, carl, dora, gone]) if (user) await deleteTestUser(app, user.id);
    await app?.close();
  }, 120_000);

  it("un nouveau profil démarre à « les comptes que je suis » ; le réglage s'enregistre ; la base refuse une valeur inconnue", async (context) => {
    if (!migrated) return context.skip();
    expect(((await request(anna, "GET", "/api/me")).json() as Profile).mentionsFrom).toBe("following");
    expect((await request(anna, "PUT", "/api/me/mentions-from", { mentionsFrom: "nobody" })).statusCode).toBe(204);
    expect(((await request(anna, "GET", "/api/me")).json() as Profile).mentionsFrom).toBe("nobody");
    const refused = await app.supabaseAdmin.from("profiles").update({ mentions_from: "friends" }).eq("id", anna.id);
    expect(refused.error).not.toBeNull();
    for (const user of [anna, carl, dora, gone, author]) expect((await everyone(user)).statusCode).toBe(204);
  });

  it("une réponse à une réponse est rattachée au commentaire d'origine ; les réponses se lisent à part, dans l'ordre", async (context) => {
    if (!migrated) return context.skip();
    const root = await comment(carl, "Très beau manteau");
    const first = await comment(dora, "Je confirme", root.id);
    const second = await comment(anna, "Je réponds à Dora", first.id);
    expect(first.parentId).toBe(root.id);
    expect(second.parentId).toBe(root.id);
    const stored = await rows("comments", "id", second.id);
    expect(stored[0]?.parent_id).toBe(root.id);

    const list = await thread(author);
    expect(list.map((item) => item.id)).toEqual([root.id]);
    expect(list[0]).toMatchObject({ replyCount: 2, likeCount: 0, parentId: null });
    expect((await replies(author, root.id)).map((item) => item.id)).toEqual([first.id, second.id]);
    // Une app d'avant : tout à plat.
    const flat = ((await request(author, "GET", `/api/posts/${postId}/comments`)).json() as CommentsPage).comments;
    expect(flat.map((item) => item.id)).toEqual([root.id, first.id, second.id]);
    expect(((await request(author, "GET", `/api/posts/${postId}`)).json() as Post).commentCount).toBe(3);
    // Notifications : « reply » pour Carl (de Dora) et pour Dora (d'Anna), lues seulement par une app récente.
    const types = async (user: TestUser, query: string) => ((await request(user, "GET", `/api/notifications${query}`)).json() as AppNotification[]).map((item) => item.type);
    expect(await types(carl, "?v=2")).toContain("reply");
    expect(await types(dora, "?v=2")).toContain("reply");
    expect(await types(carl, "")).not.toContain("reply");
  });

  it("aimer un commentaire : un seul « j'aime » par membre (clé de la base), le nombre suit", async (context) => {
    if (!migrated) return context.skip();
    const target = await comment(carl, "À aimer");
    expect((await request(anna, "PUT", `/api/comments/${target.id}/like`, { liked: true })).json()).toEqual({ likeCount: 1, viewerHasLiked: true });
    expect((await request(anna, "PUT", `/api/comments/${target.id}/like`, { liked: true })).json()).toEqual({ likeCount: 1, viewerHasLiked: true });
    expect((await request(dora, "PUT", `/api/comments/${target.id}/like`, { liked: true })).json()).toEqual({ likeCount: 2, viewerHasLiked: true });
    const duplicate = await app.supabaseAdmin.from("comment_reactions").insert({ comment_id: target.id, user_id: anna.id });
    expect(duplicate.error).not.toBeNull();
    expect((await request(anna, "PUT", `/api/comments/${target.id}/like`, { liked: false })).json()).toEqual({ likeCount: 1, viewerHasLiked: false });
    expect((await thread(dora)).find((item) => item.id === target.id)).toMatchObject({ likeCount: 1, viewerHasLiked: true });
  });

  it("mention : une ligne et une notification ; la base refuse un pseudo en majuscules et une mention de soi-même", async (context) => {
    if (!migrated) return context.skip();
    const written = await comment(anna, `Bravo @${carl.username.toUpperCase()} et @${anna.username}`);
    expect(written.mentions).toEqual([{ handle: carl.username, userId: carl.id }]);
    const stored = await rows("comment_mentions", "comment_id", written.id);
    expect(stored.map((row) => [row.user_id, row.author_id, row.handle])).toEqual([[carl.id, anna.id, carl.username]]);
    expect((await thread(dora)).find((item) => item.id === written.id)?.mentions).toEqual([{ handle: carl.username, userId: carl.id }]);

    const upper = await app.supabaseAdmin.from("comment_mentions").insert({ comment_id: written.id, user_id: dora.id, author_id: anna.id, handle: "DORA" });
    expect(upper.error).not.toBeNull();
    const self = await app.supabaseAdmin.from("comment_mentions").insert({ comment_id: written.id, user_id: anna.id, author_id: anna.id, handle: anna.username });
    expect(self.error).not.toBeNull();

    // Carl retire sa mention : la ligne et la notification partent, le texte reste.
    expect((await request(carl, "DELETE", `/api/comments/${written.id}/mentions/me`)).statusCode).toBe(204);
    expect(await rows("comment_mentions", "comment_id", written.id)).toEqual([]);
    expect((await rows("notifications", "comment_id", written.id)).filter((row) => row.type === "mention")).toEqual([]);
    expect((await thread(dora)).find((item) => item.id === written.id)?.body).toBe(written.body);
  });

  it("un blocage retire les mentions entre les deux comptes, dans les deux sens, et pas celles des autres", async (context) => {
    if (!migrated) return context.skip();
    const annaToCarl = await comment(anna, `Regarde @${carl.username} et @${dora.username}`);
    const carlToAnna = await comment(carl, `Merci @${anna.username}`);
    expect(annaToCarl.mentions).toHaveLength(2);
    expect(carlToAnna.mentions).toHaveLength(1);

    expect((await request(carl, "POST", `/api/blocks/${anna.id}`)).statusCode).toBe(204);
    expect((await rows("comment_mentions", "comment_id", annaToCarl.id)).map((row) => row.user_id)).toEqual([dora.id]);
    expect(await rows("comment_mentions", "comment_id", carlToAnna.id)).toEqual([]);
    expect((await thread(dora)).find((item) => item.id === annaToCarl.id)?.mentions).toEqual([{ handle: dora.username, userId: dora.id }]);
    expect((await request(carl, "DELETE", `/api/blocks/${anna.id}`)).statusCode).toBe(204);
    expect(await rows("comment_mentions", "comment_id", carlToAnna.id)).toEqual([]);
  });

  it("supprimer un commentaire d'origine emporte ses réponses, leurs « j'aime », leurs mentions et leurs notifications", async (context) => {
    if (!migrated) return context.skip();
    const root = await comment(carl, "À supprimer");
    const reply = await comment(dora, `Réponse pour @${anna.username}`, root.id);
    expect(reply.mentions).toHaveLength(1);
    expect((await request(anna, "PUT", `/api/comments/${reply.id}/like`, { liked: true })).statusCode).toBe(200);
    expect((await rows("notifications", "comment_id", reply.id)).length).toBeGreaterThan(0);

    expect((await request(carl, "DELETE", `/api/comments/${root.id}`)).statusCode).toBe(204);
    expect(await rows("comments", "id", reply.id)).toEqual([]);
    expect(await rows("comment_reactions", "comment_id", reply.id)).toEqual([]);
    expect(await rows("comment_mentions", "comment_id", reply.id)).toEqual([]);
    expect(await rows("notifications", "comment_id", reply.id)).toEqual([]);
  });

  it("supprimer un compte emporte ses commentaires et leurs réponses, ses « j'aime », les mentions qu'il a écrites et celles qui le désignent", async (context) => {
    if (!migrated) return context.skip();
    const theirs = await comment(gone, `Bonjour @${anna.username}`);
    const under = await comment(dora, "Réponse sous un compte qui va partir", theirs.id);
    const others = await comment(dora, `Je cite @${gone.username}`);
    expect(theirs.mentions).toHaveLength(1);
    expect(others.mentions).toHaveLength(1);
    expect((await request(gone, "PUT", `/api/comments/${others.id}/like`, { liked: true })).statusCode).toBe(200);

    expect((await request(gone, "DELETE", "/api/me", { confirmation: "SUPPRIMER" })).statusCode).toBe(204);

    expect(await rows("comments", "id", theirs.id)).toEqual([]);
    expect(await rows("comments", "id", under.id)).toEqual([]);
    expect(await rows("comment_mentions", "author_id", gone.id)).toEqual([]);
    expect(await rows("comment_mentions", "user_id", gone.id)).toEqual([]);
    expect(await rows("comment_reactions", "user_id", gone.id)).toEqual([]);
    // Le commentaire de Dora reste, sans lien : « @pseudo » est redevenu un simple texte.
    const kept = (await thread(author)).find((item) => item.id === others.id);
    expect(kept).toMatchObject({ body: others.body, mentions: [], likeCount: 0 });
  });
});
