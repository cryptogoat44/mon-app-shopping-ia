import type { FastifyInstance } from "fastify";
import { chunks, readAll } from "./pagedReads.js";
import { messagesReady } from "./messaging.js";
import { collectionsReady } from "./collections.js";
import { collectionModerationReady } from "./collectionModeration.js";
import { pushReady } from "./push.js";
import { wishAlertsReady, wishAlertsSchemaState } from "./wishAlertsSchema.js";

// Export RGPD (droit d'accès et de portabilité) : lecture de TOUTES les
// données personnelles d'un compte. Toute nouvelle table contenant des
// données personnelles doit être ajoutée ici (règle 10 du programme) — le test
// tests/exportCompleteness.test.ts vérifie chaque section, et chaque colonne
// doit avoir son libellé dans lib/exportText.ts (sinon le fichier lisible
// l'affiche sous son nom brut). Si une seule lecture échoue, l'export entier
// échoue : un export partiel présenté comme complet serait pire qu'une erreur
// (audit Lot Q, SEC-01).
//
// Le JSON renvoyé garde exactement les clés et les lignes brutes d'avant
// (anciennes versions de l'app iPhone) ; seule la clé `account` s'ajoute.

export type ExportRow = Record<string, unknown>;

export interface ExportData {
  exportedAt: string;
  /** Données du compte qui ne sont pas dans le profil (Supabase Auth). */
  account: { email: string | null };
  profile: ExportRow | null;
  productSearches: ExportRow[];
  productMatches: ExportRow[];
  vaultItems: ExportRow[];
  wishlistItems: ExportRow[];
  posts: ExportRow[];
  postTaggedPieces: ExportRow[];
  reactionsGiven: ExportRow[];
  followers: ExportRow[];
  following: ExportRow[];
  blockedAccounts: ExportRow[];
  reportsSubmitted: ExportRow[];
  comments: ExportRow[];
  notifications: ExportRow[];
  affiliateClicks: ExportRow[];
  affiliateConversions: ExportRow[];
  consents: ExportRow[];
  dataExportRequests: ExportRow[];
  piecesSent: ExportRow[];
  piecesReceived: ExportRow[];
  adminRole: ExportRow | null;
  suspension: ExportRow | null;
  moderationDecisionsAboutMe: ExportRow[];
  moderationDecisionsTaken: ExportRow[];
  /** Bouton « Résultat incohérent » (migration 0025) : propositions signalées et motif. */
  resultFeedback: ExportRow[];
  /** Messages privés (lot messages, migration 0032) : son côté de chaque
   * conversation, avec le nom d'utilisateur de l'autre membre (null pour un
   * compte en relation de blocage avec la personne)… */
  conversations: ExportRow[];
  /** … et tous les messages de ces conversations, envoyés et reçus. */
  messages: ExportRow[];
  /** Collections d'envies (lot collections, migration 0033) : nom et
   * visibilité (vous seul, ou vos amis)… */
  collections: ExportRow[];
  /** … et les envies rangées dans chacune (identifiant et titre de l'envie,
   * adresses de la copie de son image montrée aux amis, s'il y en a une). */
  collectionItems: ExportRow[];
  /** Appareils qui reçoivent les notifications des nouveaux messages (lot
   * notifications, migration 0035) : le système et les dates seulement,
   * jamais le jeton de l'appareil. */
  pushDevices: ExportRow[];
  /** Alertes prix et stock (lot 2, migration 0036) : la cloche de vos envies… */
  wishWatches: ExportRow[];
  /** … le suivi de vos envies (prix de référence, dernier prix vu, stock,
   * dates au jour près ; jamais d'où vient une observation, ni la clé de la pièce)… */
  wishTracking: ExportRow[];
  /** … vos alertes (au jour près)… */
  wishAlertEvents: ExportRow[];
  /** … et vos signalements « Plus disponible » (au jour près). */
  stockReports: ExportRow[];
}

/** Sections de l'export (toutes les clés sauf la date de l'export). */
export type ExportDataKey = Exclude<keyof ExportData, "exportedAt">;

/** Colonnes lues pour les décisions de modération : jamais admin_id (le nom
 * de l'administrateur n'est jamais transmis à la personne concernée). */
export const MODERATION_EXPORT_COLUMNS = "id, action, target_type, target_id, reason, note, undoes_action_id, created_at";

type Db = FastifyInstance["supabaseAdmin"];

/** Toutes les lignes d'une table pour `column = value`, page après page.
 * `orderBy` : un ordre total et stable — la date, puis la clé primaire
 * (unique), pour que le JSON reste chronologique. */
function listWhere(db: Db, table: string, columns: string, column: string, value: string, orderBy: readonly string[]): Promise<ExportRow[]> {
  return readAll<ExportRow>(table, () => db.from(table).select(columns, { count: "exact" }).eq(column, value), orderBy);
}

/** Même lecture pour une liste d'identifiants, découpée en paquets (longueur
 * de l'adresse), puis remise dans l'ordre demandé. */
export async function listIn(db: Db, table: string, columns: string, column: string, ids: readonly string[], orderBy: readonly string[]): Promise<ExportRow[]> {
  const rows: ExportRow[] = [];
  for (const part of chunks([...new Set(ids)])) {
    rows.push(...(await readAll<ExportRow>(table, () => db.from(table).select(columns, { count: "exact" }).in(column, part), orderBy)));
  }
  return rows.sort((a, b) => compareRows(a, b, orderBy));
}

function compareRows(a: ExportRow, b: ExportRow, orderBy: readonly string[]): number {
  for (const column of orderBy) {
    const x = a[column];
    const y = b[column];
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    // Dates ISO renvoyées par la base (même fuseau, +00:00) et identifiants :
    // l'ordre du texte suffit.
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

const BY_DATE = ["created_at", "id"] as const;

/** Colonnes d'une collection (lot collections) ; avec la migration 0034, la
 * date de son masquage par la modération. */
export const COLLECTION_EXPORT_COLUMNS = "id, name, visibility, visibility_changed_at, created_at, updated_at";
export const COLLECTION_EXPORT_COLUMNS_MODERATED = `${COLLECTION_EXPORT_COLUMNS}, hidden_at`;

/** Les envies rangées dans ses collections, avec le titre de chaque envie et
 * la copie de son image montrée aux amis (une par envie), s'il y en a une ;
 * avec la migration 0034, la date à laquelle la modération l'a retirée. */
async function listCollectionItems(db: Db, userId: string, wishlistItems: readonly ExportRow[], moderated: boolean): Promise<ExportRow[]> {
  const copyColumns = `wishlist_item_id, image_url, image_thumb_url, created_at${moderated ? ", image_removed_at" : ""}`;
  const [items, copies] = await Promise.all([
    listWhere(db, "collection_items", "id, collection_id, wishlist_item_id, created_at", "user_id", userId, BY_DATE),
    listWhere(db, "collection_image_copies", copyColumns, "user_id", userId, ["created_at", "wishlist_item_id"]),
  ]);
  const titles = new Map(wishlistItems.map((row) => [String(row.id), typeof row.title === "string" ? row.title : null]));
  const copyByWish = new Map(copies.map((row) => [String(row.wishlist_item_id), row]));
  return items.map((row) => {
    const copy = copyByWish.get(String(row.wishlist_item_id));
    return {
      ...row,
      wishlist_item_title: titles.get(String(row.wishlist_item_id)) ?? null,
      friends_image_url: copy?.image_url ?? null,
      friends_image_thumb_url: copy?.image_thumb_url ?? null,
      ...(moderated ? { friends_image_removed_at: copy?.image_removed_at ?? null } : {}),
    };
  });
}

/** Colonnes d'un appareil des notifications : jamais `token` (l'adresse
 * technique de l'appareil chez Apple et Expo), ni `last_error`. Avec la
 * migration 0036, s'il reçoit aussi les notifications des messages. */
export const PUSH_DEVICE_EXPORT_COLUMNS = "platform, created_at, updated_at";
export const PUSH_DEVICE_EXPORT_COLUMNS_ALERTS = "platform, notify_messages, notify_alerts, created_at, updated_at";

// Alertes prix et stock (lot 2, migration 0036). Jamais : la clé de la pièce
// (empreinte), le pays d'une observation, ni une heure précise venue d'une
// observation — seulement des jours. Le suivi et les alertes sont montrés tels
// qu'ils sont (le stock et les alertes vont vite, c'est le but), jamais qui a
// cherché, acheté ou signalé la pièce : la base ne le garde nulle part.
export const WISH_WATCH_EXPORT_COLUMNS = "wishlist_item_id, notify_price_drop, notify_restock, notify_sold_out, created_at, updated_at";
export const WISH_TRACKING_EXPORT_COLUMNS = "wishlist_item_id, ref_price, ref_currency, ref_set_on, last_price, last_currency, last_seen_on, stock_state, stock_on";
/** Avec les garde-fous des alertes (migration 0040) : le pays gardé pour vos
 * prix, l'origine d'un « épuisée » et le jour d'un achat sont exportés aussi. */
export const WISH_TRACKING_EXPORT_COLUMNS_GUARDED = `${WISH_TRACKING_EXPORT_COLUMNS}, member_country, sold_out_source, bought_on`;
export const WISH_ALERT_EVENT_EXPORT_COLUMNS = "id, wishlist_item_id, kind, old_price, new_price, currency, status, created_on";
export const STOCK_REPORT_EXPORT_COLUMNS = "id, match_key_hash, created_on";

/** Ajoute le titre de l'envie à chaque ligne (lisible sans l'identifiant). */
function withWishTitles(rows: readonly ExportRow[], wishlistItems: readonly ExportRow[]): ExportRow[] {
  const titles = new Map(wishlistItems.map((row) => [String(row.id), typeof row.title === "string" ? row.title : null]));
  return rows.map((row) => ({ ...row, wishlist_item_title: titles.get(String(row.wishlist_item_id)) ?? null }));
}

/** Colonnes de son côté d'une conversation (jamais celui de l'autre membre :
 * il dirait, par exemple, qu'il a refusé une invitation). */
export const CONVERSATION_EXPORT_COLUMNS =
  "conversation_id, other_user_id, invitation, invitation_at, unread, last_read_at, cleared_at, last_message_at, created_at";

/** Son côté de chaque conversation, avec le nom d'utilisateur de l'autre
 * membre — jamais celui d'un compte en relation de blocage avec la personne
 * (règle 8, comme dans le reste de l'export). */
async function listConversations(db: Db, userId: string): Promise<ExportRow[]> {
  const rows = await listWhere(db, "conversation_participants", CONVERSATION_EXPORT_COLUMNS, "user_id", userId, ["created_at", "conversation_id"]);
  if (rows.length === 0) return rows;
  const [blockedByMe, blockingMe, profiles] = await Promise.all([
    listWhere(db, "blocks", "blocked_id", "blocker_id", userId, ["blocked_id"]),
    listWhere(db, "blocks", "blocker_id", "blocked_id", userId, ["blocker_id"]),
    listIn(db, "profiles", "id, username", "id", rows.map((row) => String(row.other_user_id)), ["id"]),
  ]);
  const blocked = new Set([...blockedByMe.map((row) => String(row.blocked_id)), ...blockingMe.map((row) => String(row.blocker_id))]);
  const usernames = new Map(profiles.map((row) => [String(row.id), typeof row.username === "string" ? row.username : null]));
  return rows.map((row) => {
    const other = String(row.other_user_id);
    return { ...row, other_username: blocked.has(other) ? null : (usernames.get(other) ?? null) };
  });
}

export async function collectExport(
  fastify: FastifyInstance,
  userId: string,
  email: string | null
): Promise<{ data: ExportData; failures: string[] }> {
  const db = fastify.supabaseAdmin;
  const failures: string[] = [];
  // Une lecture en échec est notée (par son nom de section, jamais une
  // valeur) : l'export entier échouera.
  async function section<T>(name: string, read: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await read();
    } catch {
      failures.push(name);
      return fallback;
    }
  }
  const none: ExportRow[] = [];

  // Tables sans user_id direct (product_matches, post_tagged_pieces,
  // affiliate_conversions) : on récupère d'abord les lignes parentes de
  // l'utilisateur, puis leurs enfants par identifiant — plus simple et
  // plus sûr qu'un filtre sur une ressource jointe.
  // Lot messages : sans la migration 0032, aucune conversation (sections vides).
  const withMessages = await messagesReady(fastify);
  // Lot collections : sans la migration 0033, aucune collection (sections vides).
  const withCollections = await collectionsReady(fastify);
  // Lot modération des collections : sans la migration 0034, ni masquage ni image retirée.
  const moderatedCollections = withCollections && (await collectionModerationReady(fastify));
  const [productSearches, posts, affiliateClicks, conversations] = await Promise.all([
    section("productSearches", () => listWhere(db, "product_searches", "*", "user_id", userId, BY_DATE), none),
    section("posts", () => listWhere(db, "posts", "*", "user_id", userId, BY_DATE), none),
    section("affiliateClicks", () => listWhere(db, "affiliate_clicks", "*", "user_id", userId, ["clicked_at", "id"]), none),
    section("conversations", () => (withMessages ? listConversations(db, userId) : Promise.resolve(none)), none),
  ]);
  const searchIds = productSearches.map((s) => s.id as string);
  const postIds = posts.map((p) => p.id as string);
  const clickIds = affiliateClicks.map((c) => c.id as string);
  const conversationIds = conversations.map((c) => c.conversation_id as string);

  const [
    profile,
    productMatches,
    postTaggedPieces,
    affiliateConversions,
    vaultItems,
    wishlistItems,
    followers,
    following,
    reactionsGiven,
    notifications,
    blockedAccounts,
    reportsSubmitted,
    comments,
    consents,
    dataExportRequests,
    piecesSent,
    piecesReceived,
    adminRole,
    suspension,
    moderationDecisionsAboutMe,
    moderationDecisionsTaken,
    resultFeedback,
    messages,
    collections,
  ] = await Promise.all([
    section(
      "profile",
      async () => {
        const { data, error } = await db.from("profiles").select("*").eq("id", userId).maybeSingle();
        if (error) throw error;
        return (data as ExportRow | null) ?? null;
      },
      null
    ),
    section("productMatches", () => listIn(db, "product_matches", "*", "search_id", searchIds, ["created_at", "rank", "id"]), none),
    section("postTaggedPieces", () => listIn(db, "post_tagged_pieces", "*", "post_id", postIds, BY_DATE), none),
    section("affiliateConversions", () => listIn(db, "affiliate_conversions", "*", "affiliate_click_id", clickIds, BY_DATE), none),
    section("vaultItems", () => listWhere(db, "vault_items", "*", "user_id", userId, BY_DATE), none),
    section("wishlistItems", () => listWhere(db, "wishlist_items", "*", "user_id", userId, BY_DATE), none),
    // Clés primaires composées : l'autre colonne de la clé départage.
    section("followers", () => listWhere(db, "follows", "follower_id, created_at", "followee_id", userId, ["created_at", "follower_id"]), none),
    section("following", () => listWhere(db, "follows", "followee_id, created_at", "follower_id", userId, ["created_at", "followee_id"]), none),
    section("reactionsGiven", () => listWhere(db, "post_reactions", "post_id, created_at", "user_id", userId, ["created_at", "post_id"]), none),
    section("notifications", () => listWhere(db, "notifications", "*", "user_id", userId, BY_DATE), none),
    section("blockedAccounts", () => listWhere(db, "blocks", "blocked_id, created_at", "blocker_id", userId, ["created_at", "blocked_id"]), none),
    section("reportsSubmitted", () => listWhere(db, "reports", "*", "reporter_id", userId, BY_DATE), none),
    section("comments", () => listWhere(db, "comments", "*", "user_id", userId, BY_DATE), none),
    section("consents", () => listWhere(db, "consents", "*", "user_id", userId, BY_DATE), none),
    section("dataExportRequests", () => listWhere(db, "data_export_requests", "*", "user_id", userId, ["requested_at", "id"]), none),
    // Lot 5 : pièces envoyées et reçues (instantané de l'envie et adresse de la copie de son image).
    section("piecesSent", () => listWhere(db, "piece_sends", "*", "sender_id", userId, BY_DATE), none),
    section("piecesReceived", () => listWhere(db, "piece_sends", "*", "recipient_id", userId, BY_DATE), none),
    // Modération (lot 5) : rôle d'administrateur, suspension en vigueur,
    // décisions qui vous concernent (jamais le nom de l'administrateur) et,
    // pour un administrateur, celles qu'il a prises.
    section(
      "adminRole",
      async () => {
        const { data, error } = await db.from("admins").select("created_at").eq("user_id", userId).maybeSingle();
        if (error) throw error;
        return (data as ExportRow | null) ?? null;
      },
      null
    ),
    section(
      "suspension",
      async () => {
        const { data, error } = await db.from("suspensions").select("created_at, moderation_action_id").eq("user_id", userId).maybeSingle();
        if (error) throw error;
        return (data as ExportRow | null) ?? null;
      },
      null
    ),
    section("moderationDecisionsAboutMe", () => listWhere(db, "moderation_actions", MODERATION_EXPORT_COLUMNS, "target_user_id", userId, BY_DATE), none),
    section("moderationDecisionsTaken", () => listWhere(db, "moderation_actions", MODERATION_EXPORT_COLUMNS, "admin_id", userId, BY_DATE), none),
    section("resultFeedback", () => listWhere(db, "match_feedback", "*", "user_id", userId, BY_DATE), none),
    // Messages envoyés et reçus, masqués compris (comme les pièces).
    section("messages", () => listIn(db, "messages", "*", "conversation_id", conversationIds, BY_DATE), none),
    section(
      "collections",
      () =>
        withCollections
          ? listWhere(db, "collections", moderatedCollections ? COLLECTION_EXPORT_COLUMNS_MODERATED : COLLECTION_EXPORT_COLUMNS, "user_id", userId, BY_DATE)
          : Promise.resolve(none),
      none
    ),
  ]);
  const collectionItems = await section("collectionItems", () => (withCollections ? listCollectionItems(db, userId, wishlistItems, moderatedCollections) : Promise.resolve(none)), none);
  // Lot notifications : sans la migration 0035, aucun appareil (section vide).
  // Triés par date, puis par jeton (ordre stable), sans jamais le lire.
  // Lot alertes prix : sans la migration 0036, sections vides. Avec 0036 sans
  // ses garde-fous (0040), les alertes sont coupées mais leurs données sont
  // là : elles sont exportées quand même.
  const withAlerts = (await wishAlertsSchemaState(fastify)) === "ready";
  const trackingColumns = withAlerts && (await wishAlertsReady(fastify)) ? WISH_TRACKING_EXPORT_COLUMNS_GUARDED : WISH_TRACKING_EXPORT_COLUMNS;
  const pushDevices = await section(
    "pushDevices",
    async () =>
      (await pushReady(fastify))
        ? listWhere(db, "push_tokens", withAlerts ? PUSH_DEVICE_EXPORT_COLUMNS_ALERTS : PUSH_DEVICE_EXPORT_COLUMNS, "user_id", userId, ["created_at", "token"])
        : none,
    none
  );
  const [wishWatches, wishTracking, wishAlertEvents, stockReports] = await Promise.all([
    section(
      "wishWatches",
      async () => (withAlerts ? withWishTitles(await listWhere(db, "wish_watches", WISH_WATCH_EXPORT_COLUMNS, "user_id", userId, ["created_at", "wishlist_item_id"]), wishlistItems) : none),
      none
    ),
    section(
      "wishTracking",
      async () => (withAlerts ? withWishTitles(await listWhere(db, "wish_tracking", trackingColumns, "user_id", userId, ["wishlist_item_id"]), wishlistItems) : none),
      none
    ),
    section(
      "wishAlertEvents",
      async () => (withAlerts ? withWishTitles(await listWhere(db, "wish_alert_events", WISH_ALERT_EVENT_EXPORT_COLUMNS, "user_id", userId, ["created_on", "id"]), wishlistItems) : none),
      none
    ),
    section("stockReports", () => (withAlerts ? listWhere(db, "stock_reports", STOCK_REPORT_EXPORT_COLUMNS, "user_id", userId, ["created_on", "id"]) : Promise.resolve(none)), none),
  ]);

  const data: ExportData = {
    exportedAt: new Date().toISOString(),
    account: { email },
    profile,
    productSearches,
    productMatches,
    vaultItems,
    wishlistItems,
    posts,
    postTaggedPieces,
    reactionsGiven,
    followers,
    following,
    blockedAccounts,
    reportsSubmitted,
    comments,
    notifications,
    affiliateClicks,
    affiliateConversions,
    consents,
    dataExportRequests,
    piecesSent,
    piecesReceived,
    adminRole,
    suspension,
    moderationDecisionsAboutMe,
    moderationDecisionsTaken,
    resultFeedback,
    conversations,
    messages,
    collections,
    collectionItems,
    pushDevices,
    wishWatches,
    wishTracking,
    wishAlertEvents,
    stockReports,
  };
  return { data, failures };
}
