import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createClient } from "@supabase/supabase-js";
import type { VideoLookupResponse } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Mémoire collective des vidéos (mission « liens vidéo », migration 0038) sur
// la VRAIE base de développement (spotto-dev-2 seulement : tests:ci refuse
// toute autre base), sans aucun appel à SerpApi, à TikTok ni à Meta. Vérifié
// ici, ce que la fausse base ne peut pas montrer : le tri réel des pièces
// (confirmations, puis apparitions, puis récence), les droits (un membre ne
// lit ni les spots ni les confirmations de personne, même avec sa propre
// session), les suppressions en cascade et le compteur de la vidéo.
// Sauté tant que 0038 n'est pas appliquée. Vidéo, boutiques et pièces fictives.

const service = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const probe = await service.rpc("video_memory_version");
const migrated = !probe.error && probe.data === 1;

/** Une vidéo TikTok fictive, différente à chaque passage. */
const VIDEO_ID = `74${Date.now()}${Math.floor(Math.random() * 1000)}`.padEnd(19, "0").slice(0, 19);
const VIDEO_URL = `https://www.tiktok.com/@essai.memoire/video/${VIDEO_ID}`;
const shop = (piece: string) => `https://boutique-memoire-${VIDEO_ID}.example/${piece}`;

describe.skipIf(!migrated)("mémoire collective des vidéos sur la base (0038)", () => {
  let app: FastifyInstance;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  /** Une recherche terminée de `who`, avec ces pièces dans l'ordre. */
  async function searchOf(who: TestUser, pieces: string[]): Promise<string> {
    const { data: search, error } = await app.supabaseAdmin.from("product_searches").insert({ user_id: who.id, source_platform: "photo", method: "manual_screenshot", status: "completed" }).select("id").single();
    if (error) throw error;
    const { error: matchError } = await app.supabaseAdmin.from("product_matches").insert(
      pieces.map((piece, index) => ({
        search_id: search!.id,
        rank: index + 1,
        product_name: `${piece} (recherche de ${who.username})`,
        image_url: `https://images.example/${piece}.jpg`,
        merchant_url: `${shop(piece)}?utm_source=essai-${index}`,
        merchant_name: "Boutique Mémoire",
        price_min: 100,
        price_max: 100,
        currency: "EUR",
      }))
    );
    if (matchError) throw matchError;
    return search!.id as string;
  }

  const post = (who: TestUser, url: string, payload: object) => app.inject({ method: "POST", url, headers: authHeaders(who.token), payload });
  async function products(who: TestUser): Promise<VideoLookupResponse> {
    const res = await app.inject({ method: "GET", url: `/api/video-links/lookup?url=${encodeURIComponent(VIDEO_URL)}`, headers: authHeaders(who.token) });
    expect(res.statusCode).toBe(200);
    return res.json() as VideoLookupResponse;
  }
  const names = (body: VideoLookupResponse) => body.products.map((product) => product.productName.split(" ")[0]);
  const keyOf = (body: VideoLookupResponse, piece: string) => body.products.find((product) => product.productName.startsWith(piece))!.productKey;

  beforeAll(async () => {
    app = await buildTestApp();
    alice = await createTestUser(app, "memoirea");
    bob = await createTestUser(app, "memoireb");
    carol = await createTestUser(app, "memoirec");
  });

  afterAll(async () => {
    for (const user of [alice, bob, carol]) await deleteTestUser(app, user.id);
    await app.supabaseAdmin.from("video_sources").delete().eq("platform", "tiktok").eq("video_key", VIDEO_ID);
    await app.close();
  });

  it("vidéo jamais spottée : reconnue, aucune pièce", async () => {
    const body = await products(alice);
    expect(body.link).toEqual({ platform: "tiktok", videoKey: VIDEO_ID, canonicalUrl: VIDEO_URL, creatorHandle: "essai.memoire" });
    expect(body).toMatchObject({ memoryAvailable: true, products: [] });
  });

  it("trois spots : la pièce vue deux fois passe devant, puis la plus récente ; une recherche ne compte qu'une fois", async () => {
    const first = await searchOf(alice, ["veste", "jupe"]);
    expect((await post(alice, "/api/video-links/spots", { url: VIDEO_URL, searchId: first, source: "tiktok_player", momentSeconds: 12 })).json()).toEqual({ recorded: true });
    // La même recherche, rejouée : aucun doublon.
    expect((await post(alice, "/api/video-links/spots", { url: VIDEO_URL, searchId: first, source: "tiktok_player" })).statusCode).toBe(200);
    expect((await post(bob, "/api/video-links/spots", { url: `${VIDEO_URL}?_r=1`, searchId: await searchOf(bob, ["veste", "sac"]), source: "share" })).statusCode).toBe(200);
    expect((await post(carol, "/api/video-links/spots", { url: VIDEO_URL, searchId: await searchOf(carol, ["bottes"]), source: "visual_intelligence" })).statusCode).toBe(200);

    const body = await products(carol);
    expect(names(body)).toEqual(["veste", "bottes", "sac", "jupe"]);
    expect(body.products[0]).toMatchObject({ appearances: 2, confirmations: 0, confirmedByMe: false, merchantName: "Boutique Mémoire" });
    const { data: source } = await app.supabaseAdmin.from("video_sources").select("spot_count, creator_handle, canonical_url").eq("platform", "tiktok").eq("video_key", VIDEO_ID).single();
    expect(source).toEqual({ spot_count: 3, creator_handle: "essai.memoire", canonical_url: VIDEO_URL });
  });

  it("un membre ne peut pas faire noter la recherche d'un autre", async () => {
    const foreign = await searchOf(alice, ["foulard"]);
    const res = await post(bob, "/api/video-links/spots", { url: VIDEO_URL, searchId: foreign, source: "share" });
    expect(res.statusCode).toBe(404);
    expect(names(await products(bob))).not.toContain("foulard");
  });

  it("« C'est bien cette pièce » : deux confirmations font passer la jupe première ; une seule par membre ; « confirmée par moi » ne parle que de soi", async () => {
    const jupe = keyOf(await products(alice), "jupe");
    expect((await post(carol, "/api/video-links/confirm", { url: VIDEO_URL, productKey: jupe })).json()).toEqual({ confirmed: true });
    expect((await post(carol, "/api/video-links/confirm", { url: VIDEO_URL, productKey: jupe })).json()).toEqual({ confirmed: true });
    expect((await post(alice, "/api/video-links/confirm", { url: VIDEO_URL, productKey: jupe })).statusCode).toBe(200);

    const seenByCarol = await products(carol);
    expect(names(seenByCarol)).toEqual(["jupe", "veste", "bottes", "sac"]);
    expect(seenByCarol.products[0]).toMatchObject({ confirmations: 2, confirmedByMe: true });
    expect((await products(bob)).products[0]).toMatchObject({ confirmations: 2, confirmedByMe: false });
    // Une pièce jamais repérée dans cette vidéo ne se confirme pas.
    expect((await post(bob, "/api/video-links/confirm", { url: VIDEO_URL, productKey: "e".repeat(64) })).statusCode).toBe(404);
  });

  it("ce que voit un membre ne contient l'identité de personne", async () => {
    const text = JSON.stringify(await products(bob));
    for (const user of [alice, bob, carol]) {
      expect(text).not.toContain(user.id);
      expect(text).not.toContain(user.username);
    }
  });

  it("droits de la base : avec sa propre session, un membre ne lit ni spots, ni confirmations, ni vidéos, et n'appelle aucune fonction", async () => {
    const asBob = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY ?? "", { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bob.token}` } } });
    for (const table of ["video_spots", "video_spot_items", "video_item_confirmations", "video_sources"]) {
      const { data, error } = await asBob.from(table).select("*").limit(5);
      // Refus net, ou liste vide : jamais une ligne, pas même les siennes.
      expect(error !== null || (data ?? []).length === 0, table).toBe(true);
    }
    const insert = await asBob.from("video_item_confirmations").insert({ user_id: bob.id, video_source_id: "00000000-0000-0000-0000-000000000000", product_key: "a".repeat(64) });
    expect(insert.error).not.toBeNull();
    for (const [fn, args] of [
      ["video_products", { p_platform: "tiktok", p_video_key: VIDEO_ID, p_viewer_id: bob.id, p_limit: 12 }],
      ["video_confirm", { p_user_id: alice.id, p_platform: "tiktok", p_video_key: VIDEO_ID, p_product_key: "a".repeat(64) }],
    ] as const) {
      expect((await asBob.rpc(fn, args)).error, fn).not.toBeNull();
    }
  });

  it("le compte de Bob est supprimé : son spot et ses pièces partent, la veste retombe à une apparition, le compteur suit", async () => {
    await deleteTestUser(app, bob.id);
    const body = await products(alice);
    expect(names(body)).toEqual(["jupe", "bottes", "veste"]);
    expect(body.products.find((product) => product.productName.startsWith("veste"))).toMatchObject({ appearances: 1 });
    const { data: source } = await app.supabaseAdmin.from("video_sources").select("spot_count").eq("platform", "tiktok").eq("video_key", VIDEO_ID).single();
    expect(source).toEqual({ spot_count: 2 });
  });
});
