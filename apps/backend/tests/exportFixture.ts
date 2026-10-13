import { SEARCH_FAILURE_MESSAGES } from "@monapp/shared-types";
import type { ExportData } from "../src/lib/exportData.js";
import { EXPORT_APPENDIX_ID } from "../src/lib/exportHtml.js";
import type { ExportLookups } from "../src/lib/exportLookups.js";

// Outils des tests du fichier lisible de l'export. Données en mémoire
// (tests/exportHtml.test.ts) : formes réelles (devise complétée par des
// espaces, longues adresses signées de TikTok, recherche jamais lancée,
// recherche par photo sans adresse), valeurs inventées.

export const decodeHtml = (text: string): string =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** Texte visible avant la version technique (JSON) : sans l'en-tête, sans
 * balises ni attributs (nos adresses de stockage contiennent l'identifiant
 * de la personne), espaces insécables d'Intl ramenées à des espaces. */
export function visibleText(page: string): string {
  const start = page.indexOf("<body>");
  const end = page.indexOf(`<section id="${EXPORT_APPENDIX_ID}"`);
  const body = page.slice(Math.max(start, 0), end < 0 ? page.length : end);
  return decodeHtml(body.replace(/<[^>]*>/g, " "))
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");
}

/** Le contenu d'une section du fichier (balises comprises). */
export function sectionHtml(page: string, id: string): string {
  const start = page.indexOf(`<section id="${id}">`);
  return start < 0 ? "" : page.slice(start, page.indexOf("</section>", start));
}

export const STORAGE = "https://projet.supabase.co";
export const SELF = "0a000000-0000-4000-8000-000000000001";
export const FRIEND = "0a000000-0000-4000-8000-000000000002";
export const BLOCKER = "0a000000-0000-4000-8000-000000000003"; // a bloqué la personne
export const BLOCKED = "0a000000-0000-4000-8000-000000000004"; // bloqué par la personne
const S_TIKTOK = "5e000000-0000-4000-8000-000000000001";
const S_PHOTO = "5e000000-0000-4000-8000-000000000002";
const S_PENDING = "5e000000-0000-4000-8000-000000000003";
const OWN_POST = "90000000-0000-4000-8000-000000000001";
const FRIEND_POST = "90000000-0000-4000-8000-000000000002";
const BLOCKER_POST = "90000000-0000-4000-8000-000000000003";
const DECISION = "de000000-0000-4000-8000-000000000001";
const LINK = "11000000-0000-4000-8000-000000000001";
const RECEIVED = "4e000000-0000-4000-8000-000000000001";
export const GOOGLE_THUMB = "https://encrypted-tbn2.gstatic.com/images?q=tbn:ANd9GcQexemple";
export const TIKTOK_THUMB = `https://p16-common-sign.tiktokcdn-eu.com/tos-alisg-p-0037/abc~tplv-tiktokx-origin.image?dr=14575&x-expires=1760400000&x-signature=${"a".repeat(180)}`;
export const TIKTOK_VIDEO = "https://www.tiktok.com/@createur/video/7550000000000000000?is_from_webapp=1&sender_device=pc&web_id=7550000000000000001";
export const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
export const own = (bucket: string, file: string) => `${STORAGE}/storage/v1/object/public/${bucket}/${SELF}/${file}`;

export function fixture(): ExportData {
  return {
    exportedAt: "2026-10-12T23:19:27.659Z",
    account: { email: "personne@example.com" },
    profile: {
      id: SELF,
      username: "camille",
      display_name: "Camille",
      avatar_url: own("avatars", "avatar.jpg"),
      bio: "Mode et voyages",
      locale: "fr",
      default_privacy: "followers",
      created_at: "2026-09-01T08:00:00+00:00",
      updated_at: "2026-10-01T08:00:00+00:00",
      piece_sends_from: "following",
    },
    productSearches: [
      {
        id: S_TIKTOK,
        user_id: SELF,
        source_url: TIKTOK_VIDEO,
        source_platform: "tiktok",
        method: "oembed",
        thumbnail_url: TIKTOK_THUMB,
        screenshot_url: null,
        status: "completed",
        error_message: null,
        created_at: "2026-09-09T23:10:16.24329+00:00",
        query: "sac cabas",
      },
      {
        id: S_PHOTO,
        user_id: SELF,
        source_url: null,
        source_platform: "photo",
        method: "manual_screenshot",
        thumbnail_url: null,
        screenshot_url: null,
        status: "failed",
        error_message: SEARCH_FAILURE_MESSAGES.noMatch,
        created_at: "2026-09-10T10:00:00+00:00",
        query: null,
      },
      {
        id: S_PENDING,
        user_id: SELF,
        source_url: "https://www.tiktok.com/@createur/video/7550000000000000002",
        source_platform: "tiktok",
        method: "oembed",
        thumbnail_url: null,
        screenshot_url: null,
        status: "pending",
        error_message: null,
        created_at: "2026-09-11T10:00:00+00:00",
        query: null,
      },
    ],
    productMatches: [
      match("m1", 1, { product_name: "Sac cabas", price_min: 49.99, price_max: 79.99, currency: "EUR", merchant_name: "Boutique" }),
      match("m2", 2, { product_name: "Sac seau", price_min: 60, price_max: 60, currency: "$  " }),
      match("m3", 3, { product_name: "Sac rond", price_min: 25, price_max: null, currency: "€  " }),
      match("m4", 4, { product_name: "Sac plat", price_min: 30, price_max: 30, currency: "$US" }),
      match("m5", 5, { product_name: "Sac banane", price_min: null, price_max: null, currency: "EUR", confidence_score: 0.873 }),
    ],
    vaultItems: [
      {
        id: "va000000-0000-4000-8000-000000000001",
        user_id: SELF,
        product_match_id: null,
        affiliate_conversion_id: null,
        title: "Montre",
        image_url: own("vault-media", "montre.jpg"),
        category: "watches",
        verified: false,
        created_at: "2026-09-12T10:00:00+00:00",
      },
    ],
    wishlistItems: [
      {
        id: "wi000000-0000-4000-8000-000000000001",
        user_id: SELF,
        product_match_id: null,
        title: "Envie dangereuse",
        image_url: GOOGLE_THUMB,
        reference: null,
        price_min: 120,
        currency: "EUR",
        merchant_name: "Marchand",
        merchant_url: "javascript:alert(1)",
        created_at: "2026-09-13T10:00:00+00:00",
      },
    ],
    posts: [
      {
        id: OWN_POST,
        user_id: SELF,
        type: "lifestyle",
        vault_item_id: null,
        caption: "<script>alert(1)</script>",
        media_kind: "photo",
        media_url: own("post-media", "photo.jpg"),
        mux_playback_id: null,
        privacy: "public",
        created_at: "2026-09-14T10:00:00+00:00",
        media_thumb_url: own("post-media", "photo-mini.jpg"),
        hidden_at: null,
        wishlist_item_id: null,
      },
      {
        id: "90000000-0000-4000-8000-000000000009",
        user_id: SELF,
        type: "wish",
        vault_item_id: null,
        caption: null,
        media_kind: "photo",
        // Ancienne publication « envie » : image d'un autre site (jamais affichée).
        media_url: GOOGLE_THUMB,
        mux_playback_id: null,
        privacy: "followers",
        created_at: "2026-09-15T10:00:00+00:00",
        media_thumb_url: null,
        hidden_at: null,
        wishlist_item_id: "wi000000-0000-4000-8000-000000000001",
      },
    ],
    postTaggedPieces: [],
    reactionsGiven: [
      { post_id: FRIEND_POST, created_at: "2026-09-16T10:00:00+00:00" },
      { post_id: BLOCKER_POST, created_at: "2026-09-16T11:00:00+00:00" },
    ],
    followers: [],
    following: [{ followee_id: FRIEND, created_at: "2026-09-02T10:00:00+00:00" }],
    blockedAccounts: [{ blocked_id: BLOCKED, created_at: "2026-09-03T10:00:00+00:00" }],
    reportsSubmitted: [
      {
        id: "re000000-0000-4000-8000-000000000001",
        reporter_id: SELF,
        target_type: "post",
        target_id: "90000000-0000-4000-8000-000000000077",
        reason: "harassment",
        note: "\"><img src=x onerror=alert(1)>",
        created_at: "2026-09-20T10:00:00+00:00",
        handled_at: "2026-09-21T10:00:00+00:00",
        moderation_action_id: DECISION,
      },
    ],
    comments: [
      {
        id: "c0000000-0000-4000-8000-000000000001",
        post_id: FRIEND_POST,
        user_id: SELF,
        body: "</pre><script>alert(2)</script>",
        hidden_at: null,
        created_at: "2026-09-17T10:00:00+00:00",
      },
    ],
    notifications: [
      notification("n1", { type: "report_handled", actor_id: null, moderation_action_id: DECISION }),
      notification("n2", { type: "follow", actor_id: FRIEND }),
      notification("n3", { type: "piece_received", actor_id: BLOCKER, piece_send_id: RECEIVED }),
    ],
    affiliateClicks: [
      { id: "ac000000-0000-4000-8000-000000000001", affiliate_link_id: LINK, user_id: SELF, clicked_at: "2026-09-18T10:00:00+00:00", user_agent: CHROME_MAC, context: "result" },
    ],
    affiliateConversions: [],
    consents: [
      {
        id: "co000000-0000-4000-8000-000000000001",
        user_id: SELF,
        type: "terms",
        granted_at: "2026-09-01T08:00:00+00:00",
        revoked_at: null,
        created_at: "2026-09-01T08:00:00+00:00",
        document_version: "projet-2026-09-25",
      },
    ],
    dataExportRequests: [],
    piecesSent: [],
    piecesReceived: [
      {
        id: RECEIVED,
        sender_id: BLOCKER,
        recipient_id: SELF,
        title: "Pièce reçue",
        image_url: `${STORAGE}/storage/v1/object/public/post-media/${BLOCKER}/copie.jpg`,
        image_thumb_url: `${STORAGE}/storage/v1/object/public/post-media/${BLOCKER}/copie-mini.jpg`,
        merchant_name: null,
        merchant_url: null,
        product_match_id: null,
        price_min: null,
        currency: null,
        hidden_at: null,
        created_at: "2026-09-19T10:00:00+00:00",
      },
    ],
    adminRole: null,
    suspension: null,
    moderationDecisionsAboutMe: [],
    moderationDecisionsTaken: [],
  };
}

function match(id: string, rank: number, fields: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `${id}000000-0000-4000-8000-000000000001`,
    search_id: S_TIKTOK,
    rank,
    brand: null,
    image_url: GOOGLE_THUMB,
    confidence_score: null,
    merchant_name: "Boutique",
    merchant_url: "https://boutique.example/produit/1?utm_source=google&utm_medium=lens",
    created_at: "2026-09-09T23:10:30+00:00",
    image_hd_url: null,
    ...fields,
  };
}

function notification(id: string, fields: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `${id}000000-0000-4000-8000-000000000001`,
    user_id: SELF,
    post_id: null,
    read_at: null,
    created_at: "2026-09-22T10:00:00+00:00",
    comment_id: null,
    moderation_action_id: null,
    hidden_at: null,
    piece_send_id: null,
    ...fields,
  };
}

export function lookups(): ExportLookups {
  return {
    blockedMe: new Set([BLOCKER]),
    // Même si le nom d'un compte qui a bloqué la personne arrivait jusqu'ici,
    // le fichier ne doit pas l'écrire.
    people: new Map([
      [FRIEND, { username: "alexis", displayName: "Alexis Martin" }],
      [BLOCKER, { username: "bloqueur", displayName: "Nom Secret" }],
    ]),
    blockedByMe: new Map([[BLOCKED, { username: "importun", displayName: "Importun" }]]),
    postAuthors: new Map([
      [FRIEND_POST, FRIEND],
      [BLOCKER_POST, BLOCKER],
    ]),
    clickedPieces: new Map([[LINK, { productName: "Sac cabas", merchantName: "Boutique" }]]),
  };
}

