import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { LEGAL_DOCUMENT_VERSIONS } from "@monapp/shared-types";
import { EXPORT_APPENDIX_ID } from "../src/lib/exportHtml.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { EXPORT_COLUMNS, EXPORT_SECTIONS, EXPORT_TEXT, type ExportColumn } from "../src/lib/exportText.js";
import { decodeHtml, visibleText } from "./exportFixture.js";
import { createClient } from "@supabase/supabase-js";
import { env } from "../src/env.js";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

// Chaque section de données personnelles que l'export doit contenir — et
// qu'on remplit ci-dessous avant d'exporter. Une section ajoutée à l'export
// sans être ajoutée ici (ou l'inverse) fait échouer le test.
const NON_EMPTY_SECTIONS = [
  "productSearches",
  "productMatches",
  "vaultItems",
  "wishlistItems",
  "posts",
  "postTaggedPieces",
  "reactionsGiven",
  "followers",
  "following",
  "blockedAccounts",
  "reportsSubmitted",
  "comments",
  "notifications",
  "affiliateClicks",
  "affiliateConversions",
  "consents",
  "dataExportRequests",
  // Lot 5 : pièces envoyées et reçues, modération.
  "piecesSent",
  "piecesReceived",
  "moderationDecisionsAboutMe",
  "moderationDecisionsTaken",
  // Fiabilité des résultats : bouton « Résultat incohérent » (migration 0025).
  "resultFeedback",
] as const;

// Lot messages : conversations et messages, seulement une fois la migration
// 0032 appliquée sur la base des tests (sans elle, ces sections restent vides).
const messagesProbe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).from("messages").select("id").limit(0);
const MESSAGE_SECTIONS = messagesProbe.error ? [] : (["conversations", "messages"] as const);

// Lot collections : collections et envies rangées, seulement une fois la
// migration 0033 appliquée sur la base des tests (sans elle, sections vides).
const collectionsProbe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).from("collections").select("id").limit(0);
const COLLECTION_SECTIONS = collectionsProbe.error ? [] : (["collections", "collectionItems"] as const);

// Lot notifications : un appareil enregistré, seulement une fois la migration
// 0035 appliquée sur la base des tests (sans elle, section vide).
const pushProbe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).from("push_tokens").select("token").limit(0);
const PUSH_SECTIONS = pushProbe.error ? [] : (["pushDevices"] as const);

// Lot alertes prix et stock : cloche, suivi, alerte et signalement, seulement
// une fois la migration 0036 appliquée sur la base des tests (sans elle, sections vides).
const alertsProbe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).rpc("wish_alerts_version");
// 1 : 0036 seule ; 2 : avec ses garde-fous (0040) ; 3 : nouvelle version (0041) — les données sont exportées dans tous les cas.
const ALERT_SECTIONS = alertsProbe.error || typeof alertsProbe.data !== "number" || alertsProbe.data < 1 ? [] : (["wishWatches", "wishTracking", "wishAlertEvents", "stockReports"] as const);
const ALERTS_V2 = !alertsProbe.error && typeof alertsProbe.data === "number" && alertsProbe.data >= 3;

// Essayage virtuel : profil d'essayage, essais, essais offerts et
// signalements, seulement une fois la migration 0042 appliquée sur la base des
// tests (sans elle, sections vides). Rien n'allume l'essayage : les lignes
// sont écrites directement, sans photo ni appel au fournisseur.
const tryonProbe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).rpc("tryon_version");
const TRYON_MIGRATED = !tryonProbe.error && tryonProbe.data === 1;
const TRYON_SECTIONS = TRYON_MIGRATED ? (["tryonEvents", "tryonBonusGrants", "tryonReports"] as const) : [];

// Mémoire des vidéos (revue de sécurité) : un spot et une confirmation, dès
// que la migration 0038 est appliquée sur la base des tests (sans elle,
// sections vides ; l'export les lit même sans 0039).
const videoProbe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).rpc("video_memory_version");
const VIDEO_SECTIONS = videoProbe.error || typeof videoProbe.data !== "number" || videoProbe.data < 1 ? [] : (["videoSpots", "videoConfirmations"] as const);
const VIDEO_KEY = `74${Date.now()}`.padEnd(19, "1").slice(0, 19);

// Compte privé (lot « vie sociale ») : une demande d'abonnement envoyée et
// une reçue, seulement une fois la migration 0045 appliquée sur la base des
// tests (sans elle, sections vides).
const followRequestsProbe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).from("follow_requests").select("requester_id").limit(0);
const FOLLOW_REQUEST_SECTIONS = followRequestsProbe.error ? [] : (["followRequestsSent", "followRequestsReceived"] as const);

// Commentaires, suite (lot « vie sociale ») : un commentaire aimé, une mention
// reçue et une écrite, seulement une fois la migration 0046 appliquée sur la
// base des tests (sans elle, sections vides).
const commentThreadsProbe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).from("comment_mentions").select("comment_id, author_id").limit(0);
const COMMENT_THREAD_SECTIONS = commentThreadsProbe.error ? [] : (["commentReactionsGiven", "mentionsReceived", "mentionsMade"] as const);

// Plusieurs photos, identifications (lot « vie sociale ») : une photo de plus,
// une identification faite et une reçue, seulement une fois la migration 0047
// appliquée sur la base des tests (sans elle, sections vides).
const postExtrasProbe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).from("post_people_tags").select("post_id, author_id").limit(0);
const POST_EXTRA_SECTIONS = postExtrasProbe.error ? [] : (["postMedia", "peopleTagsMade", "peopleTagsReceived"] as const);

// Publications enregistrées (lot « vie sociale ») : la publication de l'ami
// enregistrée, seulement une fois la migration 0048 appliquée sur la base des
// tests (sans elle, section vide).
const savedPostsProbe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).from("saved_posts").select("user_id, post_id").limit(0);
const SAVED_POST_SECTIONS = savedPostsProbe.error ? [] : (["savedPosts"] as const);

// Épingles et lien en bio (lot « vie sociale ») : une publication épinglée et
// un lien sur le profil, seulement une fois la migration 0049 appliquée sur la
// base des tests (sans elle, ni l'une ni l'autre colonne n'existe).
const profileExtrasProbe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).from("profiles").select("link_url").limit(0);
const PROFILE_EXTRAS_MIGRATED = !profileExtrasProbe.error;

// Fil « Pour vous » (lot « découverte ») : le réglage « Proposer mon compte aux
// autres membres », seulement une fois la migration 0050 appliquée.
const discoveryProbe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).from("profiles").select("discoverable").limit(0);
const DISCOVERY_MIGRATED = !discoveryProbe.error;

// Sections qui sont un objet (ou null), pas une liste.
const OBJECT_SECTIONS = ["account", "profile", "adminRole", "suspension", ...(TRYON_MIGRATED ? (["tryonProfile"] as const) : [])] as const;

// Clés du JSON, dans l'ordre : celles d'avant (anciennes versions de l'app
// iPhone, qui lisent ce JSON) et `account`, la seule ajoutée.
const JSON_KEYS = [
  "exportedAt",
  "account",
  "profile",
  "productSearches",
  "productMatches",
  "vaultItems",
  "wishlistItems",
  "posts",
  "postTaggedPieces",
  "reactionsGiven",
  "followers",
  "following",
  "blockedAccounts",
  "reportsSubmitted",
  "comments",
  "notifications",
  "affiliateClicks",
  "affiliateConversions",
  "consents",
  "dataExportRequests",
  "piecesSent",
  "piecesReceived",
  "adminRole",
  "suspension",
  "moderationDecisionsAboutMe",
  "moderationDecisionsTaken",
  "resultFeedback",
  // Lot messages : ajoutées à la fin (les anciennes clés gardent leur ordre).
  "conversations",
  "messages",
  // Lot collections, de même.
  "collections",
  "collectionItems",
  // Lot notifications, de même.
  "pushDevices",
  // Lot alertes prix et stock, de même.
  "wishWatches",
  "wishTracking",
  "wishAlertEvents",
  "stockReports",
  // Lot essayage virtuel, de même.
  "tryonProfile",
  "tryonEvents",
  "tryonBonusGrants",
  "tryonReports",
  // Mémoire des vidéos, de même.
  "videoSpots",
  "videoConfirmations",
  // Compte privé (migration 0045), de même.
  "followRequestsSent",
  "followRequestsReceived",
  // Commentaires, suite (migration 0046), de même.
  "commentReactionsGiven",
  "mentionsReceived",
  "mentionsMade",
  // Plusieurs photos, identifications (migration 0047), de même.
  "postMedia",
  "peopleTagsMade",
  "peopleTagsReceived",
  // Publications enregistrées (migration 0048), de même.
  "savedPosts",
];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

// Audit Lot Q, SEC-01 : l'export oubliait Envies, blocages, signalements,
// notifications, j'aime, demandes d'export, et le contexte des clics.
describe("export RGPD complet", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let friend: TestUser;
  let stranger: TestUser;
  let admin: TestUser;
  let postId = "";

  const exportOf = (who: TestUser, query = "", headers: Record<string, string> = {}) =>
    app.inject({ method: "GET", url: `/api/me/export${query}`, headers: { ...authHeaders(who.token), ...headers } });
  const exportRequests = async (who: TestUser): Promise<number> => {
    const { count, error } = await app.supabaseAdmin.from("data_export_requests").select("id", { count: "exact", head: true }).eq("user_id", who.id);
    if (error) throw error;
    return count ?? 0;
  };

  beforeAll(async () => {
    app = await buildTestApp();
    [user, friend, stranger, admin] = await Promise.all([
      createTestUser(app, "exa"),
      createTestUser(app, "exb"),
      createTestUser(app, "exc"),
      createTestUser(app, "exd"),
    ]);

    // Abonnements dans les deux sens (+ notification "follow" reçue).
    await app.inject({ method: "POST", url: `/api/follows/${user.id}`, headers: authHeaders(friend.token) });
    await app.inject({ method: "POST", url: `/api/follows/${friend.id}`, headers: authHeaders(user.token) });

    // Recherche + résultat (insérés directement : aucun appel SerpApi).
    const { data: search } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: user.id, source_url: "https://www.tiktok.com/@x/video/1", source_platform: "tiktok", method: "oembed", status: "completed" })
      .select("id")
      .single();
    const { data: match } = await app.supabaseAdmin
      .from("product_matches")
      .insert({ search_id: search!.id, rank: 1, product_name: "Sac", image_url: "https://example.com/a.jpg", merchant_url: "https://example.com/p" })
      .select("id")
      .single();
    await app.supabaseAdmin.from("affiliate_links").insert({ product_match_id: match!.id, network: "direct", affiliate_url: "https://example.com/p" });
    // Compte privé : une demande reçue (de l'ami) et une demande envoyée (à
    // lui), écrites directement. Jamais l'administratrice de test : elle ne
    // doit être nommée nulle part dans l'export. Jamais l'inconnu non plus :
    // il est bloqué plus bas, ses demandes seraient donc écartées.
    if (FOLLOW_REQUEST_SECTIONS.length > 0) {
      const requests = await app.supabaseAdmin.from("follow_requests").insert([
        { requester_id: friend.id, target_id: user.id },
        { requester_id: user.id, target_id: friend.id },
      ]);
      if (requests.error) throw requests.error;
    }
    // Mémoire des vidéos : un spot de cette recherche et une confirmation, insérés directement.
    if (VIDEO_SECTIONS.length > 0) {
      const { data: video, error: videoError } = await app.supabaseAdmin
        .from("video_sources")
        .insert({ platform: "tiktok", video_key: VIDEO_KEY, canonical_url: `https://www.tiktok.com/@/video/${VIDEO_KEY}` })
        .select("id")
        .single();
      if (videoError) throw videoError;
      const { data: spot, error: spotError } = await app.supabaseAdmin
        .from("video_spots")
        .insert({ video_source_id: video!.id, user_id: user.id, search_id: search!.id, source: "tiktok_player", moment_seconds: 12 })
        .select("id")
        .single();
      if (spotError) throw spotError;
      const { error: itemError } = await app.supabaseAdmin.from("video_spot_items").insert({ video_spot_id: spot!.id, product_match_id: match!.id, video_source_id: video!.id, product_key: "c".repeat(64) });
      if (itemError) throw itemError;
      const { error: confirmError } = await app.supabaseAdmin.from("video_item_confirmations").insert({ user_id: user.id, video_source_id: video!.id, product_key: "c".repeat(64) });
      if (confirmError) throw confirmError;
    }
    // Bouton « Résultat incohérent » : la proposition signalée.
    const { error: feedbackError } = await app.supabaseAdmin.from("match_feedback").insert({ user_id: user.id, match_id: match!.id, reason: "wrong_item" });
    if (feedbackError) throw feedbackError;

    // Clic marchand avec contexte, puis un achat suivi rattaché à ce clic.
    await app.inject({
      method: "POST",
      url: `/api/product-matches/${match!.id}/click`,
      headers: { ...authHeaders(user.token), "user-agent": "test-agent" },
      payload: { context: "result" },
    });
    const { data: click } = await app.supabaseAdmin.from("affiliate_clicks").select("id").eq("user_id", user.id).single();
    const { error: conversionError } = await app.supabaseAdmin.from("affiliate_conversions").insert({
      affiliate_click_id: click!.id,
      external_conversion_id: `test-${user.id}`,
      amount: 49.99,
      currency: "EUR",
      commission: 2.5,
    });
    if (conversionError) throw conversionError;

    // Publication avec la pièce taguée.
    const post = buildMultipart(
      { type: "lifestyle", privacy: "public", taggedPieces: JSON.stringify([{ productMatchId: match!.id }]) },
      { fieldname: "file", filename: "a.png", contentType: "image/png", data: PNG }
    );
    postId = (await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(user.token), ...post.headers }, payload: post.payload })).json().id;

    // Épingles et lien en bio (migration 0049) : sa publication épinglée (avant
    // la suspension, plus bas), et un lien sur son profil.
    if (PROFILE_EXTRAS_MIGRATED) {
      const pinned = await app.inject({ method: "PUT", url: `/api/posts/${postId}/pin`, headers: authHeaders(user.token), payload: { pinned: true } });
      if (pinned.statusCode !== 200) throw new Error(`Épingle de test refusée (${pinned.statusCode}).`);
      const linked = await app.supabaseAdmin.from("profiles").update({ link_url: "https://exemple.com/lookbook" }).eq("id", user.id);
      if (linked.error) throw linked.error;
    }

    // Fil « Pour vous » (migration 0050) : le réglage éteint, par sa route (avant la suspension, plus bas).
    if (DISCOVERY_MIGRATED) {
      const off = await app.inject({ method: "PUT", url: "/api/me/discoverable", headers: authHeaders(user.token), payload: { discoverable: false } });
      if (off.statusCode !== 204) throw new Error(`Réglage « Proposer mon compte » refusé (${off.statusCode}).`);
    }

    // J'aime donné sur la publication d'un ami.
    const friendPost = buildMultipart({ type: "lifestyle", privacy: "public" }, { fieldname: "file", filename: "b.png", contentType: "image/png", data: PNG });
    const friendPostId = (
      await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(friend.token), ...friendPost.headers }, payload: friendPost.payload })
    ).json().id;
    await app.inject({ method: "POST", url: `/api/posts/${friendPostId}/react`, headers: authHeaders(user.token) });
    // Commentaire sur la publication de l'ami (Lot F).
    await app.inject({ method: "POST", url: `/api/posts/${friendPostId}/comments`, headers: authHeaders(user.token), payload: { body: "Superbe" } });
    // Commentaires, suite (migration 0046) : l'ami répond en mentionnant la
    // personne, elle aime cette réponse, et son propre commentaire mentionne
    // l'ami. Lignes écrites directement : le réglage de départ (« les comptes
    // que je suis ») écarterait ces mentions entre deux comptes qui ne se suivent pas.
    if (COMMENT_THREAD_SECTIONS.length > 0) {
      const mine = await app.supabaseAdmin.from("comments").select("id").eq("user_id", user.id).eq("post_id", friendPostId).single();
      if (mine.error || !mine.data) throw mine.error ?? new Error("Commentaire de test introuvable.");
      const theirs = await app.supabaseAdmin
        .from("comments")
        .insert({ post_id: friendPostId, user_id: friend.id, body: `Merci @${user.username}`, parent_id: mine.data.id })
        .select("id")
        .single();
      if (theirs.error || !theirs.data) throw theirs.error ?? new Error("Réponse de test non créée.");
      const mentions = await app.supabaseAdmin.from("comment_mentions").insert([
        { comment_id: theirs.data.id, user_id: user.id, author_id: friend.id, handle: user.username },
        { comment_id: mine.data.id, user_id: friend.id, author_id: user.id, handle: friend.username },
      ]);
      if (mentions.error) throw mentions.error;
      const liked = await app.inject({ method: "PUT", url: `/api/comments/${theirs.data.id}/like`, headers: authHeaders(user.token), payload: { liked: true } });
      if (liked.statusCode !== 200) throw new Error(`« J'aime » de test refusé (${liked.statusCode}).`);
    }

    // Plusieurs photos, identifications (migration 0047) : une photo de plus sur
    // sa publication, l'ami identifié dessus, et elle identifiée sur celle de
    // l'ami. Lignes écrites directement : le réglage de départ (« les comptes
    // que je suis ») écarterait ces identifications entre deux comptes qui ne se suivent pas.
    if (POST_EXTRA_SECTIONS.length > 0) {
      const extras = await Promise.all([
        app.supabaseAdmin.from("post_media").insert({ user_id: user.id, post_id: postId, position: 1, media_url: "https://example.com/p2.jpg", media_thumb_url: "https://example.com/p2-mini.jpg" }),
        app.supabaseAdmin.from("post_people_tags").insert([
          { post_id: postId, user_id: friend.id, author_id: user.id },
          { post_id: friendPostId, user_id: user.id, author_id: friend.id },
        ]),
      ]);
      for (const written of extras) if (written.error) throw written.error;
    }

    // Publications enregistrées (migration 0048) : la publication de l'ami, sans collection.
    if (SAVED_POST_SECTIONS.length > 0) {
      const saved = await app.inject({ method: "PUT", url: `/api/posts/${friendPostId}/save`, headers: authHeaders(user.token), payload: {} });
      if (saved.statusCode !== 200) throw new Error(`Publication enregistrée de test refusée (${saved.statusCode}).`);
    }

    // Vault, Envie, blocage, signalement, consentement.
    await app.supabaseAdmin.from("vault_items").insert({ user_id: user.id, title: "Montre", image_url: "https://example.com/m.jpg", category: "watches" });
    await app.inject({ method: "POST", url: "/api/wishlist", headers: authHeaders(user.token), payload: { title: "Envie", imageUrl: "https://example.com/e.jpg" } });
    await app.inject({ method: "POST", url: `/api/blocks/${stranger.id}`, headers: authHeaders(user.token) });
    await app.inject({ method: "POST", url: "/api/reports", headers: authHeaders(user.token), payload: { targetType: "user", targetId: stranger.id, reason: "spam" } });
    await app.inject({ method: "POST", url: "/api/consents", headers: authHeaders(user.token), payload: { consents: [{ type: "terms", version: LEGAL_DOCUMENT_VERSIONS.terms }] } });

    // Pièces envoyée et reçue (lot 5), insérées directement : aucune copie d'image ici.
    const piece = { title: "Sac", image_url: "https://example.com/copie.jpg", image_thumb_url: "https://example.com/copie-mini.jpg" };
    const { error: piecesError } = await app.supabaseAdmin.from("piece_sends").insert([
      { ...piece, sender_id: user.id, recipient_id: friend.id },
      { ...piece, sender_id: friend.id, recipient_id: user.id },
    ]);
    if (piecesError) throw piecesError;

    // Modération (lot 5) : la personne est aussi administratrice (décision
    // qu'elle a prise, insérée directement) ; une autre administratrice
    // masque sa publication puis suspend son compte (en dernier : un compte
    // suspendu peut toujours exporter ses données).
    const { error: adminsError } = await app.supabaseAdmin.from("admins").insert([{ user_id: admin.id }, { user_id: user.id }]);
    if (adminsError) throw adminsError;
    const { error: takenError } = await app.supabaseAdmin
      .from("moderation_actions")
      .insert({ admin_id: user.id, action: "dismiss", target_type: "user", target_id: stranger.id, target_user_id: stranger.id });
    if (takenError) throw takenError;
    const decide = (payload: object) => app.inject({ method: "POST", url: "/api/admin/moderation/actions", headers: authHeaders(admin.token), payload });
    expect((await decide({ targetType: "post", targetId: postId, action: "hide", reason: "spam" })).statusCode).toBe(200);
    expect((await decide({ targetType: "user", targetId: user.id, action: "suspend", reason: "spam", note: "Essai d'export" })).statusCode).toBe(200);

    // Messages privés (lot messages) : un message à un ami (chacun suit l'autre).
    if (MESSAGE_SECTIONS.length > 0) {
      const sent = await app.inject({ method: "POST", url: "/api/messages", headers: authHeaders(friend.token), payload: { recipientId: user.id, text: "Bonjour" } });
      expect(sent.statusCode).toBe(201);
    }

    // Collections (lot collections) : une collection privée, avec l'Envie
    // (un compte suspendu range toujours ses propres envies).
    if (COLLECTION_SECTIONS.length > 0) {
      const created = await app.inject({ method: "POST", url: "/api/collections", headers: authHeaders(user.token), payload: { name: "Idées" } });
      expect(created.statusCode).toBe(201);
      const [wish] = (await app.inject({ method: "GET", url: "/api/wishlist", headers: authHeaders(user.token) })).json().items as { id: string }[];
      const placed = await app.inject({ method: "PUT", url: `/api/wishlist/${wish!.id}/collections`, headers: authHeaders(user.token), payload: { collectionIds: [created.json().id] } });
      expect(placed.statusCode).toBe(200);
    }

    // Notifications (lot notifications) : un appareil, inséré directement
    // (l'interrupteur PUSH_ENABLED peut être coupé sur ce serveur de tests).
    if (PUSH_SECTIONS.length > 0) {
      const { error: pushError } = await app.supabaseAdmin
        .from("push_tokens")
        .insert({ token: `ExponentPushToken[export${user.id.slice(0, 8)}]`, user_id: user.id, platform: "ios" });
      if (pushError) throw pushError;
    }

    // Alertes prix et stock (lot 2) : une cloche sur l'Envie (son suivi est
    // créé au besoin), une alerte et un signalement « Plus disponible »,
    // insérés directement (aucune observation, aucun envoi).
    if (ALERT_SECTIONS.length > 0) {
      const [wish] = (await app.inject({ method: "GET", url: "/api/wishlist", headers: authHeaders(user.token) })).json().items as { id: string }[];
      const watched = await app.inject({ method: "PUT", url: `/api/wishlist/${wish!.id}/alerts`, headers: authHeaders(user.token), payload: { priceDrop: true, restock: true } });
      // Envie sans lien de boutique (créée à la main ci-dessus) : pas de clé, pas de cloche.
      expect([200, 422]).toContain(watched.statusCode);
      if (watched.statusCode === 422) {
        const { error } = await app.supabaseAdmin.from("wish_watches").insert({ wishlist_item_id: wish!.id, user_id: user.id, notify_price_drop: true });
        if (error) throw error;
      }
      // 0041 : plus aucune heure (send_after retiré), le jour seulement.
      const { error: eventError } = await app.supabaseAdmin
        .from("wish_alert_events")
        .insert({ wishlist_item_id: wish!.id, user_id: user.id, kind: "restock", created_on: "2026-11-09", status: "expired", ...(ALERTS_V2 ? {} : { send_after: new Date().toISOString() }) });
      if (eventError) throw eventError;
      // 0041 : le pays de la recherche du signalement est gardé (et exporté).
      const { error: reportError } = await app.supabaseAdmin
        .from("stock_reports")
        .insert({ user_id: user.id, match_key_hash: "b".repeat(64), created_on: "2026-11-09", ...(ALERTS_V2 ? { country: "fr" } : {}) });
      if (reportError) throw reportError;
    }

    // Essayage virtuel (lot essayage virtuel) : statut d'âge, consentement,
    // un essai échoué, des essais offerts et un signalement, écrits
    // directement (aucune photo, aucun appel au fournisseur).
    if (TRYON_MIGRATED) {
      const age = await app.supabaseAdmin.rpc("tryon_set_age", { p_user_id: user.id, p_status: "adult" });
      if (age.error) throw age.error;
      const consent = await app.supabaseAdmin
        .from("tryon_profiles")
        .update({ consent_version: "2026-11-v1", consent_accepted_at: new Date().toISOString() })
        .eq("user_id", user.id);
      if (consent.error) throw consent.error;
      const finished = new Date().toISOString();
      const event = await app.supabaseAdmin.from("tryon_events").insert({
        user_id: user.id,
        item_id: match!.id,
        status: "failed",
        error_code: "pose_not_detected",
        duration_ms: 9000,
        month: finished.slice(0, 7),
        finished_at: finished,
      });
      if (event.error) throw event.error;
      // La référence de commande est montrée dans le fichier lisible : aucun identifiant interne
      // dedans (le test « aucun identifiant interne dans le texte visible »), unique à chaque passage.
      const orderRef = `TEST-ESSAI-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
      const grant = await app.supabaseAdmin.rpc("tryon_grant_bonus", { p_user_id: user.id, p_order_ref: orderRef });
      if (grant.error) throw grant.error;
      const report = await app.supabaseAdmin.from("tryon_reports").insert({ user_id: user.id, item_id: match!.id, reason: "wrong_piece", comment: "Essai d'export" });
      if (report.error) throw report.error;
    }

    // Un premier export, pour que le second contienne cette demande.
    await exportOf(user);
    // Beaucoup d'écritures réelles vers spotto-dev : plus que le délai par défaut.
  }, 60_000);

  afterAll(async () => {
    // L'achat suivi survit à son clic (« on delete set null ») : retiré ici.
    await app.supabaseAdmin.from("affiliate_conversions").delete().eq("external_conversion_id", `test-${user.id}`);
    await deleteTestUser(app, user.id);
    await deleteTestUser(app, friend.id);
    await deleteTestUser(app, stranger.id);
    await deleteTestUser(app, admin.id);
    if (VIDEO_SECTIONS.length > 0) await app.supabaseAdmin.from("video_sources").delete().eq("platform", "tiktok").eq("video_key", VIDEO_KEY);
    await app.close();
  });

  it("contient chaque catégorie de données personnelles (compte suspendu compris)", async () => {
    const res = await exportOf(user);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.profile.id).toBe(user.id);
    for (const section of [...NON_EMPTY_SECTIONS, ...MESSAGE_SECTIONS, ...COLLECTION_SECTIONS, ...PUSH_SECTIONS, ...ALERT_SECTIONS, ...TRYON_SECTIONS, ...VIDEO_SECTIONS, ...FOLLOW_REQUEST_SECTIONS, ...COMMENT_THREAD_SECTIONS, ...POST_EXTRA_SECTIONS, ...SAVED_POST_SECTIONS]) {
      expect(Array.isArray(body[section]), section).toBe(true);
      expect(body[section].length, section).toBeGreaterThan(0);
    }
    expect(body.adminRole).toEqual({ created_at: expect.any(String) });
    // Les demandes d'abonnement nomment l'ami, jamais l'administratrice de test.
    if (FOLLOW_REQUEST_SECTIONS.length > 0) {
      expect(body.followRequestsSent.map((row: { target_id: string }) => row.target_id)).toEqual([friend.id]);
      expect(body.followRequestsReceived.map((row: { requester_id: string }) => row.requester_id)).toEqual([friend.id]);
      expect(JSON.stringify(body)).not.toContain(admin.id);
    }
    // Commentaires, suite : le commentaire aimé, la mention reçue de l'ami et celle écrite pour lui.
    if (COMMENT_THREAD_SECTIONS.length > 0) {
      expect(Object.keys(body.commentReactionsGiven[0]).sort()).toEqual(["comment_id", "created_at"]);
      expect(body.mentionsReceived.map((row: { author_id: string; handle: string }) => [row.author_id, row.handle])).toEqual([[friend.id, user.username]]);
      expect(body.mentionsMade.map((row: { user_id: string; handle: string }) => [row.user_id, row.handle])).toEqual([[friend.id, friend.username]]);
      expect(body.profile.mentions_from).toBe("following");
    }
    // Plusieurs photos, identifications : la photo de plus, l'ami identifié, la publication de l'ami où elle l'est (visible).
    if (POST_EXTRA_SECTIONS.length > 0) {
      expect(Object.keys(body.postMedia[0]).sort()).toEqual(["created_at", "id", "media_thumb_url", "media_url", "position", "post_id"]);
      expect(body.peopleTagsMade.map((row: { post_id: string; user_id: string }) => [row.post_id, row.user_id])).toEqual([[postId, friend.id]]);
      expect(body.peopleTagsReceived.map((row: { author_id: string; post_available: boolean }) => [row.author_id, row.post_available])).toEqual([[friend.id, true]]);
    }
    // Publications enregistrées : celle de l'ami, encore visible, avec son auteur ; rien de la publication elle-même.
    if (SAVED_POST_SECTIONS.length > 0) {
      expect(Object.keys(body.savedPosts[0]).sort()).toEqual(["author_id", "collection_id", "collection_name", "created_at", "post_available", "post_id"]);
      expect(body.savedPosts.map((row: { author_id: string; post_available: boolean; collection_id: string | null }) => [row.author_id, row.post_available, row.collection_id])).toEqual([[friend.id, true, null]]);
    }
    // Épingles et lien en bio (migration 0049) : le lien du profil et la date de l'épingle.
    if (PROFILE_EXTRAS_MIGRATED) {
      expect(body.profile.link_url).toBe("https://exemple.com/lookbook");
      expect(body.posts.find((row: { id: string }) => row.id === postId)?.pinned_at).toEqual(expect.any(String));
    }
    // Fil « Pour vous » (migration 0050) : le réglage, tel que la personne l'a laissé.
    if (DISCOVERY_MIGRATED) expect(body.profile.discoverable).toBe(false);
    else expect("discoverable" in body.profile).toBe(false);
    expect(body.suspension).toMatchObject({ moderation_action_id: expect.any(String) });
    // Un appareil : son système et ses dates (avec 0036 : s'il reçoit les messages, les alertes), jamais son jeton.
    const deviceColumns = ALERT_SECTIONS.length > 0 ? ["created_at", "notify_alerts", "notify_messages", "platform", "updated_at"] : ["created_at", "platform", "updated_at"];
    for (const device of body.pushDevices) expect(Object.keys(device).sort()).toEqual(deviceColumns);
    expect(JSON.stringify(body)).not.toContain("ExponentPushToken[");
    // Alertes, nouvelle version (0041) : un signalement « Plus disponible » garde son auteur (sa table, son export),
    // « Aider les autres membres » est exporté, et aucune heure d'alerte.
    if (ALERTS_V2) {
      expect(body.stockReports).toEqual([expect.objectContaining({ match_key_hash: "b".repeat(64), created_on: "2026-11-09", country: "fr", helps_others: true, in_streak: true })]);
      expect(body.profile).toMatchObject({ help_others: true, price_alerts_enabled: expect.any(Boolean) });
      expect(body.wishAlertEvents[0]).toMatchObject({ created_on: "2026-11-09", sent_on: null });
      expect(JSON.stringify(body.wishAlertEvents)).not.toMatch(/created_at|send_after|sent_at|claimed_at|pushing_at/);
    }
    // Essayage virtuel : le statut d'âge, jamais une date de naissance ni une image.
    if (TRYON_MIGRATED) {
      expect(body.tryonProfile).toMatchObject({ age_status: "adult", consent_version: "2026-11-v1", consent_withdrawn_at: null });
      expect(Object.keys(body.tryonProfile).sort()).toEqual(["age_checked_at", "age_status", "consent_accepted_at", "consent_version", "consent_withdrawn_at"]);
      expect(JSON.stringify([body.tryonProfile, body.tryonEvents, body.tryonReports])).not.toMatch(/base64|data:image|birth/i);
    }
    if (VIDEO_SECTIONS.length > 0) {
      expect(body.videoSpots).toEqual([{ canonical_url: `https://www.tiktok.com/@/video/${VIDEO_KEY}`, source: "tiktok_player", moment_seconds: 12, created_at: expect.any(String), search_id: expect.any(String) }]);
      expect(body.videoConfirmations).toEqual([{ canonical_url: `https://www.tiktok.com/@/video/${VIDEO_KEY}`, product: "Sac", created_at: expect.any(String) }]);
    }
  });

  it("sans format : le même JSON qu'avant (mêmes clés), plus l'adresse e-mail du compte, jamais mis en cache", async () => {
    const res = await exportOf(user);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json();
    expect(Object.keys(body)).toEqual(JSON_KEYS);
    expect(body.account).toEqual({ email: user.email });
    expect((await exportOf(user, "?format=json")).json().account).toEqual({ email: user.email });
    expect((await exportOf(user, "?format=pdf")).statusCode).toBe(400);
  }, 60_000);

  it("inclut le contexte et le navigateur des clics marchands", async () => {
    const body = (await exportOf(user)).json();
    expect(body.affiliateClicks[0].context).toBe("result");
    expect(body.affiliateClicks[0].user_agent).toBe("test-agent");
  });

  it("inclut la version des documents acceptés", async () => {
    const body = (await exportOf(user)).json();
    expect(body.consents[0].document_version).toBe(LEGAL_DOCUMENT_VERSIONS.terms);
  });

  it("ne contient que les données de l'utilisateur lui-même", async () => {
    const body = (await exportOf(user)).json();
    for (const n of body.notifications) expect(n.user_id).toBe(user.id);
    for (const r of body.reportsSubmitted) expect(r.reporter_id).toBe(user.id);
    for (const w of body.wishlistItems) expect(w.user_id).toBe(user.id);
    for (const p of body.posts) expect(p.user_id).toBe(user.id);
    for (const s of body.piecesSent) expect(s.sender_id).toBe(user.id);
    for (const r of body.piecesReceived) expect(r.recipient_id).toBe(user.id);
    for (const decision of body.moderationDecisionsAboutMe) expect(decision).not.toHaveProperty("admin_id");
  });

  it("chaque section et chaque colonne a sa place et son libellé FR et EN dans le fichier lisible", async () => {
    const body = (await exportOf(user)).json() as Record<string, unknown>;
    const sectionKeys = Object.values(EXPORT_SECTIONS).flatMap((section) => [...section.keys] as string[]);
    const problems: string[] = [];
    for (const key of Object.keys(body).filter((k) => k !== "exportedAt")) {
      if (sectionKeys.filter((k) => k === key).length !== 1) problems.push(`${key} : dans aucune section du fichier, ou dans plusieurs`);
      const columns = (EXPORT_COLUMNS as Record<string, Record<string, ExportColumn>>)[key];
      if (!columns) {
        problems.push(`${key} : aucune colonne décrite`);
        continue;
      }
      const value = body[key];
      const rows = (Array.isArray(value) ? value : value ? [value] : []) as Record<string, unknown>[];
      for (const column of new Set(rows.flatMap((row) => Object.keys(row)))) {
        const entry = columns[column];
        if (!entry) problems.push(`${key}.${column} : colonne sans libellé (ni affichée, ni technique)`);
        else if (!entry.label.fr.trim() || !entry.label.en.trim()) problems.push(`${key}.${column} : libellé vide`);
      }
    }
    expect(problems).toEqual([]);
    for (const key of sectionKeys) expect(Object.keys(body)).toContain(key);
    for (const key of OBJECT_SECTIONS) expect(body[key], key).not.toBeNull();
  });

  it("fichier lisible en français : en-têtes, sécurité, titres, une demande d'export de plus", async () => {
    const before = await exportRequests(user);
    const res = await exportOf(user, "?format=html", { "accept-language": "fr", "x-time-zone": "Asia/Tokyo" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="spotto-mes-donnees-\d{4}-\d{2}-\d{2}\.html"$/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(res.headers["content-security-policy"])).toMatch(/^sandbox; default-src 'none'; img-src https:\/\/[^;]+; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'$/);
    const page = res.body;
    expect(page).toMatch(/<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src [^"]+; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">/);
    expect(page).toContain('<html lang="fr">');
    const text = visibleText(page);
    for (const section of Object.values(EXPORT_SECTIONS)) expect(text, section.title.fr).toContain(section.title.fr);
    expect(text).toContain("Asia/Tokyo");
    expect(text).toContain(`@${friend.username}`);
    expect(await exportRequests(user)).toBe(before + 1);
  }, 60_000);

  it("fichier lisible en anglais ; « Aucune donnée » / « No data » pour une section vide ; fuseau invalide remplacé", async () => {
    const res = await exportOf(user, "?format=html", { "accept-language": "en-GB", "x-time-zone": "Mars/Olympus" });
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="spotto-my-data-\d{4}-\d{2}-\d{2}\.html"$/);
    const text = visibleText(res.body);
    for (const section of Object.values(EXPORT_SECTIONS)) expect(text, section.title.en).toContain(section.title.en);
    expect(text).toContain("time zone: UTC");

    // Le compte bloqué par la personne n'a presque rien : sections vides.
    const empty = await exportOf(stranger, "?format=html", { "accept-language": "fr" });
    expect(visibleText(empty.body)).toContain(EXPORT_TEXT.noData.fr);
    const emptyEn = await exportOf(stranger, "?format=html", { "accept-language": "en" });
    expect(visibleText(emptyEn.body)).toContain(EXPORT_TEXT.noData.en);
  }, 60_000);

  it("neutralise ce que la personne a écrit (légende, bio, commentaire, lien marchand)", async () => {
    const db = app.supabaseAdmin;
    const updates = await Promise.all([
      db.from("posts").update({ caption: "<script>alert(1)</script>" }).eq("id", postId),
      db.from("profiles").update({ bio: '"><img src=x onerror=alert(1)>' }).eq("id", user.id),
      db.from("comments").update({ body: "</pre><script>alert(1)</script>" }).eq("user_id", user.id),
      db.from("wishlist_items").update({ merchant_url: "javascript:alert(1)" }).eq("user_id", user.id),
    ]);
    for (const { error } of updates) expect(error).toBeNull();

    const page = (await exportOf(user, "?format=html", { "accept-language": "fr" })).body;
    expect(page.toLowerCase()).not.toContain("<script");
    expect(page).not.toMatch(/<[a-z][^>]*\son\w+\s*=/i);
    expect(page).not.toMatch(/href="\s*javascript:/i);
    expect(page).not.toMatch(/<img src=x/i);
    const appendix = page.slice(page.indexOf(`<section id="${EXPORT_APPENDIX_ID}"`));
    expect(appendix).toContain("&lt;/pre&gt;&lt;script&gt;");
    const pre = appendix.slice(appendix.indexOf("<pre>") + 5, appendix.indexOf("</pre>"));
    expect(JSON.parse(decodeHtml(pre)).profile.bio).toBe('"><img src=x onerror=alert(1)>');
  }, 60_000);

  it("aucun identifiant interne dans le texte visible ; l'administratrice n'est jamais nommée", async () => {
    const page = (await exportOf(user, "?format=html", { "accept-language": "fr" })).body;
    const text = visibleText(page);
    expect(text).not.toContain(user.id);
    expect(text).not.toMatch(UUID);
    // Décision et suspension racontées (quoi, pourquoi), jamais qui.
    expect(text).toContain("Contenu masqué");
    expect(text).toContain("Essai d'export");
    expect(page).not.toContain(admin.id);
    expect(page).not.toContain(admin.username);
  });

  // En dernier : les exports suivants de ce compte seraient refusés.
  it("limite : 10 exports par heure et par compte (les deux formats), puis 429 avec un message clair", async () => {
    // Limites désactivées sous Vitest (NODE_ENV=test) : réactivées le temps
    // de la vérification, comme dans rateLimit.test.ts.
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const statuses: number[] = [];
      for (let i = 0; i < RATE_LIMITS.dataExport.max; i++) statuses.push((await exportOf(stranger, i % 2 === 0 ? "" : "?format=html")).statusCode);
      expect(RATE_LIMITS.dataExport.max).toBe(10);
      expect(statuses).toEqual(Array(10).fill(200));
      const limited = await exportOf(stranger, "?format=html", { "accept-language": "en" });
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toEqual({ error: "export_limit", message: "You've requested several exports in a short time. Please try again in an hour." });
      expect((await exportOf(stranger)).json()).toEqual({ error: "export_limit", message: RATE_LIMITS.dataExport.message });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
    // 11 exports réels vers spotto-dev : plus long que le délai par défaut.
  }, 120_000);
});
