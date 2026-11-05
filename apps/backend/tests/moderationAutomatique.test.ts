import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import sharp from "sharp";
import type { AppNotification, ModerationItem, ModerationPage } from "@monapp/shared-types";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Chantier 3 (comptes et modération, point 6 de la feuille de route V1) :
// masquage automatique après les signalements de 3 personnes différentes
// (migration 0030), contenu signalé retiré de ce que voit la personne qui
// l'a signalé, filtre des mots interdits. Test « avec base » : sur le Mac,
// avec spotto-dev-2. Sans la migration 0030, les tests du masquage
// automatique sont sautés (le serveur s'en passe : lib/autoHide.ts).
describe("chantier 3 : masquage automatique, contenu signalé, mots interdits", () => {
  let app: FastifyInstance;
  let admin: TestUser;
  let author: TestUser;
  let reporters: TestUser[] = [];
  let photo: Buffer;
  let has0030 = false;

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), payload });
  const report = async (user: TestUser, targetType: string, targetId: string, reason = "harassment") =>
    expect((await request(user, "POST", "/api/reports", { targetType, targetId, reason })).statusCode).toBe(204);
  const decide = (payload: object) => request(admin, "POST", "/api/admin/moderation/actions", payload);
  const visibleToAuthor = async (postId: string) => (await request(author, "GET", `/api/posts/${postId}`)).statusCode === 200;
  const notifications = async (user: TestUser): Promise<AppNotification[]> => (await request(user, "GET", "/api/notifications")).json();
  const feedIds = async (user: TestUser): Promise<string[]> => (await request(user, "GET", "/api/feed")).json().posts.map((p: { id: string }) => p.id);
  const profilePostIds = async (viewer: TestUser): Promise<string[]> =>
    (await request(viewer, "GET", `/api/users/${author.id}/posts`)).json().posts.map((p: { id: string }) => p.id);

  async function itemFor(status: "open" | "handled", targetId: string): Promise<ModerationItem | undefined> {
    const page: ModerationPage = (await request(admin, "GET", `/api/admin/moderation?status=${status}`)).json();
    return page.items.find((item) => item.targetId === targetId);
  }

  async function publish(caption: string): Promise<string> {
    const mp = buildMultipart({ type: "lifestyle", privacy: "public", caption }, { fieldname: "file", filename: "p.jpg", contentType: "image/jpeg", data: photo });
    const res = await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(author.token), ...mp.headers }, payload: mp.payload });
    expect(res.statusCode).toBe(200);
    return res.json().id;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    const users = await Promise.all(["mxa", "mxu", "mx1", "mx2", "mx3", "mx4"].map((label) => createTestUser(app, label)));
    [admin, author] = users as [TestUser, TestUser];
    reporters = users.slice(2);
    photo = await sharp({ create: { width: 12, height: 12, channels: 3, background: "#753" } }).jpeg().toBuffer();
    const { error } = await app.supabaseAdmin.from("admins").insert({ user_id: admin.id });
    if (error) throw error;
    const probe = await app.supabaseAdmin.rpc("moderation_auto_hide", { p_target_type: "post", p_target_id: randomUUID(), p_threshold: 3 });
    has0030 = !probe.error;
  });

  afterAll(async () => {
    for (const user of [admin, author, ...reporters]) await deleteTestUser(app, user.id);
    await app.close();
  });

  it("2 personnes ne suffisent pas ; la 3e masque la publication, l'auteur est prévenu, les signalements restent à traiter", async (context) => {
    if (!has0030) context.skip();
    const [r1, r2, r3] = reporters as [TestUser, TestUser, TestUser];
    const postId = await publish("Masquée après trois signalements");
    await report(r1, "post", postId);
    await report(r1, "post", postId, "spam"); // la même personne ne compte qu'une fois
    await report(r2, "post", postId);
    expect(await visibleToAuthor(postId)).toBe(true);
    await report(r3, "post", postId);
    expect(await visibleToAuthor(postId)).toBe(false);

    const notice = (await notifications(author)).find((n) => n.type === "moderation" && n.moderation?.action === "hide");
    expect(notice?.moderation).toMatchObject({ action: "hide", targetType: "post", reason: "harassment" });
    const item = await itemFor("open", postId);
    expect(item).toMatchObject({ reportCount: 4, activeHideAutomatic: true, preview: { kind: "post", hidden: true } });
    expect(item?.history[0]).toMatchObject({ action: "hide", automatic: true, adminUsername: null });

    // « Classer sans suite » : le contenu est rétabli, les signalements sont clos.
    expect((await decide({ targetType: "post", targetId: postId, action: "dismiss" })).statusCode).toBe(200);
    expect(await visibleToAuthor(postId)).toBe(true);
    const handled = await itemFor("handled", postId);
    expect(handled).toMatchObject({ activeHideActionId: null, activeHideAutomatic: false, preview: { hidden: false } });
    expect(handled?.history.map((entry) => entry.action)).toEqual(expect.arrayContaining(["dismiss", "restore", "hide"]));
    expect((await notifications(author)).some((n) => n.type === "moderation" && n.moderation?.action === "restore")).toBe(true);
  });

  it("« Masquer » confirme le masquage automatique (pas de « déjà masqué »), sans prévenir l'auteur une 2e fois", async (context) => {
    if (!has0030) context.skip();
    const postId = await publish("Masquage confirmé");
    for (const reporter of reporters.slice(0, 3)) await report(reporter, "post", postId);
    expect(await visibleToAuthor(postId)).toBe(false);
    const confirmed = await decide({ targetType: "post", targetId: postId, action: "hide", reason: "inappropriate" });
    expect(confirmed.statusCode).toBe(200);
    expect(await visibleToAuthor(postId)).toBe(false);
    const item = await itemFor("handled", postId);
    expect(item).toMatchObject({ activeHideActionId: confirmed.json().actionId, activeHideAutomatic: false });
    // Une seule notification « masquée » pour cette publication (celle du masquage automatique).
    const all = await app.supabaseAdmin.from("moderation_actions").select("id").eq("target_id", postId).eq("action", "hide");
    const ids = (all.data ?? []).map((row: { id: string }) => row.id);
    const hiddenNotices = (await notifications(author)).filter((n) => n.type === "moderation" && n.moderation?.action === "hide");
    expect(ids).toHaveLength(2);
    expect(hiddenNotices.length).toBeGreaterThanOrEqual(1);
    const { count } = await app.supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", author.id)
      .in("moderation_action_id", ids);
    expect(count).toBe(1);
  });

  it("rétabli par un administrateur : il ne se remasque qu'avec de nouveaux signalements", async (context) => {
    if (!has0030) context.skip();
    const postId = await publish("Rétablie");
    for (const reporter of reporters.slice(0, 3)) await report(reporter, "post", postId);
    const item = await itemFor("open", postId);
    expect(item?.activeHideActionId).toBeTruthy();
    expect((await request(admin, "POST", `/api/admin/moderation/actions/${item!.activeHideActionId}/undo`, {})).statusCode).toBe(200);
    expect(await visibleToAuthor(postId)).toBe(true);
    await report(reporters[3]!, "post", postId); // un seul nouveau signalement depuis le rétablissement
    expect(await visibleToAuthor(postId)).toBe(true);
  });

  it("la personne qui signale ne voit plus la publication (fil, profil) ; les autres, si", async () => {
    const [r1, r2] = reporters as [TestUser, TestUser];
    for (const follower of [r1, r2]) expect((await request(follower, "POST", `/api/follows/${author.id}`)).statusCode).toBe(204);
    const postId = await publish("Signalée par une seule personne");
    expect(await feedIds(r1)).toContain(postId);
    await report(r1, "post", postId, "spam");
    expect(await feedIds(r1)).not.toContain(postId);
    expect(await profilePostIds(r1)).not.toContain(postId);
    expect(await feedIds(r2)).toContain(postId);
    expect(await profilePostIds(r2)).toContain(postId);
    expect(await visibleToAuthor(postId)).toBe(true);
  });

  it("un commentaire signalé disparaît pour la personne qui l'a signalé", async () => {
    const [r1, r2] = reporters as [TestUser, TestUser];
    const postId = await publish("Avec commentaire");
    const created = await request(r2, "POST", `/api/posts/${postId}/comments`, { body: "Un commentaire" });
    expect(created.statusCode).toBe(200);
    const commentId = created.json().id;
    await report(r1, "comment", commentId, "spam");
    const seen = async (user: TestUser) => (await request(user, "GET", `/api/posts/${postId}/comments`)).json().comments.map((c: { id: string }) => c.id);
    expect(await seen(r1)).not.toContain(commentId);
    expect(await seen(author)).toContain(commentId);
  });

  it("mots interdits : légende, commentaire, nom et bio refusés (400 content_not_allowed), rien n'est enregistré", async () => {
    const mp = buildMultipart({ type: "lifestyle", privacy: "public", caption: "Quelle bande de connards" }, { fieldname: "file", filename: "p.jpg", contentType: "image/jpeg", data: photo });
    const post = await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(author.token), ...mp.headers }, payload: mp.payload });
    expect(post.statusCode).toBe(400);
    expect(post.json().error).toBe("content_not_allowed");

    const postId = await publish("Une veste en lin");
    const comment = await request(reporters[0]!, "POST", `/api/posts/${postId}/comments`, { body: "fils de pute" });
    expect(comment.statusCode).toBe(400);
    expect(comment.json().error).toBe("content_not_allowed");

    const me = (await request(author, "GET", "/api/me")).json();
    for (const change of [{ displayName: "Marie la salope" }, { bio: "fuck you all" }, { username: "fuck_off_75" }]) {
      const res = await request(author, "PATCH", "/api/me", { username: me.username, displayName: me.displayName, ...change });
      expect(res.statusCode, JSON.stringify(change)).toBe(400);
      expect(res.json().error).toBe("content_not_allowed");
    }
    expect((await request(author, "GET", "/api/me")).json().displayName).toBe(me.displayName);
    const english = await app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: { ...authHeaders(author.token), "accept-language": "en" },
      payload: { username: me.username, displayName: "bitch" },
    });
    expect(english.json().message).toMatch(/isn't allowed on Spotto/);
  });
});
