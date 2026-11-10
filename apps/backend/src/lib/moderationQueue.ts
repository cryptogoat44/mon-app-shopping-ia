// File de modération (lot 5, section 5.B) : à partir des signalements
// regroupés par contenu (fonction moderation_queue, migration 0023), l'aperçu
// de chaque contenu, la décision en vigueur (à annuler) et l'historique des
// décisions. Visible des seuls administrateurs ; l'auteur d'un signalement
// n'y figure jamais. Tout ce qui vient de la base est relu avec zod.
// Lot 5, partie B : une image copiée peut avoir été retirée (« Image
// indisponible ») ; « Retirer l'image » n'est proposé que pour une copie.
// Lot messages : un message signalé est montré avec quelques messages
// autour (MODERATION_MESSAGE_CONTEXT avant et après), jamais toute la
// conversation.
// Lot modération des collections : une collection signalée est montrée avec
// son nom, son auteur et ses dernières envies (titre et copie de l'image,
// comme les amis les voient), chacune avec « Retirer l'image » si une copie
// est en place.
// Lot « conformité Apple » (migration 0037) : pour un profil signalé,
// « Retirer la bio » et « Retirer la photo de profil » sont proposés s'il en
// a une et si la base a la migration (sinon : jamais).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MODERATION_ACTION_TYPES,
  MODERATION_COLLECTION_PREVIEW_ITEMS,
  MODERATION_MESSAGE_CONTEXT,
  MODERATION_REASONS,
  PRIVACY_LEVELS,
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  type ModerationAuthor,
  type ModerationCollectionItem,
  type ModerationItem,
  type ModerationLogEntry,
  type ModerationMessageContext,
  type ModerationPreview,
} from "@monapp/shared-types";
import { COLLECTION_ROWS, ITEM_COLUMNS, ITEM_ROWS, isRemovedCopy, ownCopyUrl, readCopies, type CollectionRow } from "./collections.js";
import { DatabaseReadError, parseDbRows } from "./validation.js";

/** Décisions affichées par contenu (les plus récentes). */
const HISTORY_LIMIT = 10;
/** Garde-fou de lecture du journal pour une page de la file. */
const ACTIONS_READ_LIMIT = 1000;

const ID = z.string().uuid();
const TIMESTAMP = z.string().min(1);
const TARGET_TYPE = z.enum(REPORT_TARGET_TYPES);
const REASON = z.enum(REPORT_REASONS);

/** Lignes de moderation_queue. `last_at` sert de curseur : même format que celui accepté par la route. */
export const QUEUE_ROWS = z.array(
  z.object({
    target_type: TARGET_TYPE,
    target_id: ID,
    report_count: z.number().int().positive(),
    reasons: z.record(REASON, z.number().int().positive()),
    notes: z.array(z.string()),
    first_at: TIMESTAMP,
    last_at: z.string().datetime({ offset: true }),
  })
);
export type QueueRow = z.infer<typeof QUEUE_ROWS>[number];

const POST_ROWS = z.array(
  z.object({
    id: ID,
    user_id: ID,
    type: z.string(),
    caption: z.string().nullable(),
    media_url: z.string().nullable(),
    media_thumb_url: z.string().nullable(),
    media_removed_at: TIMESTAMP.nullable(),
    privacy: z.enum(PRIVACY_LEVELS),
    created_at: TIMESTAMP,
    hidden_at: TIMESTAMP.nullable(),
  })
);
const COMMENT_ROWS = z.array(
  z.object({ id: ID, user_id: ID, post_id: ID, body: z.string(), created_at: TIMESTAMP, hidden_at: TIMESTAMP.nullable() })
);
const PIECE_ROWS = z.array(
  z.object({
    id: ID,
    sender_id: ID,
    title: z.string(),
    image_url: z.string().nullable(),
    image_thumb_url: z.string().nullable(),
    image_removed_at: TIMESTAMP.nullable(),
    created_at: TIMESTAMP,
    hidden_at: TIMESTAMP.nullable(),
  })
);
const MESSAGE_ROWS = z.array(
  z.object({
    id: ID,
    conversation_id: ID,
    sender_id: ID,
    body: z.string().nullable(),
    wish_title: z.string().nullable(),
    created_at: TIMESTAMP,
    hidden_at: TIMESTAMP.nullable(),
  })
);
type MessageRow = z.infer<typeof MESSAGE_ROWS>[number];
const WISH_TITLE_ROWS = z.array(z.object({ id: ID, title: z.string() }));
const MESSAGE_COLUMNS = "id, conversation_id, sender_id, body, wish_title, created_at, hidden_at";
const PROFILE_ROWS = z.array(
  z.object({ id: ID, username: z.string().nullable(), display_name: z.string(), avatar_url: z.string().nullable(), bio: z.string().nullable() })
);
const SUSPENSION_ROWS = z.array(z.object({ user_id: ID, moderation_action_id: ID }));
const ACTION_ROWS = z.array(
  z.object({
    id: ID,
    admin_id: ID.nullable(),
    action: z.enum(MODERATION_ACTION_TYPES),
    target_type: TARGET_TYPE,
    target_id: ID,
    reason: z.enum(MODERATION_REASONS).nullable(),
    note: z.string().nullable(),
    undoes_action_id: ID.nullable(),
    created_at: TIMESTAMP,
    // Chantier 3 (migration 0030) : décision prise automatiquement, après
    // plusieurs signalements. Absente avant 0030 : jamais automatique.
    automatic: z.boolean().default(false),
  })
);
type ActionRow = z.infer<typeof ACTION_ROWS>[number];

interface Loaded {
  posts: Map<string, z.infer<typeof POST_ROWS>[number]>;
  comments: Map<string, z.infer<typeof COMMENT_ROWS>[number]>;
  /** Pièces envoyées signalées (lot 5, 5.C). */
  pieces: Map<string, z.infer<typeof PIECE_ROWS>[number]>;
  profiles: Map<string, z.infer<typeof PROFILE_ROWS>[number]>;
  /** Messages signalés (lot messages), et l'extrait autour de chacun (du plus ancien au plus récent). */
  messages: Map<string, MessageRow>;
  messageContext: Map<string, MessageRow[]>;
  /** Collections signalées (lot modération des collections), et leurs dernières envies. */
  collections: Map<string, CollectionRow>;
  collectionPreviews: Map<string, { itemCount: number; items: ModerationCollectionItem[] }>;
  /** Compte suspendu → décision de suspension en vigueur. */
  suspensions: Map<string, string>;
  /** Du plus récent au plus ancien. */
  actions: ActionRow[];
}

const NO_ROWS = Promise.resolve({ data: [], error: null });
const MISSING: ModerationPreview = { kind: "missing" };

function idsOf(rows: QueueRow[], type: QueueRow["target_type"]): string[] {
  return rows.filter((row) => row.target_type === type).map((row) => row.target_id);
}

/** Publications, commentaires, pièces envoyées et messages signalés, et les décisions déjà prises sur ces contenus. */
async function loadTargets(fastify: FastifyInstance, rows: QueueRow[]) {
  const db = fastify.supabaseAdmin;
  const postIds = idsOf(rows, "post");
  const commentIds = idsOf(rows, "comment");
  const pieceIds = idsOf(rows, "piece");
  const messageIds = idsOf(rows, "message");
  const collectionIds = idsOf(rows, "collection");
  const [posts, comments, pieces, messages, collections, actions] = await Promise.all([
    postIds.length > 0
      ? db
          .from("posts")
          .select("id, user_id, type, caption, media_url, media_thumb_url, media_removed_at, privacy, created_at, hidden_at")
          .in("id", postIds)
      : NO_ROWS,
    commentIds.length > 0 ? db.from("comments").select("id, user_id, post_id, body, created_at, hidden_at").in("id", commentIds) : NO_ROWS,
    pieceIds.length > 0
      ? db.from("piece_sends").select("id, sender_id, title, image_url, image_thumb_url, image_removed_at, created_at, hidden_at").in("id", pieceIds)
      : NO_ROWS,
    messageIds.length > 0 ? db.from("messages").select(MESSAGE_COLUMNS).in("id", messageIds) : NO_ROWS,
    // Toutes les colonnes, comme lib/collections.ts (hidden_at vient de 0034).
    collectionIds.length > 0 ? db.from("collections").select("*").in("id", collectionIds) : NO_ROWS,
    db
      .from("moderation_actions")
      // Toutes les colonnes : `automatic` n'existe qu'après la migration 0030,
      // et la file doit se lire avec ou sans elle.
      .select("*")
      .in("target_id", [...new Set(rows.map((row) => row.target_id))])
      .order("created_at", { ascending: false })
      .limit(ACTIONS_READ_LIMIT),
  ]);
  return {
    posts: parseDbRows(POST_ROWS, posts, "Publications signalées"),
    comments: parseDbRows(COMMENT_ROWS, comments, "Commentaires signalés"),
    pieces: parseDbRows(PIECE_ROWS, pieces, "Pièces envoyées signalées"),
    messages: parseDbRows(MESSAGE_ROWS, messages, "Messages signalés"),
    collections: parseDbRows(COLLECTION_ROWS, collections, "Collections signalées"),
    actions: parseDbRows(ACTION_ROWS, actions, "Journal de modération"),
  };
}

/** Quelques messages avant et après chaque message signalé, dans sa
 * conversation : rien d'autre de la conversation n'est lu. */
async function loadMessageContext(fastify: FastifyInstance, messages: MessageRow[]): Promise<Map<string, MessageRow[]>> {
  const db = fastify.supabaseAdmin;
  const around = (message: MessageRow, direction: "before" | "after") => {
    const base = db.from("messages").select(MESSAGE_COLUMNS).eq("conversation_id", message.conversation_id);
    const query =
      direction === "before"
        ? base.lt("created_at", message.created_at).order("created_at", { ascending: false })
        : base.gt("created_at", message.created_at).order("created_at", { ascending: true });
    return query.limit(MODERATION_MESSAGE_CONTEXT).then((result) => parseDbRows(MESSAGE_ROWS, result, "Messages autour d'un message signalé"));
  };
  const entries = await Promise.all(
    messages.map(async (message) => {
      const [before, after] = await Promise.all([around(message, "before"), around(message, "after")]);
      const extract: MessageRow[] = [...before.reverse(), message, ...after];
      return [message.id, extract] as [string, MessageRow[]];
    })
  );
  return new Map(entries);
}

/** Les dernières envies de chaque collection signalée (comme les amis les
 * voient : titre, copie de l'image) et leur nombre. Rien d'autre de la
 * collection n'est lu (ni prix, ni lien, ni notes). */
async function loadCollectionPreviews(fastify: FastifyInstance, collections: CollectionRow[]): Promise<Map<string, { itemCount: number; items: ModerationCollectionItem[] }>> {
  const db = fastify.supabaseAdmin;
  const entries = await Promise.all(
    collections.map(async (collection) => {
      const [items, counted] = await Promise.all([
        db
          .from("collection_items")
          .select(ITEM_COLUMNS)
          .eq("collection_id", collection.id)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(MODERATION_COLLECTION_PREVIEW_ITEMS)
          .then((result) => parseDbRows(ITEM_ROWS, result, "Envies d'une collection signalée")),
        db.from("collection_items").select("id", { count: "exact", head: true }).eq("collection_id", collection.id),
      ]);
      if (counted.error) throw new DatabaseReadError("Nombre d'envies d'une collection signalée illisible");
      const wishIds = items.map((item) => item.wishlist_item_id);
      const [titles, copies] = await Promise.all([
        wishIds.length > 0
          ? db
              .from("wishlist_items")
              .select("id, title")
              .eq("user_id", collection.user_id)
              .in("id", wishIds)
              .then((result) => parseDbRows(WISH_TITLE_ROWS, result, "Titres des envies d'une collection signalée"))
          : Promise.resolve([]),
        readCopies(fastify, collection.user_id, wishIds),
      ]);
      const titleById = new Map(titles.map((row) => [row.id, row.title]));
      const preview: ModerationCollectionItem[] = items.flatMap((item) => {
        const title = titleById.get(item.wishlist_item_id);
        if (title === undefined) return [];
        const copy = copies.get(item.wishlist_item_id);
        const removed = copy !== undefined && isRemovedCopy(copy);
        const imageUrl = copy && !removed ? (ownCopyUrl(copy.image_thumb_url, collection.user_id) ?? ownCopyUrl(copy.image_url, collection.user_id)) : null;
        return [{ id: item.id, title, imageUrl, imageRemoved: removed, canRemoveImage: copy !== undefined && !removed }];
      });
      return [collection.id, { itemCount: counted.count ?? items.length, items: preview }] as const;
    })
  );
  return new Map(entries);
}

/** Profils (comptes signalés, auteurs des contenus, administrateurs du journal) et suspensions en vigueur. */
async function loadPeople(fastify: FastifyInstance, userIds: string[]) {
  if (userIds.length === 0) return { profiles: [], suspensions: [] };
  const db = fastify.supabaseAdmin;
  const [profiles, suspensions] = await Promise.all([
    db.from("profiles").select("id, username, display_name, avatar_url, bio").in("id", userIds),
    db.from("suspensions").select("user_id, moderation_action_id").in("user_id", userIds),
  ]);
  return {
    profiles: parseDbRows(PROFILE_ROWS, profiles, "Profils signalés"),
    suspensions: parseDbRows(SUSPENSION_ROWS, suspensions, "Suspensions"),
  };
}

async function loadAll(fastify: FastifyInstance, rows: QueueRow[]): Promise<Loaded> {
  const targets = await loadTargets(fastify, rows);
  const userIds = new Set<string>(idsOf(rows, "user"));
  for (const post of targets.posts) userIds.add(post.user_id);
  for (const comment of targets.comments) userIds.add(comment.user_id);
  for (const piece of targets.pieces) userIds.add(piece.sender_id);
  for (const collection of targets.collections) userIds.add(collection.user_id);
  const [messageContext, collectionPreviews] = await Promise.all([
    loadMessageContext(fastify, targets.messages),
    loadCollectionPreviews(fastify, targets.collections),
  ]);
  for (const extract of messageContext.values()) for (const message of extract) userIds.add(message.sender_id);
  for (const action of targets.actions) if (action.admin_id) userIds.add(action.admin_id);
  const people = await loadPeople(fastify, [...userIds]);
  return {
    posts: new Map(targets.posts.map((post) => [post.id, post])),
    comments: new Map(targets.comments.map((comment) => [comment.id, comment])),
    pieces: new Map(targets.pieces.map((piece) => [piece.id, piece])),
    messages: new Map(targets.messages.map((message) => [message.id, message])),
    messageContext,
    collections: new Map(targets.collections.map((collection) => [collection.id, collection])),
    collectionPreviews,
    profiles: new Map(people.profiles.map((profile) => [profile.id, profile])),
    suspensions: new Map(people.suspensions.map((s) => [s.user_id, s.moderation_action_id])),
    actions: targets.actions,
  };
}

function authorOf(userId: string, data: Loaded): ModerationAuthor | null {
  const profile = data.profiles.get(userId);
  if (!profile) return null;
  return {
    id: profile.id,
    username: profile.username ?? "",
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
    suspended: data.suspensions.has(profile.id),
  };
}

/** Aperçu du contenu ; « missing » s'il a été supprimé depuis (ou son auteur). */
function previewOf(row: QueueRow, data: Loaded): ModerationPreview {
  if (row.target_type === "post") {
    const post = data.posts.get(row.target_id);
    const author = post ? authorOf(post.user_id, data) : null;
    if (!post || !author) return MISSING;
    return {
      kind: "post",
      author,
      caption: post.caption,
      imageUrl: post.media_thumb_url ?? post.media_url,
      imageRemoved: post.media_removed_at !== null,
      privacy: post.privacy,
      createdAt: post.created_at,
      hidden: post.hidden_at !== null,
    };
  }
  if (row.target_type === "comment") {
    const comment = data.comments.get(row.target_id);
    const author = comment ? authorOf(comment.user_id, data) : null;
    if (!comment || !author) return MISSING;
    return { kind: "comment", author, body: comment.body, postId: comment.post_id, createdAt: comment.created_at, hidden: comment.hidden_at !== null };
  }
  if (row.target_type === "piece") {
    const piece = data.pieces.get(row.target_id);
    const author = piece ? authorOf(piece.sender_id, data) : null;
    if (!piece || !author) return MISSING;
    return {
      kind: "piece",
      author,
      title: piece.title,
      imageUrl: piece.image_thumb_url ?? piece.image_url,
      imageRemoved: piece.image_removed_at !== null,
      createdAt: piece.created_at,
      hidden: piece.hidden_at !== null,
    };
  }
  if (row.target_type === "message") {
    const message = data.messages.get(row.target_id);
    const author = message ? authorOf(message.sender_id, data) : null;
    if (!message || !author) return MISSING;
    const context: ModerationMessageContext[] = (data.messageContext.get(message.id) ?? [message]).map((entry) => ({
      authorUsername: data.profiles.get(entry.sender_id)?.username ?? "",
      text: entry.body,
      wishTitle: entry.wish_title,
      createdAt: entry.created_at,
      reported: entry.id === message.id,
      hidden: entry.hidden_at !== null,
    }));
    return {
      kind: "message",
      author,
      text: message.body,
      wishTitle: message.wish_title,
      createdAt: message.created_at,
      hidden: message.hidden_at !== null,
      context,
    };
  }
  if (row.target_type === "collection") {
    const collection = data.collections.get(row.target_id);
    const author = collection ? authorOf(collection.user_id, data) : null;
    const preview = collection ? data.collectionPreviews.get(collection.id) : undefined;
    if (!collection || !author || !preview) return MISSING;
    return {
      kind: "collection",
      author,
      name: collection.name,
      visibility: collection.visibility,
      itemCount: preview.itemCount,
      items: preview.items,
      createdAt: collection.created_at,
      hidden: collection.hidden_at !== null,
    };
  }
  const author = authorOf(row.target_id, data);
  return author ? { kind: "user", author, bio: data.profiles.get(row.target_id)?.bio ?? null } : MISSING;
}

/** L'image est une copie faite par Spotto (publication « envie », pièce
 * envoyée), encore en place : « Retirer l'image » est proposé. Une
 * collection le propose envie par envie (aperçu), jamais pour elle entière. */
function canRemoveImage(row: QueueRow, preview: ModerationPreview, data: Loaded): boolean {
  if (preview.kind === "piece") return !preview.imageRemoved;
  if (preview.kind !== "post") return false;
  return data.posts.get(row.target_id)?.type === "wish" && !preview.imageRemoved;
}

/** Masquage en vigueur : le plus récent qui n'a pas été annulé (un seul possible à la fois). */
function activeHide(history: ActionRow[]): ActionRow | null {
  const undone = new Set(history.map((action) => action.undoes_action_id).filter((id): id is string => id !== null));
  return history.find((action) => action.action === "hide" && !undone.has(action.id)) ?? null;
}

function toLogEntry(action: ActionRow, data: Loaded): ModerationLogEntry {
  return {
    id: action.id,
    action: action.action,
    reason: action.reason,
    note: action.note,
    createdAt: action.created_at,
    adminUsername: action.admin_id ? (data.profiles.get(action.admin_id)?.username ?? null) : null,
    automatic: action.automatic,
  };
}

/** Ce que la base permet (sondes des migrations facultatives). */
export interface QueueOptions {
  /** Migration 0037 : retirer la bio ou la photo d'un profil. */
  profileModeration: boolean;
}

function toItem(row: QueueRow, data: Loaded, options: QueueOptions): ModerationItem {
  const history = data.actions.filter((action) => action.target_type === row.target_type && action.target_id === row.target_id);
  const preview = previewOf(row, data);
  const hidden = preview.kind !== "user" && preview.kind !== "missing" && preview.hidden;
  const hide = hidden ? activeHide(history) : null;
  // Un profil signalé : sa bio et sa photo, telles que la modération les lit.
  const reportedProfile = options.profileModeration && preview.kind === "user" ? preview : null;
  return {
    targetType: row.target_type,
    targetId: row.target_id,
    reportCount: row.report_count,
    reasons: row.reasons,
    notes: row.notes,
    firstReportedAt: row.first_at,
    lastReportedAt: row.last_at,
    preview,
    activeHideActionId: hide?.id ?? null,
    activeHideAutomatic: hide?.automatic ?? false,
    activeSuspendActionId: preview.kind === "missing" ? null : (data.suspensions.get(preview.author.id) ?? null),
    canRemoveImage: canRemoveImage(row, preview, data),
    canRemoveBio: reportedProfile !== null && (reportedProfile.bio ?? "").trim() !== "",
    canRemoveAvatar: reportedProfile !== null && reportedProfile.author.avatarUrl !== null,
    history: history.slice(0, HISTORY_LIMIT).map((action) => toLogEntry(action, data)),
  };
}

/** Éléments de la file, dans l'ordre des lignes reçues. Relève DatabaseReadError si une lecture échoue. */
export async function buildModerationItems(
  fastify: FastifyInstance,
  rows: QueueRow[],
  options: QueueOptions = { profileModeration: false }
): Promise<ModerationItem[]> {
  if (rows.length === 0) return [];
  const data = await loadAll(fastify, rows);
  return rows.map((row) => toItem(row, data, options));
}
