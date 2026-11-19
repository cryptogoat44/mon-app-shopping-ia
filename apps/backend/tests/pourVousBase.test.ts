import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import type { ForYouPage, Post, Profile, SuggestionsResponse } from "@monapp/shared-types";
import { resetForYouCache } from "../src/lib/forYou.js";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Fil « Pour vous » et suggestions de comptes (lot « découverte », migration
// 0050), sur la vraie base de développement (spotto-dev-2, sur le Mac du
// fondateur) : ce que seule une vraie base prouve — les exclusions sur de
// vraies lignes (blocage, abonnement, compte privé, suspension), le réglage
// éteint par sa route, le compte tout neuf écarté, et une deuxième page sans
// doublon. Les comptes de test sont vieillis de deux jours (un compte de moins
// de 24 heures n'est proposé à personne). Le classement est gardé 5 minutes en
// mémoire : chaque test l'oublie avant de lire.
// Sans la migration 0050, « Pour vous » et les suggestions répondent 404
// (personne ne pourrait refuser d'y figurer) : seul le test « sans 0050 »
// tourne, les autres sont passés (« skip ») ; sans 0045, le cas du compte
// privé est passé aussi.
// Les règles, cas par cas : pourVous.test.ts (hors base).

const PHOTO = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#5A4632" } }).jpeg().toBuffer();

describe("« Pour vous » et suggestions, sur la base de développement", () => {
  let app: FastifyInstance;
  let viewer: TestUser; // regarde « Pour vous »
  let other: TestUser; // un autre compte, sans abonnement
  let author: TestUser; // public, proposé
  let followed: TestUser; // suivi par viewer
  let blocked: TestUser; // bloqué par viewer
  let privateOne: TestUser; // compte privé
  let suspended: TestUser; // suspendu par la modération
  let newcomer: TestUser; // inscrit à l'instant
  let admin: TestUser;
  let migrated = false;
  let withPrivate = false;
  const posts = new Map<string, Post[]>();

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  const publish = async (user: TestUser, privacy: string): Promise<Post> => {
    const body = buildMultipart({ type: "lifestyle", privacy }, { fieldname: "file", filename: "photo.jpg", contentType: "image/jpeg", data: PHOTO });
    const response = await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(user.token), ...body.headers }, payload: body.payload });
    expect(response.statusCode).toBe(200);
    const created = response.json() as Post;
    posts.set(user.id, [...(posts.get(user.id) ?? []), created]);
    return created;
  };
  const backdate = async (user: TestUser) => {
    const { error } = await app.supabaseAdmin
      .from("profiles")
      .update({ created_at: new Date(Date.now() - 2 * 24 * 3_600_000).toISOString() })
      .eq("id", user.id);
    if (error) throw error;
  };
  /** Toute la liste de `user` (4 pages au plus), relue après avoir oublié le classement. */
  const forYouIds = async (user: TestUser): Promise<string[]> => {
    resetForYouCache();
    const seen: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const response = await request(user, "GET", `/api/feed/for-you?offset=${offset}`);
      expect(response.statusCode).toBe(200);
      const page = response.json() as ForYouPage;
      seen.push(...page.posts.map((post) => post.id));
      offset = page.nextOffset;
    }
    return seen;
  };
  const idsOf = (user: TestUser) => (posts.get(user.id) ?? []).map((post) => post.id);

  beforeAll(async () => {
    app = await buildTestApp();
    [viewer, other, author, followed, blocked, privateOne, suspended, newcomer, admin] = (await Promise.all(
      ["pvv", "pvo", "pva", "pvf", "pvb", "pvp", "pvs", "pvn", "pvd"].map((label) => createTestUser(app, label))
    )) as [TestUser, TestUser, TestUser, TestUser, TestUser, TestUser, TestUser, TestUser, TestUser];
    migrated = !(await app.supabaseAdmin.from("profiles").select("discoverable").limit(0)).error;
    withPrivate = !(await app.supabaseAdmin.from("profiles").select("is_private").limit(0)).error;
    for (const user of [viewer, other, author, followed, blocked, privateOne, suspended]) await backdate(user);
    // Deux publications publiques pour l'auteur, une « abonnés » ; une publique pour chacun des autres.
    await publish(author, "public");
    await publish(author, "public");
    await publish(author, "followers");
    for (const user of [followed, blocked, privateOne, suspended, newcomer, viewer]) await publish(user, "public");
    expect((await request(viewer, "POST", `/api/follows/${followed.id}`)).statusCode).toBeLessThan(300);
    expect((await request(viewer, "POST", `/api/blocks/${blocked.id}`)).statusCode).toBeLessThan(300);
    if (withPrivate) expect((await request(privateOne, "PUT", "/api/me/private-account", { isPrivate: true })).statusCode).toBe(204);
    const { error } = await app.supabaseAdmin.from("admins").insert({ user_id: admin.id });
    if (error) throw error;
    const suspension = await request(admin, "POST", "/api/admin/moderation/actions", { targetType: "user", targetId: suspended.id, action: "suspend", reason: "spam" });
    expect(suspension.statusCode).toBe(200);
  }, 180_000);

  afterAll(async () => {
    for (const user of [viewer, other, author, followed, blocked, privateOne, suspended, newcomer, admin]) if (user) await deleteTestUser(app, user.id);
    resetForYouCache();
    await app?.close();
  }, 180_000);

  it("les vraies exclusions : soi-même, suivi, bloqué, privé, suspendu, tout neuf, « abonnés » ; l'auteur public, oui", async (context) => {
    if (!migrated) return context.skip();
    const seen = await forYouIds(viewer);
    const [publicOne, publicTwo, followersOnly] = idsOf(author);
    expect(seen).toEqual(expect.arrayContaining([publicOne, publicTwo]));
    expect(seen).not.toContain(followersOnly);
    for (const [user, why] of [
      [viewer, "soi-même"],
      [followed, "suivi"],
      [blocked, "bloqué"],
      [suspended, "suspendu"],
      [newcomer, "inscrit à l'instant"],
      ...(withPrivate ? ([[privateOne, "compte privé"]] as const) : []),
    ] as const) {
      for (const id of idsOf(user)) expect(seen, why).not.toContain(id);
    }
    // Un autre membre voit les publications du compte suivi et du compte bloqué par viewer.
    const forOther = await forYouIds(other);
    for (const id of [...idsOf(followed), ...idsOf(blocked), ...idsOf(viewer)]) expect(forOther).toContain(id);
  });

  it("deux pages sans doublon, et les nombres de la carte sont ceux du membre", async (context) => {
    if (!migrated) return context.skip();
    resetForYouCache();
    const first = (await request(other, "GET", "/api/feed/for-you")).json() as ForYouPage;
    if (first.nextOffset !== null) {
      const second = (await request(other, "GET", `/api/feed/for-you?offset=${first.nextOffset}`)).json() as ForYouPage;
      const all = [...first.posts, ...second.posts].map((post) => post.id);
      expect(new Set(all).size).toBe(all.length);
    }
    // Un j'aime du compte bloqué sur la publication de l'auteur : compté pour other, pas pour viewer.
    const [publicOne] = idsOf(author);
    expect((await request(blocked, "POST", `/api/posts/${publicOne}/react`)).statusCode).toBe(200);
    resetForYouCache();
    const countFor = async (user: TestUser) => {
      const page = (await request(user, "GET", "/api/feed/for-you")).json() as ForYouPage;
      return page.posts.find((post) => post.id === publicOne)?.reactionCount;
    };
    const forViewer = await countFor(viewer);
    const forOther = await countFor(other);
    if (forViewer !== undefined && forOther !== undefined) expect(forOther).toBe(forViewer + 1);
  });

  it("sans 0050 : « Pour vous » et les suggestions répondent 404, comme le réglage (l'app les cache)", async (context) => {
    if (migrated) return context.skip();
    for (const url of ["/api/feed/for-you", "/api/users/suggestions"]) {
      const response = await request(viewer, "GET", url);
      expect(response.statusCode, url).toBe(404);
      expect(response.json().error, url).toBe("discovery_setting_unavailable");
    }
    expect((await request(author, "PUT", "/api/me/discoverable", { discoverable: false })).statusCode).toBe(404);
  });

  it("le réglage éteint par sa route : ni dans « Pour vous » ni dans les suggestions ; toujours sur son profil ; rallumé, il revient", async (context) => {
    if (!migrated) return context.skip();
    expect((await request(author, "GET", "/api/me")).json() as Profile).toMatchObject({ discoverable: true });
    expect((await request(author, "PUT", "/api/me/discoverable", { discoverable: false })).statusCode).toBe(204);
    expect((await request(author, "GET", "/api/me")).json() as Profile).toMatchObject({ discoverable: false });
    const seen = await forYouIds(other);
    for (const id of idsOf(author)) expect(seen).not.toContain(id);
    const suggested = ((await request(other, "GET", "/api/users/suggestions")).json() as SuggestionsResponse).members.map((member) => member.id);
    expect(suggested).not.toContain(author.id);
    const profilePosts = await request(other, "GET", `/api/users/${author.id}/posts`);
    expect(profilePosts.json().posts.map((post: Post) => post.id)).toContain(idsOf(author)[0]);
    expect((await request(author, "PUT", "/api/me/discoverable", { discoverable: true })).statusCode).toBe(204);
    expect(await forYouIds(other)).toContain(idsOf(author)[0]);
  });

  it("suggestions : le compte suivi par un de vos abonnements d'abord ; jamais un compte suivi, bloqué, privé ou suspendu", async (context) => {
    if (!migrated) return context.skip();
    // viewer suit followed ; followed suit author : author est suggéré à viewer, en tête des comptes « amis d'amis ».
    expect((await request(followed, "POST", `/api/follows/${author.id}`)).statusCode).toBeLessThan(300);
    resetForYouCache();
    const response = await request(viewer, "GET", "/api/users/suggestions");
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const suggested = (response.json() as SuggestionsResponse).members.map((member) => member.id);
    expect(suggested[0]).toBe(author.id);
    for (const user of [viewer, followed, blocked, suspended, ...(withPrivate ? [privateOne] : [])]) expect(suggested).not.toContain(user.id);
  });
});
