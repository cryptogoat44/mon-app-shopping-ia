import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import sharp from "sharp";
import { ACCOUNT_DELETION_WORDS, type AppNotification } from "@monapp/shared-types";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Lot 5, section 5.B : effets d'une décision. Un contenu masqué disparaît
// partout (fil, profil, détail et liens partagés, commentaires, « j'aime »,
// notifications), même pour son auteur ; un compte suspendu ne peut plus
// publier, commenter, suivre, réagir ni modifier son profil, et n'apparaît
// plus en recherche. Tout revient à l'annulation.
describe("modération : effets d'un masquage et d'une suspension", () => {
  let app: FastifyInstance;
  let admin: TestUser;
  let author: TestUser;
  let follower: TestUser; // suit l'auteur, commente et aime
  let reporter: TestUser;
  let photo: Buffer;
  let hiddenPost = "";
  let keptPost = "";
  let hidePostAction = "";
  let suspendAction = "";

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object, headers: Record<string, string> = {}) =>
    app.inject({ method, url, headers: { ...authHeaders(user.token), ...headers }, payload });
  const decide = async (payload: object): Promise<string> => {
    const res = await request(admin, "POST", "/api/admin/moderation/actions", payload);
    expect(res.statusCode).toBe(200);
    return res.json().actionId;
  };
  const undo = async (actionId: string) => expect((await request(admin, "POST", `/api/admin/moderation/actions/${actionId}/undo`, {})).statusCode).toBe(200);
  const report = async (user: TestUser, targetType: string, targetId: string) =>
    expect((await request(user, "POST", "/api/reports", { targetType, targetId, reason: "harassment" })).statusCode).toBe(204);
  const feedIds = async (user: TestUser): Promise<string[]> =>
    (await request(user, "GET", "/api/feed")).json().posts.map((post: { id: string }) => post.id);
  const profilePostIds = async (viewer: TestUser): Promise<string[]> =>
    (await request(viewer, "GET", `/api/users/${author.id}/posts`)).json().posts.map((post: { id: string }) => post.id);
  const notifications = async (user: TestUser): Promise<AppNotification[]> => (await request(user, "GET", "/api/notifications")).json();
  const unreadCount = async (user: TestUser): Promise<number> => (await request(user, "GET", "/api/notifications/unread-count")).json().count;

  async function publish(user: TestUser, caption: string): Promise<string> {
    const mp = buildMultipart({ type: "lifestyle", privacy: "public", caption }, { fieldname: "file", filename: "p.jpg", contentType: "image/jpeg", data: photo });
    const res = await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(user.token), ...mp.headers }, payload: mp.payload });
    return res.statusCode === 200 ? res.json().id : `refusé ${res.statusCode} ${res.json().error}`;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    [admin, author, follower, reporter] = await Promise.all([
      createTestUser(app, "mea"),
      createTestUser(app, "meu"),
      createTestUser(app, "mef"),
      createTestUser(app, "mer"),
    ]);
    photo = await sharp({ create: { width: 12, height: 12, channels: 3, background: "#654" } }).jpeg().toBuffer();
    const { error } = await app.supabaseAdmin.from("admins").insert({ user_id: admin.id });
    if (error) throw error;
    expect((await request(follower, "POST", `/api/follows/${author.id}`)).statusCode).toBe(204);
    hiddenPost = await publish(author, "À masquer");
    keptPost = await publish(author, "Gardée");
    expect((await request(follower, "POST", `/api/posts/${hiddenPost}/comments`, { body: "Commentaire" })).statusCode).toBe(200);
    expect((await request(follower, "POST", `/api/posts/${hiddenPost}/react`)).statusCode).toBe(200);
  });

  afterAll(async () => {
    for (const user of [admin, author, follower, reporter]) await deleteTestUser(app, user.id);
    await app.close();
  });

  it("publication masquée : absente du fil, du profil, du détail (lien partagé), des commentaires et des « j'aime », même pour son auteur", async () => {
    const likeAndComment = (await notifications(author)).filter((n) => n.postId === hiddenPost);
    expect(likeAndComment.map((n) => n.type).sort()).toEqual(["comment", "like"]);
    await report(reporter, "post", hiddenPost);
    hidePostAction = await decide({ targetType: "post", targetId: hiddenPost, action: "hide", reason: "harassment" });

    for (const viewer of [author, follower]) {
      expect(await feedIds(viewer)).not.toContain(hiddenPost);
      expect(await profilePostIds(viewer)).not.toContain(hiddenPost);
      expect((await request(viewer, "GET", `/api/posts/${hiddenPost}`)).statusCode).toBe(404);
      expect((await request(viewer, "GET", `/api/posts/${hiddenPost}/comments`)).statusCode).toBe(404);
    }
    expect(await feedIds(follower)).toContain(keptPost);
    expect((await request(follower, "POST", `/api/posts/${hiddenPost}/comments`, { body: "Encore" })).statusCode).toBe(404);
    expect((await request(follower, "POST", `/api/posts/${hiddenPost}/react`)).statusCode).toBe(404);
    expect((await request(author, "PATCH", `/api/posts/${hiddenPost}`, { privacy: "private" })).statusCode).toBe(404);
    expect((await request(follower, "GET", `/api/users/${author.id}`)).json().postsCount).toBe(1);
    expect((await request(author, "GET", "/api/me")).json().postsCount).toBe(1);
  });

  it("publication masquée : ses notifications « j'aime » et commentaire disparaissent, le compteur aussi ; l'export la garde", async () => {
    const visible = await notifications(author);
    expect(visible.filter((n) => n.postId === hiddenPost)).toEqual([]);
    expect(await unreadCount(author)).toBe(visible.filter((n) => !n.read).length);
    const exported = (await request(author, "GET", "/api/me/export")).json();
    const hidden = exported.posts.find((post: { id: string }) => post.id === hiddenPost);
    expect(hidden?.hidden_at).toEqual(expect.any(String));
  });

  it("annulation : la publication et ses notifications reviennent", async () => {
    await undo(hidePostAction);
    expect(await feedIds(follower)).toContain(hiddenPost);
    expect((await request(follower, "GET", `/api/posts/${hiddenPost}`)).statusCode).toBe(200);
    expect((await notifications(author)).filter((n) => n.postId === hiddenPost).map((n) => n.type).sort()).toEqual(["comment", "like"]);
    expect((await request(author, "GET", "/api/me")).json().postsCount).toBe(2);
  });

  it("commentaire masqué : absent de la liste et du compteur, sa notification aussi ; son auteur est informé", async () => {
    const created = await request(follower, "POST", `/api/posts/${keptPost}/comments`, { body: "Commentaire déplacé" });
    const commentId = created.json().id;
    await report(reporter, "comment", commentId);
    await decide({ targetType: "comment", targetId: commentId, action: "hide", reason: "inappropriate" });

    const list = (await request(author, "GET", `/api/posts/${keptPost}/comments`)).json().comments.map((c: { id: string }) => c.id);
    expect(list).not.toContain(commentId);
    expect((await request(author, "GET", `/api/posts/${keptPost}`)).json().commentCount).toBe(0);
    expect((await notifications(author)).filter((n) => n.type === "comment" && n.postId === keptPost)).toEqual([]);
    const notice = (await notifications(follower)).find((n) => n.type === "moderation");
    expect(notice?.moderation).toMatchObject({ action: "hide", targetType: "comment", reason: "inappropriate" });
  });

  it("compte suspendu : ne peut plus publier, commenter, suivre, réagir ni modifier son profil", async () => {
    await report(reporter, "user", author.id);
    suspendAction = await decide({ targetType: "user", targetId: author.id, action: "suspend", reason: "spam", note: "Messages répétés." });

    expect(await publish(author, "Interdite")).toBe("refusé 403 account_suspended");
    const refused: [InjectOptions["method"], string, object?][] = [
      ["POST", `/api/posts/${keptPost}/comments`, { body: "Non" }],
      ["POST", `/api/posts/${keptPost}/react`],
      ["POST", `/api/follows/${reporter.id}`],
      ["PATCH", "/api/me", { username: author.username, displayName: "Autre nom" }],
    ];
    for (const [method, url, payload] of refused) {
      const res = await request(author, method, url, payload);
      expect(res.statusCode, url).toBe(403);
      expect(res.json()).toEqual({ error: "account_suspended", message: "Votre compte est suspendu : cette action n'est plus possible." });
    }
    const avatar = buildMultipart({}, { fieldname: "file", filename: "a.jpg", contentType: "image/jpeg", data: photo });
    expect((await request(author, "POST", "/api/me/avatar", avatar.payload, avatar.headers)).statusCode).toBe(403);
    const english = await request(author, "POST", `/api/follows/${reporter.id}`, undefined, { "accept-language": "en" });
    expect(english.json().message).toBe("Your account is suspended: this action is no longer available.");
  });

  it("compte suspendu : informé du motif, absent de la recherche ; ses publications restent ; il peut encore signaler et lire", async () => {
    const notice = (await notifications(author)).find((n) => n.moderation?.action === "suspend");
    expect(notice).toMatchObject({ actor: null, moderation: { targetType: "user", reason: "spam", note: "Messages répétés." } });
    const search = await request(follower, "GET", `/api/users/search?q=${author.username}`);
    expect(search.json().map((p: { id: string }) => p.id)).not.toContain(author.id);
    expect((await request(follower, "GET", `/api/posts/${keptPost}`)).statusCode).toBe(200);
    expect((await request(author, "GET", "/api/feed")).statusCode).toBe(200);
    expect((await request(author, "POST", "/api/reports", { targetType: "user", targetId: reporter.id, reason: "spam" })).statusCode).toBe(204);

    const again = await request(admin, "POST", "/api/admin/moderation/actions", { targetType: "post", targetId: keptPost, action: "suspend", reason: "spam" });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("already_suspended");
  });

  it("export : suspension et décisions qui vous concernent (sans l'administrateur) ; décisions prises pour l'administrateur", async () => {
    const mine = (await request(author, "GET", "/api/me/export")).json();
    expect(mine.adminRole).toBeNull();
    expect(mine.suspension).toMatchObject({ moderation_action_id: suspendAction });
    expect(mine.moderationDecisionsAboutMe.map((d: { action: string }) => d.action)).toEqual(expect.arrayContaining(["hide", "restore", "suspend"]));
    for (const decision of mine.moderationDecisionsAboutMe) expect(decision).not.toHaveProperty("admin_id");
    expect(JSON.stringify(mine)).not.toContain(admin.id);

    const theirs = (await request(admin, "GET", "/api/me/export")).json();
    expect(theirs.adminRole).toEqual({ created_at: expect.any(String) });
    expect(theirs.moderationDecisionsTaken.length).toBeGreaterThanOrEqual(4);
  });

  it("levée de la suspension : il peut de nouveau suivre, et réapparaît en recherche", async () => {
    await undo(suspendAction);
    expect((await request(author, "POST", `/api/follows/${reporter.id}`)).statusCode).toBe(204);
    const search = await request(follower, "GET", `/api/users/search?q=${author.username}`);
    expect(search.json().map((p: { id: string }) => p.id)).toContain(author.id);
    expect((await notifications(author)).some((n) => n.moderation?.action === "unsuspend")).toBe(true);
  });

  it("les messages de la modération restent visibles malgré un blocage (aucun auteur affiché)", async () => {
    expect((await request(reporter, "POST", `/api/blocks/${follower.id}`)).statusCode).toBe(204);
    const list = await notifications(reporter);
    expect(list.filter((n) => n.type === "report_handled").length).toBeGreaterThanOrEqual(3);
    expect(await unreadCount(reporter)).toBe(list.filter((n) => !n.read).length);
  });
});

describe("modération : suppression de compte", () => {
  let app: FastifyInstance;
  let admin: TestUser;
  let secondAdmin: TestUser;
  let target: TestUser;
  let reporter: TestUser;

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), payload });

  beforeAll(async () => {
    app = await buildTestApp();
    [admin, secondAdmin, target, reporter] = await Promise.all([
      createTestUser(app, "mxa"),
      createTestUser(app, "mxb"),
      createTestUser(app, "mxt"),
      createTestUser(app, "mxr"),
    ]);
    const { error } = await app.supabaseAdmin.from("admins").insert([{ user_id: admin.id }, { user_id: secondAdmin.id }]);
    if (error) throw error;
  });

  afterAll(async () => {
    for (const user of [admin, secondAdmin, target, reporter]) await deleteTestUser(app, user.id);
    await app.close();
  });

  it("efface la suspension et les décisions qui concernent le compte ; les notifications « signalement traité » des autres restent", async () => {
    expect((await request(reporter, "POST", "/api/reports", { targetType: "user", targetId: target.id, reason: "spam" })).statusCode).toBe(204);
    const suspended = await request(admin, "POST", "/api/admin/moderation/actions", { targetType: "user", targetId: target.id, action: "suspend", reason: "spam" });
    expect(suspended.statusCode).toBe(200);

    expect((await request(target, "DELETE", "/api/me", { confirmation: ACCOUNT_DELETION_WORDS.fr })).statusCode).toBe(204);
    const db = app.supabaseAdmin;
    expect((await db.from("suspensions").select("user_id").eq("user_id", target.id)).data).toEqual([]);
    expect((await db.from("moderation_actions").select("id").eq("target_user_id", target.id)).data).toEqual([]);
    const notice = await db.from("notifications").select("type, moderation_action_id").eq("user_id", reporter.id);
    expect(notice.data).toEqual([{ type: "report_handled", moderation_action_id: null }]);
    const reports = await db.from("reports").select("handled_at, moderation_action_id").eq("reporter_id", reporter.id);
    expect(reports.data).toEqual([{ handled_at: expect.any(String), moderation_action_id: null }]);
  });

  it("un administrateur retire d'abord son rôle pour supprimer son compte ; ses décisions restent au journal, sans son nom", async () => {
    expect((await request(reporter, "POST", "/api/reports", { targetType: "user", targetId: admin.id, reason: "other" })).statusCode).toBe(204);
    const dismissed = await request(secondAdmin, "POST", "/api/admin/moderation/actions", { targetType: "user", targetId: admin.id, action: "dismiss" });
    expect(dismissed.statusCode).toBe(200);

    // Lot 5, décision du fondateur du 2026-10-15 : refus tant que le rôle est là.
    const confirmed = { confirmation: ACCOUNT_DELETION_WORDS.fr };
    expect((await request(secondAdmin, "DELETE", "/api/me", confirmed)).statusCode).toBe(409);
    const db = app.supabaseAdmin;
    expect((await db.from("admins").delete().eq("user_id", secondAdmin.id)).error).toBeNull();
    expect((await request(secondAdmin, "DELETE", "/api/me", confirmed)).statusCode).toBe(204);
    expect((await db.from("admins").select("user_id").eq("user_id", secondAdmin.id)).data).toEqual([]);
    const kept = await db.from("moderation_actions").select("admin_id, action").eq("id", dismissed.json().actionId);
    expect(kept.data).toEqual([{ admin_id: null, action: "dismiss" }]);
  });
});
