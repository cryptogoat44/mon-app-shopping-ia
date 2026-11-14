import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createClient } from "@supabase/supabase-js";
import type { VideoLookupResponse } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Mémoire collective des vidéos (mission « liens vidéo », migrations 0038 et
// 0039) sur la VRAIE base de développement (spotto-dev-2 seulement : tests:ci
// refuse toute autre base), sans aucun appel à SerpApi, à TikTok ni à Meta.
// Vérifié ici, ce que la fausse base ne peut pas montrer : les garde-fous de
// 0039 (une pièce n'est montrée qu'une fois trouvée par 2 membres distincts,
// un spot par membre et par vidéo, recherche de moins de 30 minutes, pas de
// confirmation de sa propre pièce, comptes suspendus écartés, retrait par la
// modération), le tri réel des pièces (confirmations, puis membres, puis
// récence), les droits (un membre ne lit ni les spots ni les confirmations de
// personne, même avec sa propre session), les suppressions en cascade et le
// compteur de la vidéo. Sauté tant que 0039 n'est pas appliquée. Vidéo,
// boutiques et pièces fictives.

const service = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const probe = await service.rpc("video_memory_version");
const migrated = !probe.error && probe.data === 2;

/** Une vidéo TikTok fictive, différente à chaque passage. */
const VIDEO_ID = `74${Date.now()}${Math.floor(Math.random() * 1000)}`.padEnd(19, "0").slice(0, 19);
const VIDEO_URL = `https://www.tiktok.com/@essai.memoire/video/${VIDEO_ID}`;
const INVENTED_ID = `75${Date.now()}`.padEnd(19, "9").slice(0, 19);
const shop = (piece: string) => `https://boutique-memoire-${VIDEO_ID}.example/${piece}`;

describe.skipIf(!migrated)("mémoire collective des vidéos sur la base (0038 et 0039)", () => {
  let app: FastifyInstance;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let dave: TestUser;
  let admin: TestUser;

  /** Une recherche terminée de `who`, avec ces pièces dans l'ordre (créée il y a `minutesAgo` minutes). */
  async function searchOf(who: TestUser, pieces: string[], minutesAgo = 0): Promise<string> {
    const { data: search, error } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: who.id, source_platform: "photo", method: "manual_screenshot", status: "completed", created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString() })
      .select("id")
      .single();
    if (error) throw error;
    const { error: matchError } = await app.supabaseAdmin.from("product_matches").insert(
      pieces.map((piece, index) => ({
        search_id: search!.id,
        rank: index + 1,
        // Jamais le pseudo du membre ici : le test vérifie plus bas qu'aucun pseudo n'apparaît.
        product_name: `${piece} (pièce d'essai)`,
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
    dave = await createTestUser(app, "memoired");
    admin = await createTestUser(app, "memoireadm");
    const { error } = await app.supabaseAdmin.from("admins").insert({ user_id: admin.id });
    if (error) throw error;
  });

  afterAll(async () => {
    for (const user of [alice, bob, carol, dave, admin]) await deleteTestUser(app, user.id);
    await app.supabaseAdmin.from("video_sources").delete().eq("platform", "tiktok").in("video_key", [VIDEO_ID, INVENTED_ID]);
    await app.close();
  });

  it("vidéo jamais spottée : reconnue, aucune pièce", async () => {
    const body = await products(alice);
    expect(body.link).toEqual({ platform: "tiktok", videoKey: VIDEO_ID, canonicalUrl: VIDEO_URL, creatorHandle: "essai.memoire" });
    expect(body).toMatchObject({ memoryAvailable: true, products: [] });
  });

  it("un seul membre : rien n'est montré ; deux membres distincts : la pièce trouvée par les deux apparaît ; un spot par recherche et par membre", async () => {
    const first = await searchOf(alice, ["veste", "jupe"]);
    expect((await post(alice, "/api/video-links/spots", { url: VIDEO_URL, searchId: first, source: "tiktok_player", momentSeconds: 12 })).json()).toEqual({ recorded: true });
    expect((await products(carol)).products).toEqual([]);
    // La même recherche, rejouée, puis une 2ᵉ recherche d'Alice sur la même vidéo : aucun doublon.
    expect((await post(alice, "/api/video-links/spots", { url: VIDEO_URL, searchId: first, source: "tiktok_player" })).statusCode).toBe(200);
    expect((await post(alice, "/api/video-links/spots", { url: VIDEO_URL, searchId: await searchOf(alice, ["bottes"]), source: "app" })).json()).toEqual({ recorded: true });
    expect((await post(bob, "/api/video-links/spots", { url: `${VIDEO_URL}?_r=1`, searchId: await searchOf(bob, ["veste", "sac"]), source: "share" })).statusCode).toBe(200);
    // Carol trouve les bottes : seule à les avoir notées (le 2ᵉ spot d'Alice n'a pas compté).
    expect((await post(carol, "/api/video-links/spots", { url: VIDEO_URL, searchId: await searchOf(carol, ["bottes"]), source: "visual_intelligence" })).statusCode).toBe(200);

    const body = await products(carol);
    expect(names(body)).toEqual(["veste"]);
    expect(body.products[0]).toMatchObject({ appearances: 2, confirmations: 0, confirmedByMe: false, merchantName: "Boutique Mémoire" });
    const { data: source } = await app.supabaseAdmin.from("video_sources").select("spot_count, creator_handle, canonical_url").eq("platform", "tiktok").eq("video_key", VIDEO_ID).single();
    expect(source).toEqual({ spot_count: 3, creator_handle: "essai.memoire", canonical_url: VIDEO_URL });
  });

  it("recherche de plus de 30 minutes : 409 « search_too_old », rien n'est noté", async () => {
    const res = await post(dave, "/api/video-links/spots", { url: VIDEO_URL, searchId: await searchOf(dave, ["jupe"], 31), source: "share" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("search_too_old");
    const { count } = await app.supabaseAdmin.from("video_spots").select("id", { count: "exact", head: true }).eq("user_id", dave.id);
    expect(count).toBe(0);
  });

  it("recherche déjà notée, renvoyée avec une vidéo inventée : aucune vidéo créée", async () => {
    const { data: spot } = await app.supabaseAdmin.from("video_spots").select("search_id").eq("user_id", alice.id).single();
    expect((await post(alice, "/api/video-links/spots", { url: `https://www.tiktok.com/@x/video/${INVENTED_ID}`, searchId: spot!.search_id, source: "app" })).statusCode).toBe(200);
    const { data: invented } = await app.supabaseAdmin.from("video_sources").select("id").eq("platform", "tiktok").eq("video_key", INVENTED_ID);
    expect(invented).toEqual([]);
  });

  it("un membre ne peut pas faire noter la recherche d'un autre", async () => {
    const foreign = await searchOf(alice, ["foulard"]);
    const res = await post(bob, "/api/video-links/spots", { url: VIDEO_URL, searchId: foreign, source: "share" });
    expect(res.statusCode).toBe(404);
    expect(names(await products(bob))).not.toContain("foulard");
  });

  it("« C'est bien cette pièce » : celle d'un membre qui a apporté la pièce ne compte pas ; une seule par membre ; « confirmée par moi » ne parle que de soi", async () => {
    const veste = keyOf(await products(alice), "veste");
    expect((await post(alice, "/api/video-links/confirm", { url: VIDEO_URL, productKey: veste })).json()).toEqual({ confirmed: true });
    expect((await products(alice)).products[0]).toMatchObject({ confirmations: 0, confirmedByMe: true });
    expect((await post(carol, "/api/video-links/confirm", { url: VIDEO_URL, productKey: veste })).json()).toEqual({ confirmed: true });
    expect((await post(carol, "/api/video-links/confirm", { url: VIDEO_URL, productKey: veste })).json()).toEqual({ confirmed: true });
    expect((await products(carol)).products[0]).toMatchObject({ confirmations: 1, confirmedByMe: true });
    expect((await products(bob)).products[0]).toMatchObject({ confirmations: 1, confirmedByMe: false });

    // Dave trouve aussi la jupe : elle apparaît (Alice et Dave), derrière la veste confirmée…
    expect((await post(dave, "/api/video-links/spots", { url: VIDEO_URL, searchId: await searchOf(dave, ["jupe"]), source: "share" })).statusCode).toBe(200);
    expect(names(await products(carol))).toEqual(["veste", "jupe"]);
    // … puis devant elle, avec deux confirmations de membres qui ne l'ont pas apportée.
    const jupe = keyOf(await products(carol), "jupe");
    for (const who of [bob, carol]) expect((await post(who, "/api/video-links/confirm", { url: VIDEO_URL, productKey: jupe })).statusCode).toBe(200);
    expect(names(await products(carol))).toEqual(["jupe", "veste"]);
    // Une pièce jamais repérée dans cette vidéo ne se confirme pas.
    expect((await post(bob, "/api/video-links/confirm", { url: VIDEO_URL, productKey: "e".repeat(64) })).statusCode).toBe(404);
  });

  it("compte suspendu : ses spots et ses confirmations ne comptent plus ; rétabli, tout revient", async () => {
    const decide = await app.inject({ method: "POST", url: "/api/admin/moderation/actions", headers: authHeaders(admin.token), payload: { targetType: "user", targetId: dave.id, action: "suspend", reason: "spam" } });
    expect(decide.statusCode).toBe(200);
    // La jupe n'a plus qu'un membre (Alice) : cachée.
    expect(names(await products(carol))).toEqual(["veste"]);
    const undo = await app.inject({ method: "POST", url: `/api/admin/moderation/actions/${decide.json().actionId as string}/undo`, headers: authHeaders(admin.token), payload: {} });
    expect(undo.statusCode).toBe(200);
    expect(names(await products(carol))).toEqual(["jupe", "veste"]);
  });

  it("modération : un administrateur retire la veste de la vidéo ; un membre ne le peut pas", async () => {
    const veste = keyOf(await products(alice), "veste");
    const remove = (who: TestUser) => post(who, "/api/admin/moderation/video-memory/remove", { url: VIDEO_URL, productKey: veste });
    // Un non-administrateur reçoit « page introuvable » (404), comme sur toutes les routes d'administration.
    expect((await remove(bob)).statusCode).toBe(404);
    const res = await remove(admin);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ removed: true, items: 2, confirmations: 2 });
    expect(names(await products(carol))).toEqual(["jupe"]);
    expect((await remove(admin)).statusCode).toBe(404);
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
      ["video_products", { p_platform: "tiktok", p_video_key: VIDEO_ID, p_viewer_id: bob.id, p_limit: 12, p_min_members: 1 }],
      ["video_confirm", { p_user_id: alice.id, p_platform: "tiktok", p_video_key: VIDEO_ID, p_product_key: "a".repeat(64) }],
      ["video_memory_remove", { p_platform: "tiktok", p_video_key: VIDEO_ID, p_product_key: "a".repeat(64) }],
    ] as const) {
      expect((await asBob.rpc(fn, args)).error, fn).not.toBeNull();
    }
  });

  it("le compte de Dave est supprimé : son spot et ses pièces partent, la jupe redevient cachée, le compteur suit", async () => {
    // Suppression vérifiée ici (l'outil commun des tests ignore les erreurs) : un échec doit se voir.
    const { error: deleteError } = await app.supabaseAdmin.auth.admin.deleteUser(dave.id);
    expect(deleteError?.message ?? null).toBeNull();
    const { count: daveSpots } = await app.supabaseAdmin.from("video_spots").select("id", { count: "exact", head: true }).eq("user_id", dave.id);
    expect(daveSpots).toBe(0);
    expect((await products(alice)).products).toEqual([]);
    const { data: source } = await app.supabaseAdmin.from("video_sources").select("spot_count").eq("platform", "tiktok").eq("video_key", VIDEO_ID).single();
    expect(source).toEqual({ spot_count: 3 });
  });
});
