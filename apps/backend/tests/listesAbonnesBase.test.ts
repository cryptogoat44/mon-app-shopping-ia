import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import type { FeedPage, MemberPage, UserProfile } from "@monapp/shared-types";
import { authHeaders, buildTestApp, createTestUser, createTestUserWithoutSession, signInTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Listes des abonnés et des abonnements, et retrait d'un abonné (lot « vie
// sociale », sans migration), sur la vraie base de développement
// (spotto-dev-2, sur le Mac du fondateur) : la pagination sur de vraies
// lignes de `follows` (tri par date, curseur), le retrait d'un abonné et, si
// la migration 0045 est appliquée, la perte d'accès à un compte privé.
// Les règles elles-mêmes, cas par cas : listesAbonnes.test.ts (hors base).

const FOLLOWERS = 35;

describe("listes des abonnés et des abonnements, sur la base de développement", () => {
  let app: FastifyInstance;
  let owner: TestUser; // public : 35 abonnés
  let reader: TestUser; // lit la liste, n'est abonné à personne
  let paula: TestUser; // compte privé (si 0045)
  let followers: TestUser[] = [];
  let migrated = false;

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  const followersOf = async (target: TestUser): Promise<string[]> => {
    const { data, error } = await app.supabaseAdmin.from("follows").select("follower_id").eq("followee_id", target.id);
    if (error) throw error;
    return (data ?? []).map((row) => row.follower_id as string).sort();
  };
  /** Toutes les pages d'une liste, dans l'ordre. */
  async function allPages(user: TestUser, url: string): Promise<MemberPage[]> {
    const pages: MemberPage[] = [];
    let cursor: string | null = null;
    do {
      const response = await request(user, "GET", cursor ? `${url}?cursor=${encodeURIComponent(cursor)}` : url);
      expect(response.statusCode).toBe(200);
      const page: MemberPage = response.json();
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor !== null && pages.length < 10);
    return pages;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    [owner, reader, paula] = (await Promise.all(["lao", "lar", "lap"].map((label) => createTestUser(app, label)))) as [TestUser, TestUser, TestUser];
    // Par petits groupes, SANS connexion : le service de connexion de Supabase limite le nombre de connexions par quelques
    // minutes. Seuls les deux premiers abonnés appellent l'API (« isMe », compte privé) : on les connecte.
    for (let start = 0; start < FOLLOWERS; start += 5) {
      const group = await Promise.all(Array.from({ length: Math.min(5, FOLLOWERS - start) }, (_, index) => createTestUserWithoutSession(app, `la${start + index}`)));
      followers.push(...group);
    }
    followers[0] = await signInTestUser(followers[0]!);
    followers[1] = await signInTestUser(followers[1]!);
    // Des dates espacées d'une minute : l'ordre de la liste est connu (le dernier du tableau est le plus récent).
    const base = Date.now() - 60 * 60_000;
    const { error } = await app.supabaseAdmin.from("follows").insert(
      followers.map((follower, index) => ({ follower_id: follower.id, followee_id: owner.id, created_at: new Date(base + index * 60_000).toISOString() }))
    );
    if (error) throw error;
    const [column, table] = await Promise.all([app.supabaseAdmin.from("profiles").select("is_private").limit(0), app.supabaseAdmin.from("follow_requests").select("requester_id").limit(0)]);
    migrated = !column.error && !table.error;
  }, 300_000);

  afterAll(async () => {
    for (const user of [owner, reader, paula, ...followers]) if (user) await deleteTestUser(app, user.id);
    followers = [];
    await app?.close();
  }, 300_000);

  it("35 abonnés : deux pages (30 puis 5), les plus récents d'abord, sans doublon ni oubli", async () => {
    const pages = await allPages(reader, `/api/users/${owner.id}/followers`);
    expect(pages.map((page) => page.members.length)).toEqual([30, 5]);
    expect(pages[0]!.nextCursor).not.toBeNull();
    expect(pages[1]!.nextCursor).toBeNull();
    const ids = pages.flatMap((page) => page.members.map((member) => member.id));
    expect(ids).toEqual([...followers].reverse().map((follower) => follower.id));
    expect(pages[0]!.members[0]).toMatchObject({ id: followers.at(-1)!.id, username: followers.at(-1)!.username, isMe: false, followState: "none", isFollowing: false });
    // Jamais la date de l'abonnement.
    expect(JSON.stringify(pages)).not.toMatch(/created_?at/i);
    const profile: UserProfile = (await request(reader, "GET", `/api/users/${owner.id}`)).json();
    expect(profile.followersCount).toBe(FOLLOWERS);
  });

  it("abonnements : la liste d'un abonné contient le compte suivi ; le lecteur se reconnaît dans une liste (« isMe »)", async () => {
    const [page] = await allPages(reader, `/api/users/${followers[0]!.id}/following`);
    expect(page!.members.map((member) => member.id)).toEqual([owner.id]);
    const own = await allPages(followers[0]!, `/api/users/${owner.id}/followers`);
    expect(own[1]!.members.at(-1)).toMatchObject({ id: followers[0]!.id, isMe: true });
  });

  it("un compte bloqué par le lecteur disparaît de sa page ; le curseur ne bouge pas", async () => {
    const hidden = followers[20]!;
    expect((await request(reader, "POST", `/api/blocks/${hidden.id}`)).statusCode).toBe(204);
    const pages = await allPages(reader, `/api/users/${owner.id}/followers`);
    expect(pages.map((page) => page.members.length)).toEqual([29, 5]);
    expect(pages.flatMap((page) => page.members.map((member) => member.id))).not.toContain(hidden.id);
    expect((await request(reader, "DELETE", `/api/blocks/${hidden.id}`)).statusCode).toBe(204);
  });

  it("retirer un abonné : seul le compte suivi le peut, la ligne disparaît, et recommencer répond pareil", async () => {
    const removed = followers[34]!;
    // Un autre membre ne retire rien.
    expect((await request(reader, "DELETE", `/api/followers/${removed.id}`)).statusCode).toBe(204);
    expect(await followersOf(owner)).toHaveLength(FOLLOWERS);

    expect((await request(owner, "DELETE", `/api/followers/${removed.id}`)).statusCode).toBe(204);
    expect(await followersOf(owner)).not.toContain(removed.id);
    expect(await followersOf(owner)).toHaveLength(FOLLOWERS - 1);
    // Idempotent.
    expect((await request(owner, "DELETE", `/api/followers/${removed.id}`)).statusCode).toBe(204);
    expect(await followersOf(owner)).toHaveLength(FOLLOWERS - 1);
    // Aucune notification pour la personne retirée.
    const { data, error } = await app.supabaseAdmin.from("notifications").select("id").eq("user_id", removed.id).eq("actor_id", owner.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
    // Compte public : elle peut se réabonner aussitôt.
    expect((await request(removed, "POST", `/api/follows/${owner.id}?v=2`)).json()).toEqual({ state: "following" });
  });

  it("règle 7 : l'abonné retiré d'un compte privé perd l'accès aussitôt (migration 0045)", async (context) => {
    if (!migrated) return context.skip();
    const fan = followers[1]!;
    const { data, error } = await app.supabaseAdmin
      .from("posts")
      .insert({ user_id: paula.id, type: "lifestyle", media_kind: "photo", media_url: "https://example.com/p.jpg", caption: "Listes", privacy: "followers" })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("Publication de test non créée.");
    expect((await request(fan, "POST", `/api/follows/${paula.id}?v=2`)).json()).toEqual({ state: "following" });
    expect((await request(paula, "PUT", "/api/me/private-account", { isPrivate: true })).statusCode).toBe(204);

    const postsSeen = async () => ((await request(fan, "GET", `/api/users/${paula.id}/posts`)).json() as FeedPage).posts.map((post) => post.id);
    expect(await postsSeen()).toEqual([data.id]);
    expect((await request(fan, "GET", `/api/users/${paula.id}/followers`)).statusCode).toBe(200);
    // Un inconnu : 403, et le compte privé n'apparaît pas pour lui dans les abonnements de son abonné.
    expect((await request(reader, "GET", `/api/users/${paula.id}/followers`)).statusCode).toBe(403);
    const seenByStranger: MemberPage = (await request(reader, "GET", `/api/users/${fan.id}/following`)).json();
    expect(seenByStranger.members.map((member) => member.id)).not.toContain(paula.id);

    expect((await request(paula, "DELETE", `/api/followers/${fan.id}`)).statusCode).toBe(204);
    expect(await postsSeen()).toEqual([]);
    expect((await request(fan, "GET", `/api/users/${paula.id}/followers`)).statusCode).toBe(403);
    expect((await request(fan, "GET", `/api/posts/${data.id as string}`)).statusCode).toBe(404);
    // Elle ne redevient pas abonnée sans accord : seulement une demande.
    expect((await request(fan, "POST", `/api/follows/${paula.id}?v=2`)).json()).toEqual({ state: "requested" });
    expect(await followersOf(paula)).toEqual([]);
  });
});
