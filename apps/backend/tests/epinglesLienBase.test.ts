import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import type { Post, Profile, UserPostsPage, UserProfile } from "@monapp/shared-types";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Épingles et lien en bio (lot « vie sociale », migration 0049), sur la vraie
// base de développement (spotto-dev-2, sur le Mac du fondateur) : ce que seule
// une vraie base prouve — la contrainte du lien (https, sans espace, 200
// caractères), la quatrième épingle refusée sur de vraies lignes, le lien d'un
// compte suspendu caché aux autres, et la bio retirée par la modération qui
// emporte le lien (fonction de 0037 recréée par 0049 : dans la même
// transaction, et même pour un profil qui n'a qu'un lien).
// Sans la migration 0049, chaque test est passé (« skip »).
// Les règles, cas par cas : epinglesLien.test.ts (hors base).

const PHOTO = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#3B4A2F" } }).jpeg().toBuffer();
const ROUTE = "/api/admin/moderation/remove-profile-part";

describe("épingles et lien en bio, sur la base de développement", () => {
  let app: FastifyInstance;
  let author: TestUser; // épingle, met un lien
  let visitor: TestUser; // ne suit personne
  let admin: TestUser;
  let migrated = false;
  let withProfileModeration = false;

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  const publish = async (user: TestUser, privacy: string): Promise<Post> => {
    const body = buildMultipart({ type: "lifestyle", privacy }, { fieldname: "file", filename: "photo.jpg", contentType: "image/jpeg", data: PHOTO });
    const response = await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(user.token), ...body.headers }, payload: body.payload });
    expect(response.statusCode).toBe(200);
    return response.json();
  };
  const setLink = (user: TestUser, linkUrl: string | null) => request(user, "PATCH", "/api/me", { username: user.username, displayName: user.username, linkUrl });
  const storedLink = async (userId: string): Promise<string | null> => {
    const { data, error } = await app.supabaseAdmin.from("profiles").select("link_url").eq("id", userId).single();
    if (error) throw error;
    return (data as { link_url: string | null }).link_url;
  };

  beforeAll(async () => {
    app = await buildTestApp();
    [author, visitor, admin] = (await Promise.all(["ela", "elv", "eld"].map((label) => createTestUser(app, label)))) as [TestUser, TestUser, TestUser];
    const probe = await app.supabaseAdmin.from("profiles").select("link_url").limit(0);
    migrated = !probe.error;
    if (!migrated) return;
    const { error } = await app.supabaseAdmin.from("admins").insert({ user_id: admin.id });
    if (error) throw error;
    const rpc = await app.supabaseAdmin.rpc("moderation_remove_profile_part", { p_admin_id: "00000000-0000-0000-0000-000000000000", p_user_id: "00000000-0000-0000-0000-000000000000", p_part: "bio", p_reason: null, p_note: null });
    withProfileModeration = !rpc.error;
  }, 120_000);

  afterAll(async () => {
    for (const user of [author, visitor, admin]) if (user) await deleteTestUser(app, user.id);
    await app?.close();
  }, 120_000);

  it("la contrainte de la base : https, sans espace, 200 caractères au plus ; vide accepté", async (context) => {
    if (!migrated) return context.skip();
    const write = (link_url: string | null) => app.supabaseAdmin.from("profiles").update({ link_url }).eq("id", visitor.id);
    for (const refused of ["http://exemple.com/", "https://exemple .com/", "javascript:alert(1)", "https://", `https://exemple.com/${"a".repeat(181)}`, "https://exemple.com/\tx"]) {
      const { error } = await write(refused);
      expect(error?.code, refused).toBe("23514");
    }
    for (const accepted of [`https://exemple.com/${"a".repeat(180)}`, null, "https://exemple.com/"]) {
      const { error } = await write(accepted);
      expect(error, String(accepted)).toBeNull();
    }
    expect(await storedLink(visitor.id)).toBe("https://exemple.com/");
    expect((await write(null)).error).toBeNull();
  });

  it("le lien : enregistré mis en forme, rendu au membre et aux autres ; absent du PATCH, il ne bouge pas ; null le retire", async (context) => {
    if (!migrated) return context.skip();
    const saved = await setLink(author, "  HTTPS://Exemple.COM/Lookbook ");
    expect(saved.statusCode).toBe(200);
    expect((saved.json() as Profile).linkUrl).toBe("https://exemple.com/Lookbook");
    expect(await storedLink(author.id)).toBe("https://exemple.com/Lookbook");
    expect(((await request(visitor, "GET", `/api/users/${author.id}`)).json() as UserProfile).linkUrl).toBe("https://exemple.com/Lookbook");
    expect((await request(author, "PATCH", "/api/me", { username: author.username, displayName: author.username, bio: "Bio" })).statusCode).toBe(200);
    expect(await storedLink(author.id)).toBe("https://exemple.com/Lookbook");
    expect((await setLink(author, "http://exemple.com")).statusCode).toBe(400);
    expect(await storedLink(author.id)).toBe("https://exemple.com/Lookbook");
  });

  it("3 épingles au plus sur de vraies lignes ; la quatrième refusée ; le profil les rend filtrées, la plus récente d'abord", async (context) => {
    if (!migrated) return context.skip();
    const posts = [await publish(author, "public"), await publish(author, "public"), await publish(author, "private"), await publish(author, "public")];
    for (const value of posts.slice(0, 3)) expect((await request(author, "PUT", `/api/posts/${value.id}/pin`, { pinned: true })).statusCode).toBe(200);
    const fourth = await request(author, "PUT", `/api/posts/${posts[3]!.id}/pin`, { pinned: true });
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json().error).toBe("pin_limit");
    // Un autre membre : introuvable.
    expect((await request(visitor, "PUT", `/api/posts/${posts[3]!.id}/pin`, { pinned: true })).statusCode).toBe(404);
    const own: UserPostsPage = (await request(author, "GET", `/api/users/${author.id}/posts`)).json();
    expect(own.pinned?.map((value) => value.id)).toEqual([posts[2]!.id, posts[1]!.id, posts[0]!.id]);
    const seen: UserPostsPage = (await request(visitor, "GET", `/api/users/${author.id}/posts`)).json();
    // La publication « Privé » n'est jamais montrée à un visiteur, épinglée ou non.
    expect(seen.pinned?.map((value) => value.id)).toEqual([posts[1]!.id, posts[0]!.id]);
    for (const value of seen.pinned ?? []) expect(value).not.toHaveProperty("pinnedAt");
    expect((await request(author, "PUT", `/api/posts/${posts[0]!.id}/pin`, { pinned: false })).json()).toEqual({ pinnedAt: null });
    expect((await request(author, "PUT", `/api/posts/${posts[3]!.id}/pin`, { pinned: true })).statusCode).toBe(200);
  });

  it("compte suspendu : son lien est caché aux autres, visible de lui-même ; il revient à la levée", async (context) => {
    if (!migrated) return context.skip();
    expect((await setLink(visitor, "https://exemple.org/")).statusCode).toBe(200);
    const suspended = await request(admin, "POST", "/api/admin/moderation/actions", { targetType: "user", targetId: visitor.id, action: "suspend", reason: "spam" });
    expect(suspended.statusCode).toBe(200);
    expect(((await request(author, "GET", `/api/users/${visitor.id}`)).json() as UserProfile).linkUrl).toBeNull();
    expect(((await request(visitor, "GET", "/api/me")).json() as Profile).linkUrl).toBe("https://exemple.org/");
    const undo = await request(admin, "POST", `/api/admin/moderation/actions/${(suspended.json() as { actionId: string }).actionId}/undo`, {});
    expect(undo.statusCode).toBe(200);
    expect(((await request(author, "GET", `/api/users/${visitor.id}`)).json() as UserProfile).linkUrl).toBe("https://exemple.org/");
  });

  it("retirer la bio par la modération retire aussi le lien (0037 appliquée)", async (context) => {
    if (!migrated || !withProfileModeration) return context.skip();
    expect((await request(author, "PATCH", "/api/me", { username: author.username, displayName: author.username, bio: "Bio à retirer", linkUrl: "https://exemple.net/" })).statusCode).toBe(200);
    const response = await request(admin, "POST", ROUTE, { userId: author.id, part: "bio", reason: "inappropriate" });
    expect(response.statusCode).toBe(200);
    expect(await storedLink(author.id)).toBeNull();
    expect(((await request(author, "GET", "/api/me")).json() as Profile)).toMatchObject({ bio: null, linkUrl: null });
  });

  it("un lien sans bio : la fonction de la base le retire elle-même (0049), sans suspendre le compte", async (context) => {
    if (!migrated || !withProfileModeration) return context.skip();
    expect((await request(visitor, "PATCH", "/api/me", { username: visitor.username, displayName: visitor.username, bio: "", linkUrl: "https://exemple.com/connexion" })).statusCode).toBe(200);
    expect(await storedLink(visitor.id)).toBe("https://exemple.com/connexion");
    // La fonction seule, sans le filet du serveur : la bio est vide, le lien part quand même.
    const { data, error } = await app.supabaseAdmin.rpc("moderation_remove_profile_part", { p_admin_id: admin.id, p_user_id: visitor.id, p_part: "bio", p_reason: "spam", p_note: null });
    expect(error).toBeNull();
    expect((data as { outcome: string }[])[0]?.outcome).toBe("ok");
    expect(await storedLink(visitor.id)).toBeNull();
    // Plus ni bio ni lien : « rien à retirer ».
    expect((await request(admin, "POST", ROUTE, { userId: visitor.id, part: "bio", reason: "spam" })).statusCode).toBe(409);
  });
});
