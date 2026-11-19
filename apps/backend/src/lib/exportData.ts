import type { FastifyInstance } from "fastify";
import { chunks, readAll } from "./pagedReads.js";
import { messageActionsReady, messagesReady } from "./messaging.js";
import { collectionsReady } from "./collections.js";
import { collectionModerationReady } from "./collectionModeration.js";
import { pushReady } from "./push.js";
import { wishAlertsSchemaState, wishAlertsSchemaVersion } from "./wishAlertsSchema.js";
import { tryonSchemaReady } from "./tryon/schema.js";
import { videoMemoryStored } from "./videoMemory.js";
import { privateAccountsReady } from "./audience.js";
import { commentThreadsReady } from "./comments.js";
import { postExtrasReady } from "./postExtras.js";
import { savedPostsReady } from "./savedPosts.js";
import { postVisibleTo, readAudience, type Audience } from "./audience.js";

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
  /** Essayage virtuel (lot « essayage virtuel », migration 0042) : statut
   * d'âge (jamais la date de naissance) et consentement… */
  tryonProfile: ExportRow | null;
  /** … les essais (jamais une image : la pièce, le résultat, la source du
   * quota, un code d'échec, la durée, les dates)… */
  tryonEvents: ExportRow[];
  /** … les essais offerts (commande, quantité, reste, expiration)… */
  tryonBonusGrants: ExportRow[];
  /** … et les signalements d'un résultat (motif, précision). */
  tryonReports: ExportRow[];
  /** Mémoire collective des vidéos (migrations 0038 et 0039) : vos spots — la
   * vidéo (adresse publique), d'où venait l'image, le moment de la vidéo, la
   * date et la recherche liée… */
  videoSpots: ExportRow[];
  /** … et vos « C'est bien cette pièce » : la vidéo, la pièce (son nom, sinon
   * sa clé « même page ») et la date. */
  videoConfirmations: ExportRow[];
  /** Messages, plus de confort (migration 0044) : vos « j'aime » sur des
   * messages — la date, la conversation et l'autre membre (son identifiant ;
   * le fichier lisible ne nomme jamais un compte en relation de blocage). */
  messageReactions: ExportRow[];
  /** Compte privé (lot « vie sociale », migration 0045) : vos demandes
   * d'abonnement en attente (à qui, depuis quand)… */
  followRequestsSent: ExportRow[];
  /** … et celles que vous avez reçues et pas encore traitées. Jamais une
   * demande d'un compte en blocage avec vous. Un refus ne laisse rien. */
  followRequestsReceived: ExportRow[];
  /** Commentaires, suite (lot « vie sociale », migration 0046) : les
   * commentaires que vous avez aimés (lequel, quand)… */
  commentReactionsGiven: ExportRow[];
  /** … les mentions « @pseudo » de vous dans les commentaires des autres
   * (par qui, dans quel commentaire, quand)… */
  mentionsReceived: ExportRow[];
  /** … et celles que vous avez écrites. Jamais une mention liée à un compte
   * en blocage avec vous (un blocage les efface). */
  mentionsMade: ExportRow[];
  /** Plusieurs photos, identifier des personnes (lot « vie sociale »,
   * migration 0047) : les photos 2 à 5 de vos publications (adresses de la
   * photo et de sa miniature, place, date)… */
  postMedia: ExportRow[];
  /** … les membres que vous avez identifiés sur vos publications (qui, sur
   * laquelle, quand)… */
  peopleTagsMade: ExportRow[];
  /** … et les publications des autres où vous êtes identifié(e) (par qui,
   * quand, et si vous pouvez encore la voir). Jamais une identification liée
   * à un compte en blocage avec vous (un blocage les efface). */
  peopleTagsReceived: ExportRow[];
  /** Publications enregistrées (lot « vie sociale », migration 0048) : la
   * date, la collection où vous l'avez rangée (son nom), et l'auteur
   * seulement si vous pouvez encore voir la publication (`post_available`) ;
   * sinon ni auteur ni lien (« publication indisponible »), jamais le nom
   * d'un compte en blocage avec vous. Rien de la publication elle-même. */
  savedPosts: ExportRow[];
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
/** Nouvelle version des alertes (migration 0041) : le seuil de chaque cloche
 * (et s'il est franchi), le suivi sans prix de référence (retiré), le JOUR
 * d'envoi de chaque alerte (aucune heure n'est gardée), et, pour chaque
 * signalement « Plus disponible », le pays de sa recherche, s'il aidait les
 * autres membres et s'il fait encore partie de la série en cours. Jamais
 * d'où vient une alerte. */
export const WISH_WATCH_EXPORT_COLUMNS_V2 = `${WISH_WATCH_EXPORT_COLUMNS}, target_price, target_currency, target_country, below_target`;
export const WISH_TRACKING_EXPORT_COLUMNS_V2 = "wishlist_item_id, last_price, last_currency, last_seen_on, stock_state, stock_on, member_country, sold_out_source, bought_on";
export const WISH_ALERT_EVENT_EXPORT_COLUMNS_V2 = `${WISH_ALERT_EVENT_EXPORT_COLUMNS}, sent_on`;
export const STOCK_REPORT_EXPORT_COLUMNS_V2 = `${STOCK_REPORT_EXPORT_COLUMNS}, country, helps_others, in_streak`;

/** Les colonnes exportées des alertes selon la version de la base (1 : 0036,
 * 2 : 0040, 3 : 0041). */
export function alertExportColumns(version: number): { watches: string; tracking: string; events: string; reports: string } {
  if (version >= 3) {
    return { watches: WISH_WATCH_EXPORT_COLUMNS_V2, tracking: WISH_TRACKING_EXPORT_COLUMNS_V2, events: WISH_ALERT_EVENT_EXPORT_COLUMNS_V2, reports: STOCK_REPORT_EXPORT_COLUMNS_V2 };
  }
  return {
    watches: WISH_WATCH_EXPORT_COLUMNS,
    tracking: version >= 2 ? WISH_TRACKING_EXPORT_COLUMNS_GUARDED : WISH_TRACKING_EXPORT_COLUMNS,
    events: WISH_ALERT_EVENT_EXPORT_COLUMNS,
    reports: STOCK_REPORT_EXPORT_COLUMNS,
  };
}

// Essayage virtuel (migration 0042). Aucune image n'existe dans la base :
// ni la photo du membre, ni l'image produite (jamais gardées).
export const TRYON_PROFILE_EXPORT_COLUMNS = "age_status, age_checked_at, consent_version, consent_accepted_at, consent_withdrawn_at";
export const TRYON_EVENT_EXPORT_COLUMNS = "id, item_id, status, credits_used, quota_source, bonus_grant_id, error_code, duration_ms, month, created_at, finished_at";
export const TRYON_BONUS_GRANT_EXPORT_COLUMNS = "id, order_ref, quantity, remaining, expires_at, created_at";
export const TRYON_REPORT_EXPORT_COLUMNS = "id, item_id, reason, comment, created_at";

/** Ajoute le titre de l'envie à chaque ligne (lisible sans l'identifiant). */
function withWishTitles(rows: readonly ExportRow[], wishlistItems: readonly ExportRow[]): ExportRow[] {
  const titles = new Map(wishlistItems.map((row) => [String(row.id), typeof row.title === "string" ? row.title : null]));
  return rows.map((row) => ({ ...row, wishlist_item_title: titles.get(String(row.wishlist_item_id)) ?? null }));
}

/** Adresse publique de chaque vidéo (mémoire des vidéos), par identifiant. */
async function videoUrls(db: Db, sourceIds: readonly string[]): Promise<Map<string, string | null>> {
  const rows = await listIn(db, "video_sources", "id, canonical_url", "id", sourceIds, ["id"]);
  return new Map(rows.map((row) => [String(row.id), typeof row.canonical_url === "string" ? row.canonical_url : null]));
}

/** Ses spots : la vidéo, d'où venait l'image, le moment, la date, la recherche liée. */
async function listVideoSpots(db: Db, userId: string): Promise<ExportRow[]> {
  const rows = await listWhere(db, "video_spots", "id, video_source_id, source, moment_seconds, created_at, search_id", "user_id", userId, BY_DATE);
  if (rows.length === 0) return rows;
  const urls = await videoUrls(
    db,
    rows.map((row) => String(row.video_source_id))
  );
  return rows.map((row) => ({
    canonical_url: urls.get(String(row.video_source_id)) ?? null,
    source: row.source,
    moment_seconds: row.moment_seconds,
    created_at: row.created_at,
    search_id: row.search_id,
  }));
}

/** Ses « C'est bien cette pièce » : la vidéo, la pièce (le nom d'un résultat
 * rattaché à cette vidéo avec la même clé, sinon la clé elle-même), la date. */
async function listVideoConfirmations(db: Db, userId: string): Promise<ExportRow[]> {
  const rows = await listWhere(db, "video_item_confirmations", "video_source_id, product_key, created_at", "user_id", userId, ["created_at", "video_source_id", "product_key"]);
  if (rows.length === 0) return rows;
  const sourceIds = rows.map((row) => String(row.video_source_id));
  const [urls, items] = await Promise.all([
    videoUrls(db, sourceIds),
    listIn(db, "video_spot_items", "video_source_id, product_key, product_match_id", "video_source_id", sourceIds, ["video_source_id", "product_key", "product_match_id"]),
  ]);
  const pieceOf = (row: ExportRow) => `${String(row.video_source_id)}:${String(row.product_key)}`;
  const wanted = new Set(rows.map(pieceOf));
  const matchOf = new Map<string, string>();
  for (const item of items) {
    const piece = pieceOf(item);
    if (wanted.has(piece) && !matchOf.has(piece)) matchOf.set(piece, String(item.product_match_id));
  }
  const names = new Map(
    (await listIn(db, "product_matches", "id, product_name", "id", [...matchOf.values()], ["id"])).map((row) => [String(row.id), typeof row.product_name === "string" ? row.product_name : null])
  );
  return rows.map((row) => ({
    canonical_url: urls.get(String(row.video_source_id)) ?? null,
    product: names.get(matchOf.get(pieceOf(row)) ?? "") ?? row.product_key,
    created_at: row.created_at,
  }));
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

/** Colonnes qui portent le contenu d'un message (texte et envie jointe). */
const MESSAGE_CONTENT_COLUMNS = [
  "body",
  "wish_title",
  "wish_image_url",
  "wish_image_thumb_url",
  "wish_merchant_name",
  "wish_merchant_url",
  "wish_product_match_id",
  "wish_price_min",
  "wish_currency",
  "reply_to_id",
] as const;

/** Les messages tels que `userId` a le droit de les recevoir dans son export
 * (lot « messages, plus de confort », migration 0044) :
 * - un message supprimé par l'AUTRE membre n'y garde jamais son contenu,
 *   même quand la base l'a conservé pour la modération (il avait été signalé
 *   avant) : conservé pour elle, pas pour la personne qui l'a reçu. La
 *   personne qui l'a écrit, elle, le retrouve dans son propre export ;
 * - une publication reçue n'y est jamais désignée (identifiant vidé) : elle
 *   n'est montrée qu'à qui a le droit de la voir, au moment où il regarde.
 * Une base sans 0044 n'a pas ces colonnes : rien ne change. */
export function messagesForExport(rows: ExportRow[], userId: string): ExportRow[] {
  return rows.map((row) => {
    if (row.sender_id === userId) return row;
    const received: ExportRow = typeof row.post_id === "string" ? { ...row, post_id: null } : row;
    if (typeof received.deleted_at !== "string") return received;
    const blanked: ExportRow = { ...received };
    for (const column of MESSAGE_CONTENT_COLUMNS) if (column in blanked) blanked[column] = null;
    if ("shared_post" in blanked) blanked.shared_post = false;
    return blanked;
  });
}

/** Vos « j'aime » sur des messages, avec la conversation et l'autre membre
 * (retrouvés dans ce que l'export contient déjà : aucune lecture de plus). */
async function listMessageReactions(db: Db, userId: string, messages: ExportRow[], conversations: ExportRow[]): Promise<ExportRow[]> {
  const rows = await listWhere(db, "message_reactions", "message_id, created_at", "user_id", userId, ["created_at", "message_id"]);
  const conversationOf = new Map(messages.map((row) => [String(row.id), String(row.conversation_id)]));
  const otherOf = new Map(conversations.map((row) => [String(row.conversation_id), row.other_user_id]));
  return rows.map((row) => {
    const conversationId = conversationOf.get(String(row.message_id)) ?? null;
    return { message_id: row.message_id, conversation_id: conversationId, other_user_id: (conversationId ? otherOf.get(conversationId) : null) ?? null, created_at: row.created_at };
  });
}

/** Demandes d'abonnement en attente de la personne : envoyées (`mine` =
 * requester_id) ou reçues (`mine` = target_id), avec l'autre compte et la
 * date. Jamais celle d'un compte en relation de blocage avec elle (un
 * blocage efface les demandes ; filtré quand même, règle 8). */
async function listFollowRequests(db: Db, userId: string, mine: "requester_id" | "target_id", other: "requester_id" | "target_id"): Promise<ExportRow[]> {
  const rows = await listWhere(db, "follow_requests", `${other}, created_at`, mine, userId, ["created_at", other]);
  if (rows.length === 0) return rows;
  const [blockedByMe, blockingMe] = await Promise.all([
    listWhere(db, "blocks", "blocked_id", "blocker_id", userId, ["blocked_id"]),
    listWhere(db, "blocks", "blocker_id", "blocked_id", userId, ["blocker_id"]),
  ]);
  const blocked = new Set([...blockedByMe.map((row) => String(row.blocked_id)), ...blockingMe.map((row) => String(row.blocker_id))]);
  return rows.filter((row) => !blocked.has(String(row[other])));
}

/** Mentions « @pseudo » de la personne : reçues (`mine` = user_id, l'autre
 * compte est l'auteur du commentaire) ou écrites (`mine` = author_id, l'autre
 * compte est le membre mentionné). Jamais celle d'un compte en relation de
 * blocage avec elle (un blocage efface les mentions ; filtré quand même, règle 8). */
async function listMentions(db: Db, userId: string, mine: "user_id" | "author_id", other: "user_id" | "author_id"): Promise<ExportRow[]> {
  const rows = await listWhere(db, "comment_mentions", `comment_id, ${other}, handle, created_at`, mine, userId, ["created_at", "comment_id", other]);
  if (rows.length === 0) return rows;
  const [blockedByMe, blockingMe] = await Promise.all([
    listWhere(db, "blocks", "blocked_id", "blocker_id", userId, ["blocked_id"]),
    listWhere(db, "blocks", "blocker_id", "blocked_id", userId, ["blocker_id"]),
  ]);
  const blocked = new Set([...blockedByMe.map((row) => String(row.blocked_id)), ...blockingMe.map((row) => String(row.blocker_id))]);
  return rows.filter((row) => !blocked.has(String(row[other])));
}

/** Comptes en blocage avec la personne, dans un sens ou dans l'autre. */
async function blockedEitherWay(db: Db, userId: string): Promise<Set<string>> {
  const [blockedByMe, blockingMe] = await Promise.all([
    listWhere(db, "blocks", "blocked_id", "blocker_id", userId, ["blocked_id"]),
    listWhere(db, "blocks", "blocker_id", "blocked_id", userId, ["blocker_id"]),
  ]);
  return new Set([...blockedByMe.map((row) => String(row.blocked_id)), ...blockingMe.map((row) => String(row.blocker_id))]);
}

/** Les membres identifiés sur ses publications (migration 0047). Jamais un
 * compte en relation de blocage avec la personne (un blocage les efface ;
 * filtré quand même, règle 8). */
async function listPeopleTagsMade(db: Db, userId: string): Promise<ExportRow[]> {
  const rows = await listWhere(db, "post_people_tags", "post_id, user_id, created_at", "author_id", userId, ["created_at", "post_id", "user_id"]);
  if (rows.length === 0) return rows;
  const blocked = await blockedEitherWay(db, userId);
  return rows.filter((row) => !blocked.has(String(row.user_id)));
}

/** Les publications des autres où elle est identifiée (migration 0047), avec
 * l'auteur et `post_available` : peut-elle encore la voir (ni masquée, ni
 * hors de sa visibilité, ni d'un compte privé qu'elle ne suit pas) ? Le
 * fichier lisible écrit sinon « publication indisponible ». Jamais un compte
 * en relation de blocage avec elle (règle 8). */
async function listPeopleTagsReceived(fastify: FastifyInstance, userId: string): Promise<ExportRow[]> {
  const db = fastify.supabaseAdmin;
  const rows = await listWhere(db, "post_people_tags", "post_id, author_id, created_at", "user_id", userId, ["created_at", "post_id", "author_id"]);
  if (rows.length === 0) return rows;
  const blocked = await blockedEitherWay(db, userId);
  const kept = rows.filter((row) => !blocked.has(String(row.author_id)));
  const posts = new Map(
    (await listIn(db, "posts", "id, user_id, privacy, hidden_at", "id", kept.map((row) => String(row.post_id)), ["id"])).map((row) => [String(row.id), row])
  );
  const audiences = new Map<string, Audience>();
  for (const part of chunks([...new Set(kept.map((row) => String(row.author_id)))])) {
    for (const [id, audience] of await readAudience(fastify, userId, part, { suspended: false, requested: false })) audiences.set(id, audience);
  }
  return kept.map((row) => {
    const post = posts.get(String(row.post_id));
    const audience = audiences.get(String(row.author_id));
    const privacy = post?.privacy;
    const available =
      post !== undefined && post.hidden_at == null && audience !== undefined && (privacy === "public" || privacy === "followers" || privacy === "private") && postVisibleTo(audience, privacy);
    return { ...row, post_available: available };
  });
}

/** Ses publications enregistrées (migration 0048), avec le nom de la
 * collection (la sienne) et `post_available` : peut-il encore voir la
 * publication (ni masquée, ni hors de sa visibilité, ni d'un compte privé
 * qu'il ne suit pas, ni d'un compte en blocage avec lui) ? L'auteur n'est
 * donné que dans ce cas ; sinon `author_id` est vide (le fichier lisible
 * écrit « une publication indisponible »). */
async function listSavedPosts(fastify: FastifyInstance, userId: string): Promise<ExportRow[]> {
  const db = fastify.supabaseAdmin;
  const rows = await listWhere(db, "saved_posts", "post_id, collection_id, created_at", "user_id", userId, ["created_at", "post_id"]);
  if (rows.length === 0) return rows;
  const collectionIds = [...new Set(rows.map((row) => row.collection_id).filter((id): id is string => typeof id === "string"))];
  const [posts, collections] = await Promise.all([
    listIn(db, "posts", "id, user_id, privacy, hidden_at", "id", rows.map((row) => String(row.post_id)), ["id"]),
    collectionIds.length > 0 ? listIn(db, "collections", "id, user_id, name", "id", collectionIds, ["id"]) : Promise.resolve([] as ExportRow[]),
  ]);
  const postById = new Map(posts.map((row) => [String(row.id), row]));
  // Seulement ses collections (la base le garantit ; relu quand même).
  const collectionName = new Map(collections.filter((row) => row.user_id === userId).map((row) => [String(row.id), row.name]));
  const audiences = new Map<string, Audience>();
  for (const part of chunks([...new Set(posts.map((row) => String(row.user_id)))])) {
    for (const [id, audience] of await readAudience(fastify, userId, part, { suspended: false, requested: false })) audiences.set(id, audience);
  }
  return rows.map((row) => {
    const post = postById.get(String(row.post_id));
    const audience = post ? audiences.get(String(post.user_id)) : undefined;
    const privacy = post?.privacy;
    const available =
      post !== undefined && post.hidden_at == null && audience !== undefined && (privacy === "public" || privacy === "followers" || privacy === "private") && postVisibleTo(audience, privacy);
    const collectionId = typeof row.collection_id === "string" ? row.collection_id : null;
    return {
      post_id: row.post_id,
      collection_id: collectionId,
      collection_name: collectionId !== null ? (collectionName.get(collectionId) ?? null) : null,
      author_id: available ? post.user_id : null,
      post_available: available,
      created_at: row.created_at,
    };
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
    // Messages envoyés et reçus, masqués compris (comme les pièces). Jamais
    // le contenu d'un message supprimé par l'autre membre (messagesForExport).
    section("messages", async () => messagesForExport(await listIn(db, "messages", "*", "conversation_id", conversationIds, BY_DATE), userId), none),
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
  const alertColumns = alertExportColumns(withAlerts ? await wishAlertsSchemaVersion(fastify) : 1);
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
      async () => (withAlerts ? withWishTitles(await listWhere(db, "wish_watches", alertColumns.watches, "user_id", userId, ["created_at", "wishlist_item_id"]), wishlistItems) : none),
      none
    ),
    section(
      "wishTracking",
      async () => (withAlerts ? withWishTitles(await listWhere(db, "wish_tracking", alertColumns.tracking, "user_id", userId, ["wishlist_item_id"]), wishlistItems) : none),
      none
    ),
    section(
      "wishAlertEvents",
      async () => (withAlerts ? withWishTitles(await listWhere(db, "wish_alert_events", alertColumns.events, "user_id", userId, ["created_on", "id"]), wishlistItems) : none),
      none
    ),
    section("stockReports", () => (withAlerts ? listWhere(db, "stock_reports", alertColumns.reports, "user_id", userId, ["created_on", "id"]) : Promise.resolve(none)), none),
  ]);
  // Essayage virtuel : sans la migration 0042, sections vides.
  const withTryon = await tryonSchemaReady(fastify);
  const [tryonProfile, tryonEvents, tryonBonusGrants, tryonReports] = await Promise.all([
    section(
      "tryonProfile",
      async () => {
        if (!withTryon) return null;
        const { data, error } = await db.from("tryon_profiles").select(TRYON_PROFILE_EXPORT_COLUMNS).eq("user_id", userId).maybeSingle();
        if (error) throw error;
        return (data as ExportRow | null) ?? null;
      },
      null
    ),
    section("tryonEvents", () => (withTryon ? listWhere(db, "tryon_events", TRYON_EVENT_EXPORT_COLUMNS, "user_id", userId, BY_DATE) : Promise.resolve(none)), none),
    section("tryonBonusGrants", () => (withTryon ? listWhere(db, "tryon_bonus_grants", TRYON_BONUS_GRANT_EXPORT_COLUMNS, "user_id", userId, BY_DATE) : Promise.resolve(none)), none),
    section("tryonReports", () => (withTryon ? listWhere(db, "tryon_reports", TRYON_REPORT_EXPORT_COLUMNS, "user_id", userId, BY_DATE) : Promise.resolve(none)), none),
  ]);

  // Mémoire des vidéos : lue dès que ses tables existent (0038), même si la
  // mémoire est coupée faute de 0039 : ce qui a été noté doit y figurer.
  const withVideoMemory = await videoMemoryStored(fastify);
  const [videoSpots, videoConfirmations] = await Promise.all([
    section("videoSpots", () => (withVideoMemory ? listVideoSpots(db, userId) : Promise.resolve(none)), none),
    section("videoConfirmations", () => (withVideoMemory ? listVideoConfirmations(db, userId) : Promise.resolve(none)), none),
  ]);

  // Messages, plus de confort : sans la migration 0044, section vide.
  const withMessageActions = withMessages && (await messageActionsReady(fastify));
  const messageReactions = await section("messageReactions", () => (withMessageActions ? listMessageReactions(db, userId, messages, conversations) : Promise.resolve(none)), none);

  // Compte privé : sans la migration 0045, aucune demande (sections vides).
  const withFollowRequests = await privateAccountsReady(fastify);
  const [followRequestsSent, followRequestsReceived] = await Promise.all([
    section("followRequestsSent", () => (withFollowRequests ? listFollowRequests(db, userId, "requester_id", "target_id") : Promise.resolve(none)), none),
    section("followRequestsReceived", () => (withFollowRequests ? listFollowRequests(db, userId, "target_id", "requester_id") : Promise.resolve(none)), none),
  ]);

  // Commentaires, suite : sans la migration 0046, sections vides.
  const withThreads = await commentThreadsReady(fastify);
  const [commentReactionsGiven, mentionsReceived, mentionsMade] = await Promise.all([
    section(
      "commentReactionsGiven",
      () => (withThreads ? listWhere(db, "comment_reactions", "comment_id, created_at", "user_id", userId, ["created_at", "comment_id"]) : Promise.resolve(none)),
      none
    ),
    section("mentionsReceived", () => (withThreads ? listMentions(db, userId, "user_id", "author_id") : Promise.resolve(none)), none),
    section("mentionsMade", () => (withThreads ? listMentions(db, userId, "author_id", "user_id") : Promise.resolve(none)), none),
  ]);

  // Plusieurs photos, identifications : sans la migration 0047, sections vides.
  const withPostExtras = await postExtrasReady(fastify);
  const [postMedia, peopleTagsMade, peopleTagsReceived] = await Promise.all([
    section(
      "postMedia",
      () => (withPostExtras ? listWhere(db, "post_media", "id, post_id, position, media_url, media_thumb_url, created_at", "user_id", userId, BY_DATE) : Promise.resolve(none)),
      none
    ),
    section("peopleTagsMade", () => (withPostExtras ? listPeopleTagsMade(db, userId) : Promise.resolve(none)), none),
    section("peopleTagsReceived", () => (withPostExtras ? listPeopleTagsReceived(fastify, userId) : Promise.resolve(none)), none),
  ]);

  // Publications enregistrées : sans la migration 0048, section vide.
  const withSavedPosts = await savedPostsReady(fastify);
  const savedPosts = await section("savedPosts", () => (withSavedPosts ? listSavedPosts(fastify, userId) : Promise.resolve(none)), none);

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
    tryonProfile,
    tryonEvents,
    tryonBonusGrants,
    tryonReports,
    videoSpots,
    videoConfirmations,
    messageReactions,
    followRequestsSent,
    followRequestsReceived,
    commentReactionsGiven,
    mentionsReceived,
    mentionsMade,
    postMedia,
    peopleTagsMade,
    peopleTagsReceived,
    savedPosts,
  };
  return { data, failures };
}
