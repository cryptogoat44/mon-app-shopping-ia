import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { POST_PHOTOS_MAX, type AddPostMediaResponse, type AppNotification, type Post } from "@monapp/shared-types";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Plusieurs photos par publication, identifier des personnes (lot « vie
// sociale », migration 0047), sur la vraie base de développement
// (spotto-dev-2, sur le Mac du fondateur) : ce que seule une vraie base
// prouve — les règles de la base (une photo par place, places 1 à 4, une
// identification par membre, jamais soi-même, le type de notification
// « tag »), les suppressions en cascade (publication, compte), les fichiers
// effacés du vrai stockage, et les identifications retirées quand la
// visibilité se réduit ou que le compte passe en privé.
// Sans la migration 0047, chaque test est passé (« skip »).
// Les règles de visibilité, cas par cas : photosIdentifications.test.ts (hors base).

const PHOTO = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#5C4033" } }).jpeg().toBuffer();

describe("photos et identifications, sur la base de développement", () => {
  let app: FastifyInstance;
  let author: TestUser; // public : publie et identifie
  let friend: TestUser; // suit l'autrice
  let other: TestUser; // suit l'autrice aussi, perd l'accès quand elle passe en privé… sauf s'il est abonné
  let stranger: TestUser; // ne suit personne
  let gone: TestUser; // compte supprimé pendant les tests
  let migrated = false;

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  const publish = async (user: TestUser, privacy: string, peopleTags: string[] = []): Promise<Post> => {
    const body = buildMultipart(
      { type: "lifestyle", privacy, ...(peopleTags.length > 0 ? { peopleTags: JSON.stringify(peopleTags) } : {}) },
      { fieldname: "file", filename: "photo.jpg", contentType: "image/jpeg", data: PHOTO }
    );
    const response = await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(user.token), ...body.headers }, payload: body.payload });
    expect(response.statusCode).toBe(200);
    return response.json();
  };
  const addPhoto = (user: TestUser, postId: string) => {
    const body = buildMultipart({}, { fieldname: "file", filename: "photo.jpg", contentType: "image/jpeg", data: PHOTO });
    return app.inject({ method: "POST", url: `/api/posts/${postId}/media`, headers: { ...authHeaders(user.token), ...body.headers }, payload: body.payload });
  };
  const tagged = async (postId: string): Promise<string[]> => {
    const { data, error } = await app.supabaseAdmin.from("post_people_tags").select("user_id").eq("post_id", postId);
    if (error) throw error;
    return (data ?? []).map((row) => row.user_id as string).sort();
  };
  const files = async (user: TestUser): Promise<string[]> => {
    const { data, error } = await app.supabaseAdmin.storage.from("post-media").list(user.id, { limit: 1000 });
    if (error) throw error;
    return (data ?? []).map((file) => file.name).sort();
  };
  const follow = (user: TestUser, target: TestUser) => request(user, "POST", `/api/follows/${target.id}?v=2`);
  const everyone = (user: TestUser) => request(user, "PUT", "/api/me/mentions-from", { mentionsFrom: "everyone" });

  beforeAll(async () => {
    app = await buildTestApp();
    [author, friend, other, stranger, gone] = (await Promise.all(["pha", "phf", "pho", "phs", "phg"].map((label) => createTestUser(app, label)))) as [TestUser, TestUser, TestUser, TestUser, TestUser];
    const probes = await Promise.all([
      app.supabaseAdmin.from("post_media").select("post_id, position").limit(0),
      app.supabaseAdmin.from("post_people_tags").select("post_id, author_id").limit(0),
    ]);
    migrated = probes.every((probe) => !probe.error);
    if (!migrated) return;
    for (const user of [friend, other, gone]) expect((await follow(user, author)).statusCode).toBe(200);
    for (const user of [friend, other, stranger, gone]) expect((await everyone(user)).statusCode).toBe(204);
  }, 120_000);

  afterAll(async () => {
    for (const user of [author, friend, other, stranger, gone]) if (user) await deleteTestUser(app, user.id);
    await app?.close();
  }, 120_000);

  it("le statut le dit ; quatre photos de plus, une par place ; la cinquième refusée ; la base refuse une place prise ou hors de 1 à 4", async (context) => {
    if (!migrated) return context.skip();
    expect((await request(author, "GET", "/api/posts/status")).json()).toEqual({ carousel: true, peopleTags: true });
    const created = await publish(author, "public");
    for (let index = 1; index < POST_PHOTOS_MAX; index += 1) {
      const response = await addPhoto(author, created.id);
      expect(response.statusCode).toBe(201);
      expect((response.json() as AddPostMediaResponse).media).toHaveLength(index + 1);
    }
    expect((await addPhoto(author, created.id)).statusCode).toBe(409);
    const { data } = await app.supabaseAdmin.from("post_media").select("position, user_id").eq("post_id", created.id).order("position");
    expect((data ?? []).map((row) => row.position)).toEqual([1, 2, 3, 4]);
    expect((data ?? []).every((row) => row.user_id === author.id)).toBe(true);
    for (const position of [1, 0, 5]) {
      const refused = await app.supabaseAdmin.from("post_media").insert({ user_id: author.id, post_id: created.id, position, media_url: "x", media_thumb_url: "y" });
      expect(refused.error, `place ${position}`).not.toBeNull();
    }
    // Un abonné voit les cinq photos ; un autre membre ne peut pas en ajouter.
    expect(((await request(friend, "GET", `/api/posts/${created.id}`)).json() as Post).media).toHaveLength(POST_PHOTOS_MAX);
    expect((await addPhoto(friend, created.id)).statusCode).toBe(404);
  });

  it("supprimer la publication efface ses 5 × 2 fichiers du stockage, et ses lignes en cascade", async (context) => {
    if (!migrated) return context.skip();
    const before = await files(author);
    const created = await publish(author, "public");
    for (let index = 1; index < POST_PHOTOS_MAX; index += 1) expect((await addPhoto(author, created.id)).statusCode).toBe(201);
    const added = (await files(author)).filter((name) => !before.includes(name));
    expect(added).toHaveLength(POST_PHOTOS_MAX * 2);
    expect((await request(author, "DELETE", `/api/posts/${created.id}`)).statusCode).toBe(204);
    const after = await files(author);
    for (const name of added) expect(after, name).not.toContain(name);
    const { data } = await app.supabaseAdmin.from("post_media").select("id").eq("post_id", created.id);
    expect(data).toEqual([]);
  });

  it("identifier : seuls ceux qui voient la publication ; la notification « tag » est acceptée par la base ; jamais soi-même, jamais deux fois", async (context) => {
    if (!migrated) return context.skip();
    const created = await publish(author, "followers", [friend.id, stranger.id]);
    expect((created.people ?? []).map((person) => person.id)).toEqual([friend.id]);
    expect(await tagged(created.id)).toEqual([friend.id]);
    const notices = ((await request(friend, "GET", "/api/notifications?v=2")).json() as AppNotification[]).filter((notice) => notice.type === "tag");
    expect(notices.map((notice) => notice.postId)).toContain(created.id);
    expect(((await request(stranger, "GET", "/api/notifications?v=2")).json() as AppNotification[]).some((notice) => notice.postId === created.id)).toBe(false);
    const self = await app.supabaseAdmin.from("post_people_tags").insert({ post_id: created.id, user_id: author.id, author_id: author.id });
    expect(self.error).not.toBeNull();
    const twice = await app.supabaseAdmin.from("post_people_tags").insert({ post_id: created.id, user_id: friend.id, author_id: author.id });
    expect(twice.error).not.toBeNull();
  });

  it("visibilité réduite puis compte passé en privé : les identifications de ceux qui ne voient plus partent", async (context) => {
    if (!migrated) return context.skip();
    const created = await publish(author, "public", [friend.id, stranger.id, other.id]);
    expect(await tagged(created.id)).toEqual([friend.id, stranger.id, other.id].sort());
    expect((await request(author, "PATCH", `/api/posts/${created.id}`, { privacy: "followers" })).statusCode).toBe(200);
    expect(await tagged(created.id)).toEqual([friend.id, other.id].sort());
    expect((await request(author, "PATCH", `/api/posts/${created.id}`, { privacy: "public" })).statusCode).toBe(200);
    // « other » ne suit plus : en passant en privé, il perd la sienne.
    expect((await request(other, "DELETE", `/api/follows/${author.id}`)).statusCode).toBe(204);
    const second = await publish(author, "public", [stranger.id]);
    expect(await tagged(second.id)).toEqual([stranger.id]);
    expect((await request(author, "PUT", "/api/me/private-account", { isPrivate: true })).statusCode).toBe(204);
    expect(await tagged(created.id)).toEqual([friend.id]);
    expect(await tagged(second.id)).toEqual([]);
    expect((await request(author, "PUT", "/api/me/private-account", { isPrivate: false })).statusCode).toBe(204);
  });

  it("retirer : le membre (même sans voir la publication) ou l'autrice ; un blocage retire tout entre les deux ; un compte supprimé part en cascade", async (context) => {
    if (!migrated) return context.skip();
    const created = await publish(author, "public", [friend.id, stranger.id, gone.id]);
    expect((await request(other, "DELETE", `/api/posts/${created.id}/people-tags/${friend.id}`)).statusCode).toBe(404);
    expect((await request(author, "PATCH", `/api/posts/${created.id}`, { privacy: "private" })).statusCode).toBe(200);
    // « Moi seul » : plus personne ne la voit ; les identifications sont déjà parties.
    expect(await tagged(created.id)).toEqual([]);
    const next = await publish(author, "public", [friend.id, stranger.id, gone.id]);
    expect((await request(friend, "DELETE", `/api/posts/${next.id}/people-tags/${friend.id}`)).statusCode).toBe(204);
    expect((await request(author, "DELETE", `/api/posts/${next.id}/people-tags/${stranger.id}`)).statusCode).toBe(204);
    await deleteTestUser(app, gone.id);
    expect(await tagged(next.id)).toEqual([]);
    const third = await publish(author, "public", [stranger.id]);
    expect((await request(stranger, "POST", `/api/blocks/${author.id}`)).statusCode).toBe(204);
    expect(await tagged(third.id)).toEqual([]);
    expect((await request(stranger, "DELETE", `/api/blocks/${author.id}`)).statusCode).toBe(204);
  });
});
