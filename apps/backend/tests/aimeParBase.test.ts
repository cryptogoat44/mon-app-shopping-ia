import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import type { MemberPage, Post } from "@monapp/shared-types";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Liste « Aimé par » (lot « vie sociale », sans migration), sur la vraie base
// de développement (spotto-dev-2, sur le Mac du fondateur) : la pagination
// sur de vraies lignes de `post_reactions` (tri par date, curseur), aimer puis
// ne plus aimer, les nombres sans les comptes bloqués et, si la migration
// 0045 est appliquée, le compte privé qui a aimé.
// Les règles elles-mêmes, cas par cas : aimePar.test.ts (hors base).

const LIKERS = 35;

describe("liste « Aimé par », sur la base de développement", () => {
  let app: FastifyInstance;
  let author: TestUser; // public : sa publication reçoit 35 « j'aime »
  let reader: TestUser; // lit la liste, n'est abonné à personne
  let paula: TestUser; // compte privé (si 0045)
  let fan: TestUser; // abonné accepté de Paula
  let likers: TestUser[] = [];
  let postId = "";
  let migrated = false;

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  /** Toutes les pages de la liste, dans l'ordre. */
  async function allPages(user: TestUser): Promise<MemberPage[]> {
    const pages: MemberPage[] = [];
    let cursor: string | null = null;
    do {
      const url = `/api/posts/${postId}/likes`;
      const response = await request(user, "GET", cursor ? `${url}?cursor=${encodeURIComponent(cursor)}` : url);
      expect(response.statusCode).toBe(200);
      const page: MemberPage = response.json();
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor !== null && pages.length < 10);
    return pages;
  }
  const idsOf = (pages: MemberPage[]) => pages.flatMap((page) => page.members.map((member) => member.id));
  const postSeenBy = async (user: TestUser): Promise<Post> => (await request(user, "GET", `/api/posts/${postId}`)).json();

  beforeAll(async () => {
    app = await buildTestApp();
    [author, reader, paula, fan] = (await Promise.all(["apa", "apr", "app", "apf"].map((label) => createTestUser(app, label)))) as [TestUser, TestUser, TestUser, TestUser];
    // Par petits groupes : 35 comptes jetables sans bousculer le service d'authentification.
    for (let start = 0; start < LIKERS; start += 5) {
      const group = await Promise.all(Array.from({ length: Math.min(5, LIKERS - start) }, (_, index) => createTestUser(app, `ap${start + index}`)));
      likers.push(...group);
    }
    const created = await app.supabaseAdmin
      .from("posts")
      .insert({ user_id: author.id, type: "lifestyle", media_kind: "photo", media_url: "https://example.com/p.jpg", caption: "Aimé par", privacy: "public" })
      .select("id")
      .single();
    if (created.error || !created.data) throw created.error ?? new Error("Publication de test non créée.");
    postId = created.data.id as string;
    // Des dates espacées d'une minute : l'ordre de la liste est connu (le dernier du tableau est le plus récent).
    const base = Date.now() - 60 * 60_000;
    const { error } = await app.supabaseAdmin.from("post_reactions").insert(
      likers.map((liker, index) => ({ post_id: postId, user_id: liker.id, created_at: new Date(base + index * 60_000).toISOString() }))
    );
    if (error) throw error;
    const [column, table] = await Promise.all([app.supabaseAdmin.from("profiles").select("is_private").limit(0), app.supabaseAdmin.from("follow_requests").select("requester_id").limit(0)]);
    migrated = !column.error && !table.error;
  }, 300_000);

  afterAll(async () => {
    for (const user of [author, reader, paula, fan, ...likers]) if (user) await deleteTestUser(app, user.id);
    likers = [];
    await app?.close();
  }, 300_000);

  it("35 « j'aime » : deux pages (30 puis 5), les plus récents d'abord, sans doublon ni oubli", async () => {
    const pages = await allPages(reader);
    expect(pages.map((page) => page.members.length)).toEqual([30, 5]);
    expect(pages[0]!.nextCursor).not.toBeNull();
    expect(pages[1]!.nextCursor).toBeNull();
    expect(idsOf(pages)).toEqual([...likers].reverse().map((liker) => liker.id));
    expect(pages[0]!.members[0]).toMatchObject({ id: likers.at(-1)!.id, username: likers.at(-1)!.username, isMe: false, followState: "none", isFollowing: false });
    // Jamais la date d'un « j'aime » dans une ligne.
    expect(JSON.stringify(pages.map((page) => page.members))).not.toMatch(/created_?at|\d{4}-\d{2}-\d{2}T/i);
    expect((await postSeenBy(reader)).reactionCount).toBe(LIKERS);
  });

  it("aimer : en tête de la liste ; ne plus aimer : la ligne disparaît", async () => {
    expect((await request(reader, "POST", `/api/posts/${postId}/react`)).json()).toEqual({ reactionCount: LIKERS + 1, viewerHasReacted: true });
    const liked = await allPages(author);
    expect(liked[0]!.members[0]).toMatchObject({ id: reader.id });
    expect(idsOf(liked)).toHaveLength(LIKERS + 1);
    expect((await allPages(reader))[0]!.members[0]).toMatchObject({ id: reader.id, isMe: true });

    expect((await request(reader, "POST", `/api/posts/${postId}/react`)).json()).toEqual({ reactionCount: LIKERS, viewerHasReacted: false });
    expect(idsOf(await allPages(author))).not.toContain(reader.id);
  });

  it("un compte bloqué par le lecteur disparaît de la liste ET du nombre ; le curseur ne bouge pas", async () => {
    const hidden = likers[20]!;
    expect((await request(reader, "POST", `/api/blocks/${hidden.id}`)).statusCode).toBe(204);
    const pages = await allPages(reader);
    expect(pages.map((page) => page.members.length)).toEqual([29, 5]);
    expect(idsOf(pages)).not.toContain(hidden.id);
    expect((await postSeenBy(reader)).reactionCount).toBe(LIKERS - 1);
    // Pour le compte bloqué (le lecteur n'a pas aimé) et pour l'auteur, rien ne change.
    expect((await postSeenBy(hidden)).reactionCount).toBe(LIKERS);
    expect((await postSeenBy(author)).reactionCount).toBe(LIKERS);
    expect((await request(reader, "DELETE", `/api/blocks/${hidden.id}`)).statusCode).toBe(204);
    expect((await postSeenBy(reader)).reactionCount).toBe(LIKERS);
  });

  it("publication masquée, ou auteur en blocage avec le lecteur : 404, comme une publication inconnue", async () => {
    expect((await request(reader, "POST", `/api/blocks/${author.id}`)).statusCode).toBe(204);
    const blocked = await request(reader, "GET", `/api/posts/${postId}/likes`);
    expect(blocked.statusCode).toBe(404);
    expect(blocked.json()).toEqual({ error: "post_not_found", message: "Publication introuvable." });
    expect((await request(reader, "DELETE", `/api/blocks/${author.id}`)).statusCode).toBe(204);
    expect((await request(reader, "GET", `/api/posts/${postId}/likes`)).statusCode).toBe(200);
  });

  it("règle 4 : le compte privé qui a aimé est vu par son abonné, par l'auteur et par lui-même, pas par un inconnu (migration 0045)", async (context) => {
    if (!migrated) return context.skip();
    expect((await request(fan, "POST", `/api/follows/${paula.id}?v=2`)).json()).toEqual({ state: "following" });
    expect((await request(paula, "PUT", "/api/me/private-account", { isPrivate: true })).statusCode).toBe(204);
    expect((await request(paula, "POST", `/api/posts/${postId}/react`)).json()).toEqual({ reactionCount: LIKERS + 1, viewerHasReacted: true });

    // Refusé : l'inconnu ne voit pas Paula ; le nombre, lui, la compte.
    const stranger = await allPages(reader);
    expect(idsOf(stranger)).not.toContain(paula.id);
    expect(JSON.stringify(stranger)).not.toContain(paula.username);
    expect(idsOf(stranger)).toHaveLength(LIKERS);
    expect((await postSeenBy(reader)).reactionCount).toBe(LIKERS + 1);
    // Permis : son abonné accepté, l'auteur de la publication, elle-même.
    for (const viewer of [fan, author, paula]) expect((await allPages(viewer))[0]!.members[0], viewer.username).toMatchObject({ id: paula.id, isPrivate: true });

    // Retirée de ses abonnés, la personne ne la voit plus dans la liste.
    expect((await request(paula, "DELETE", `/api/followers/${fan.id}`)).statusCode).toBe(204);
    expect(idsOf(await allPages(fan))).not.toContain(paula.id);
    expect((await request(paula, "POST", `/api/posts/${postId}/react`)).json()).toEqual({ reactionCount: LIKERS, viewerHasReacted: false });
  });
});
