import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Lot « images et fluidité » : photos optimisées à l'envoi, image HD des
// publications « achat ».
describe("images des publications", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let bigPhoto: Buffer;

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "img");
    // Photo « d'iPhone » : 3024 × 4032, avec des métadonnées GPS.
    bigPhoto = await sharp({ create: { width: 3024, height: 4032, channels: 3, background: "#7a8b6f", noise: { type: "gaussian", mean: 120, sigma: 20 } } })
      .jpeg({ quality: 90 })
      .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 0/1" } })
      .toBuffer();
  });

  afterAll(async () => {
    await deleteTestUser(app, user.id);
    await app.close();
  });

  async function download(url: string): Promise<Buffer> {
    return Buffer.from(await (await fetch(url)).arrayBuffer());
  }

  it("une photo publiée est enregistrée en 1 600 px (et une miniature de 480 px), sans position GPS", async () => {
    const mp = buildMultipart({ type: "lifestyle", privacy: "public" }, { fieldname: "file", filename: "p.jpg", contentType: "image/jpeg", data: bigPhoto });
    const post = (await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(user.token), ...mp.headers }, payload: mp.payload })).json();
    expect(post.mediaThumbUrl).toBeTruthy();

    const display = await download(post.mediaUrl);
    const displayMeta = await sharp(display).metadata();
    expect(Math.max(displayMeta.width!, displayMeta.height!)).toBe(1600);
    expect(displayMeta.exif).toBeUndefined();
    expect(display.length).toBeLessThan(bigPhoto.length / 3);

    const thumbMeta = await sharp(await download(post.mediaThumbUrl)).metadata();
    expect(Math.max(thumbMeta.width!, thumbMeta.height!)).toBe(480);

    // La suppression de la publication retire aussi la miniature.
    await app.inject({ method: "DELETE", url: `/api/posts/${post.id}`, headers: authHeaders(user.token) });
    const { data } = await app.supabaseAdmin.storage.from("post-media").list(user.id);
    expect(data ?? []).toEqual([]);
  });

  it("une photo du Vault est enregistrée en 1 600 px au plus", async () => {
    const mp = buildMultipart({ title: "Sac", category: "bags" }, { fieldname: "file", filename: "v.jpg", contentType: "image/jpeg", data: bigPhoto });
    const item = (await app.inject({ method: "POST", url: "/api/vault", headers: { ...authHeaders(user.token), ...mp.headers }, payload: mp.payload })).json();
    const meta = await sharp(await download(item.imageUrl)).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(1600);
  });

  it("une publication « achat » venue du Spotter porte l'image HD du marchand", async () => {
    const { data: search } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: user.id, source_platform: "photo", method: "manual_screenshot", status: "completed" })
      .select("id")
      .single();
    const { data: match } = await app.supabaseAdmin
      .from("product_matches")
      .insert({ search_id: search!.id, rank: 1, product_name: "Veste", image_url: "https://encrypted-tbn.example/mini.jpg", image_hd_url: "https://marchand.example/hd.jpg", merchant_url: "https://marchand.example/veste" })
      .select("id")
      .single();
    const vault = buildMultipart({ title: "Veste", category: "clothing", productMatchId: match!.id });
    const item = (await app.inject({ method: "POST", url: "/api/vault", headers: { ...authHeaders(user.token), ...vault.headers }, payload: vault.payload })).json();
    const mp = buildMultipart({ type: "purchase", vaultItemId: item.id, privacy: "public" });
    const post = (await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(user.token), ...mp.headers }, payload: mp.payload })).json();
    expect(post).toMatchObject({ mediaUrl: "https://encrypted-tbn.example/mini.jpg", mediaHdUrl: "https://marchand.example/hd.jpg", mediaThumbUrl: null });

    const feed = (await app.inject({ method: "GET", url: "/api/feed", headers: authHeaders(user.token) })).json();
    expect(feed.posts.find((p: { id: string }) => p.id === post.id).mediaHdUrl).toBe("https://marchand.example/hd.jpg");
  });
});
