import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Lot S2 : image HD des pièces gardées (Vault, Envies) et « Changer la photo ».
describe("images des pièces gardées", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let other: TestUser;
  let matchId: string;
  const THUMB = "https://encrypted-tbn.example/vignette.jpg";
  const HD = "https://marchand.example/veste-hd.jpg";
  let photo: Buffer;

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "vph");
    other = await createTestUser(app, "vpo");
    photo = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#654" } }).jpeg().toBuffer();
    const { data: search } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: user.id, source_url: null, source_platform: "photo", method: "manual_screenshot", status: "completed" })
      .select("id")
      .single();
    const { data: match } = await app.supabaseAdmin
      .from("product_matches")
      .insert({ search_id: search!.id, rank: 1, product_name: "Veste", image_url: THUMB, image_hd_url: HD, merchant_url: "https://marchand.example/veste" })
      .select("id")
      .single();
    matchId = match!.id;
  });

  afterAll(async () => {
    await deleteTestUser(app, user.id);
    await deleteTestUser(app, other.id);
    await app.close();
  });

  async function addFromMatch() {
    const mp = buildMultipart({ title: "Veste", category: "clothing", productMatchId: matchId });
    const res = await app.inject({ method: "POST", url: "/api/vault", headers: { ...authHeaders(user.token), ...mp.headers }, payload: mp.payload });
    return res.json();
  }

  async function addManual() {
    const mp = buildMultipart({ title: "Montre", category: "watches" }, { fieldname: "file", filename: "m.jpg", contentType: "image/jpeg", data: photo });
    const res = await app.inject({ method: "POST", url: "/api/vault", headers: { ...authHeaders(user.token), ...mp.headers }, payload: mp.payload });
    return res.json();
  }

  function changePhoto(id: string, token = user.token, file = photo, contentType = "image/jpeg") {
    const mp = buildMultipart({}, { fieldname: "file", filename: "nouvelle.jpg", contentType, data: file });
    return app.inject({ method: "POST", url: `/api/vault/${id}/photo`, headers: { ...authHeaders(token), ...mp.headers }, payload: mp.payload });
  }

  async function ownFiles(): Promise<string[]> {
    const { data } = await app.supabaseAdmin.storage.from("vault-media").list(user.id);
    return (data ?? []).map((f) => f.name);
  }

  it("Vault et Envies renvoient l'image HD d'une pièce venue du Spotter, jamais pour une photo personnelle", async () => {
    const fromMatch = await addFromMatch();
    const manual = await addManual();
    const list = await app.inject({ method: "GET", url: "/api/vault", headers: authHeaders(user.token) });
    const byId = new Map(list.json().items.map((item: { id: string }) => [item.id, item]));
    expect(byId.get(fromMatch.id)).toMatchObject({ imageUrl: THUMB, imageHdUrl: HD });
    expect(byId.get(manual.id)).toMatchObject({ imageHdUrl: null });
    const detail = await app.inject({ method: "GET", url: `/api/vault/${fromMatch.id}`, headers: authHeaders(user.token) });
    expect(detail.json().imageHdUrl).toBe(HD);
    const patched = await app.inject({ method: "PATCH", url: `/api/vault/${fromMatch.id}`, headers: authHeaders(user.token), payload: { title: "Veste en daim" } });
    expect(patched.json().imageHdUrl).toBe(HD);

    await app.inject({ method: "POST", url: "/api/wishlist", headers: authHeaders(user.token), payload: { title: "Veste", imageUrl: THUMB, productMatchId: matchId } });
    const wishlist = await app.inject({ method: "GET", url: "/api/wishlist", headers: authHeaders(user.token) });
    expect(wishlist.json().items[0]).toMatchObject({ imageUrl: THUMB, imageHdUrl: HD });
  });

  it("changer la photo d'une pièce du Spotter : nouvelle photo dans son dossier, plus d'image HD, publication « achat » mise à jour", async () => {
    const item = await addFromMatch();
    const post = buildMultipart({ type: "purchase", vaultItemId: item.id, privacy: "public" });
    const created = await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(user.token), ...post.headers }, payload: post.payload });
    expect(created.statusCode).toBe(200);

    const res = await changePhoto(item.id);
    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.imageUrl).toContain(`/vault-media/${user.id}/`);
    expect(updated.imageHdUrl).toBeNull();

    const { data: postRow } = await app.supabaseAdmin.from("posts").select("media_url").eq("id", created.json().id).single();
    expect(postRow!.media_url).toBe(updated.imageUrl);
  });

  it("changer une photo personnelle supprime l'ancienne du stockage", async () => {
    const item = await addManual();
    const oldName = item.imageUrl.split("/").pop();
    expect(await ownFiles()).toContain(oldName);

    const res = await changePhoto(item.id);
    const newName = res.json().imageUrl.split("/").pop();
    const files = await ownFiles();
    expect(files).not.toContain(oldName);
    expect(files).toContain(newName);
  });

  it("refuse la pièce d'un autre utilisateur, et un fichier qui n'est pas une image", async () => {
    const item = await addManual();
    expect((await changePhoto(item.id, other.token)).statusCode).toBe(404);
    expect((await changePhoto(item.id, user.token, Buffer.from("pas une image"), "text/plain")).statusCode).toBe(400);
  });
});
