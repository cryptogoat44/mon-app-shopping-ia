import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import type { CollectionSummary, Post, SavedPostsPage } from "@monapp/shared-types";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Publications enregistrées (lot « vie sociale », migration 0048), sur la
// vraie base de développement (spotto-dev-2, sur le Mac du fondateur) : ce que
// seule une vraie base prouve — la clé composée qui refuse la collection d'un
// autre membre, la collection supprimée qui laisse la publication « sans
// collection » (on delete set null (collection_id), PostgreSQL 15 et plus),
// les suppressions en cascade (publication, compte), et la liste qui relit le
// droit de voir sur de vraies lignes.
// Sans la migration 0048, chaque test est passé (« skip »).
// Les règles, cas par cas : publicationsEnregistrees.test.ts (hors base).

const PHOTO = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#4A3B2F" } }).jpeg().toBuffer();

describe("publications enregistrées, sur la base de développement", () => {
  let app: FastifyInstance;
  let author: TestUser; // publie
  let saver: TestUser; // suit l'autrice, enregistre
  let other: TestUser; // a sa propre collection
  let gone: TestUser; // compte supprimé pendant les tests
  let migrated = false;

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  const publish = async (user: TestUser, privacy: string): Promise<Post> => {
    const body = buildMultipart({ type: "lifestyle", privacy }, { fieldname: "file", filename: "photo.jpg", contentType: "image/jpeg", data: PHOTO });
    const response = await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(user.token), ...body.headers }, payload: body.payload });
    expect(response.statusCode).toBe(200);
    return response.json();
  };
  const createCollection = async (user: TestUser, name: string): Promise<CollectionSummary> => {
    const response = await request(user, "POST", "/api/collections", { name });
    expect(response.statusCode).toBe(201);
    return response.json();
  };
  const savedRows = async (userId: string) => {
    const { data, error } = await app.supabaseAdmin.from("saved_posts").select("post_id, collection_id").eq("user_id", userId);
    if (error) throw error;
    return (data ?? []) as { post_id: string; collection_id: string | null }[];
  };
  const list = async (user: TestUser, query = ""): Promise<string[]> => {
    const response = await request(user, "GET", `/api/saved-posts${query}`);
    expect(response.statusCode).toBe(200);
    return (response.json() as SavedPostsPage).posts.map((post) => post.id);
  };

  beforeAll(async () => {
    app = await buildTestApp();
    [author, saver, other, gone] = (await Promise.all(["spa", "sps", "spo", "spg"].map((label) => createTestUser(app, label)))) as [TestUser, TestUser, TestUser, TestUser];
    const probe = await app.supabaseAdmin.from("saved_posts").select("user_id, post_id, collection_id").limit(0);
    migrated = !probe.error;
    if (!migrated) return;
    for (const user of [saver, gone]) expect((await request(user, "POST", `/api/follows/${author.id}?v=2`)).statusCode).toBe(200);
  }, 120_000);

  afterAll(async () => {
    for (const user of [author, saver, other, gone]) if (user) await deleteTestUser(app, user.id);
    await app?.close();
  }, 120_000);

  it("le statut le dit ; enregistrer, ranger, retrouver ; le signet suit", async (context) => {
    if (!migrated) return context.skip();
    expect((await request(saver, "GET", "/api/collections/status")).json()).toMatchObject({ enabled: true, savedPosts: true });
    const created = await publish(author, "followers");
    const summer = await createCollection(saver, "Été");
    expect((await request(saver, "PUT", `/api/posts/${created.id}/save`, { collectionId: summer.id })).json()).toEqual({ saved: true, collectionId: summer.id });
    const seen: Post = (await request(saver, "GET", `/api/posts/${created.id}`)).json();
    expect(seen.viewerHasSaved).toBe(true);
    expect(seen.viewerSavedCollectionId).toBe(summer.id);
    expect(await list(saver)).toEqual([created.id]);
    expect(await list(saver, `?collectionId=${summer.id}`)).toEqual([created.id]);
    // L'autrice : son propre signet est vide, rien ne dit qui a enregistré.
    const own: Post = (await request(author, "GET", `/api/posts/${created.id}`)).json();
    expect(own.viewerHasSaved).toBe(false);
    expect(JSON.stringify(own)).not.toContain(saver.id);
  });

  it("la base refuse la collection d'un autre membre (clé composée, PostgreSQL 15 et plus) ; le serveur aussi, dans tous les cas", async (context) => {
    if (!migrated) return context.skip();
    const created = await publish(author, "public");
    const foreign = await createCollection(other, "Perso");
    expect((await request(saver, "PUT", `/api/posts/${created.id}/save`, { collectionId: foreign.id })).json().error).toBe("collection_not_found");
    const direct = await app.supabaseAdmin.from("saved_posts").insert({ user_id: saver.id, post_id: created.id, collection_id: foreign.id });
    // Clé composée (PostgreSQL 15 et plus) : refusée par la base (23503). Base
    // plus ancienne : acceptée par la base (la vérification de 0048 le dit),
    // refusée par le serveur seul ; la ligne écrite ici est retirée.
    if (direct.error) expect(direct.error.code).toBe("23503");
    else await app.supabaseAdmin.from("saved_posts").delete().eq("user_id", saver.id).eq("post_id", created.id);
    // Une ligne par membre et par publication.
    await app.supabaseAdmin.from("saved_posts").insert({ user_id: saver.id, post_id: created.id });
    const twice = await app.supabaseAdmin.from("saved_posts").insert({ user_id: saver.id, post_id: created.id });
    expect(twice.error?.code).toBe("23505");
  });

  it("supprimer la collection garde la publication enregistrée, sans collection", async (context) => {
    if (!migrated) return context.skip();
    const created = await publish(author, "public");
    const winter = await createCollection(saver, "Hiver");
    await request(saver, "PUT", `/api/posts/${created.id}/save`, { collectionId: winter.id });
    expect((await request(saver, "DELETE", `/api/collections/${winter.id}`)).statusCode).toBe(204);
    expect((await savedRows(saver.id)).find((row) => row.post_id === created.id)).toEqual({ post_id: created.id, collection_id: null });
    expect(await list(saver)).toContain(created.id);
  });

  it("la liste suit l'accès sur de vraies lignes : publication passée en privée, puis de nouveau « Abonnés »", async (context) => {
    if (!migrated) return context.skip();
    const created = await publish(author, "followers");
    await request(saver, "PUT", `/api/posts/${created.id}/save`, {});
    expect(await list(saver)).toContain(created.id);
    expect((await request(author, "PATCH", `/api/posts/${created.id}`, { privacy: "private" })).statusCode).toBe(200);
    expect(await list(saver)).not.toContain(created.id);
    await request(author, "PATCH", `/api/posts/${created.id}`, { privacy: "followers" });
    expect(await list(saver)).toContain(created.id);
    // Retirer : toujours permis, même quand on ne la voit plus.
    await request(author, "PATCH", `/api/posts/${created.id}`, { privacy: "private" });
    expect((await request(saver, "DELETE", `/api/posts/${created.id}/save`)).statusCode).toBe(204);
    expect((await savedRows(saver.id)).some((row) => row.post_id === created.id)).toBe(false);
  });

  it("cascades : la publication supprimée emporte ses lignes ; le compte supprimé, les siennes", async (context) => {
    if (!migrated) return context.skip();
    const created = await publish(author, "public");
    await request(saver, "PUT", `/api/posts/${created.id}/save`, {});
    await request(gone, "PUT", `/api/posts/${created.id}/save`, {});
    expect((await request(author, "DELETE", `/api/posts/${created.id}`)).statusCode).toBe(204);
    expect((await savedRows(saver.id)).some((row) => row.post_id === created.id)).toBe(false);

    const kept = await publish(author, "public");
    const collection = await createCollection(gone, "Envies");
    await request(gone, "PUT", `/api/posts/${kept.id}/save`, { collectionId: collection.id });
    expect(await savedRows(gone.id)).toHaveLength(1);
    await deleteTestUser(app, gone.id);
    expect(await savedRows(gone.id)).toEqual([]);
  });
});
