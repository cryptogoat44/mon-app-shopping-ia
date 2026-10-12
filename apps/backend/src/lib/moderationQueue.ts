// File de modération (lot 5, section 5.B) : à partir des signalements
// regroupés par contenu (fonction moderation_queue, migration 0023), l'aperçu
// de chaque contenu, la décision en vigueur (à annuler) et l'historique des
// décisions. Visible des seuls administrateurs ; l'auteur d'un signalement
// n'y figure jamais. Tout ce qui vient de la base est relu avec zod.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MODERATION_ACTION_TYPES,
  PRIVACY_LEVELS,
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  type ModerationAuthor,
  type ModerationItem,
  type ModerationLogEntry,
  type ModerationPreview,
} from "@monapp/shared-types";
import { parseDbRows } from "./validation.js";

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
    caption: z.string().nullable(),
    media_url: z.string().nullable(),
    media_thumb_url: z.string().nullable(),
    privacy: z.enum(PRIVACY_LEVELS),
    created_at: TIMESTAMP,
    hidden_at: TIMESTAMP.nullable(),
  })
);
const COMMENT_ROWS = z.array(
  z.object({ id: ID, user_id: ID, post_id: ID, body: z.string(), created_at: TIMESTAMP, hidden_at: TIMESTAMP.nullable() })
);
const PIECE_ROWS = z.array(
  z.object({ id: ID, sender_id: ID, title: z.string(), image_thumb_url: z.string(), created_at: TIMESTAMP, hidden_at: TIMESTAMP.nullable() })
);
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
    reason: REASON.nullable(),
    note: z.string().nullable(),
    undoes_action_id: ID.nullable(),
    created_at: TIMESTAMP,
  })
);
type ActionRow = z.infer<typeof ACTION_ROWS>[number];

interface Loaded {
  posts: Map<string, z.infer<typeof POST_ROWS>[number]>;
  comments: Map<string, z.infer<typeof COMMENT_ROWS>[number]>;
  /** Pièces envoyées signalées (lot 5, 5.C). */
  pieces: Map<string, z.infer<typeof PIECE_ROWS>[number]>;
  profiles: Map<string, z.infer<typeof PROFILE_ROWS>[number]>;
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

/** Publications, commentaires et pièces envoyées signalés, et les décisions déjà prises sur ces contenus. */
async function loadTargets(fastify: FastifyInstance, rows: QueueRow[]) {
  const db = fastify.supabaseAdmin;
  const postIds = idsOf(rows, "post");
  const commentIds = idsOf(rows, "comment");
  const pieceIds = idsOf(rows, "piece");
  const [posts, comments, pieces, actions] = await Promise.all([
    postIds.length > 0
      ? db.from("posts").select("id, user_id, caption, media_url, media_thumb_url, privacy, created_at, hidden_at").in("id", postIds)
      : NO_ROWS,
    commentIds.length > 0 ? db.from("comments").select("id, user_id, post_id, body, created_at, hidden_at").in("id", commentIds) : NO_ROWS,
    pieceIds.length > 0 ? db.from("piece_sends").select("id, sender_id, title, image_thumb_url, created_at, hidden_at").in("id", pieceIds) : NO_ROWS,
    db
      .from("moderation_actions")
      .select("id, admin_id, action, target_type, target_id, reason, note, undoes_action_id, created_at")
      .in("target_id", [...new Set(rows.map((row) => row.target_id))])
      .order("created_at", { ascending: false })
      .limit(ACTIONS_READ_LIMIT),
  ]);
  return {
    posts: parseDbRows(POST_ROWS, posts, "Publications signalées"),
    comments: parseDbRows(COMMENT_ROWS, comments, "Commentaires signalés"),
    pieces: parseDbRows(PIECE_ROWS, pieces, "Pièces envoyées signalées"),
    actions: parseDbRows(ACTION_ROWS, actions, "Journal de modération"),
  };
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
  for (const action of targets.actions) if (action.admin_id) userIds.add(action.admin_id);
  const people = await loadPeople(fastify, [...userIds]);
  return {
    posts: new Map(targets.posts.map((post) => [post.id, post])),
    comments: new Map(targets.comments.map((comment) => [comment.id, comment])),
    pieces: new Map(targets.pieces.map((piece) => [piece.id, piece])),
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
    const imageUrl = post.media_thumb_url ?? post.media_url;
    return { kind: "post", author, caption: post.caption, imageUrl, privacy: post.privacy, createdAt: post.created_at, hidden: post.hidden_at !== null };
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
    return { kind: "piece", author, title: piece.title, imageUrl: piece.image_thumb_url, createdAt: piece.created_at, hidden: piece.hidden_at !== null };
  }
  const author = authorOf(row.target_id, data);
  return author ? { kind: "user", author, bio: data.profiles.get(row.target_id)?.bio ?? null } : MISSING;
}

/** Masquage en vigueur : le plus récent qui n'a pas été annulé (un seul possible à la fois). */
function activeHideActionId(history: ActionRow[]): string | null {
  const undone = new Set(history.map((action) => action.undoes_action_id).filter((id): id is string => id !== null));
  return history.find((action) => action.action === "hide" && !undone.has(action.id))?.id ?? null;
}

function toLogEntry(action: ActionRow, data: Loaded): ModerationLogEntry {
  return {
    id: action.id,
    action: action.action,
    reason: action.reason,
    note: action.note,
    createdAt: action.created_at,
    adminUsername: action.admin_id ? (data.profiles.get(action.admin_id)?.username ?? null) : null,
  };
}

function toItem(row: QueueRow, data: Loaded): ModerationItem {
  const history = data.actions.filter((action) => action.target_type === row.target_type && action.target_id === row.target_id);
  const preview = previewOf(row, data);
  const hidden = (preview.kind === "post" || preview.kind === "comment" || preview.kind === "piece") && preview.hidden;
  return {
    targetType: row.target_type,
    targetId: row.target_id,
    reportCount: row.report_count,
    reasons: row.reasons,
    notes: row.notes,
    firstReportedAt: row.first_at,
    lastReportedAt: row.last_at,
    preview,
    activeHideActionId: hidden ? activeHideActionId(history) : null,
    activeSuspendActionId: preview.kind === "missing" ? null : (data.suspensions.get(preview.author.id) ?? null),
    history: history.slice(0, HISTORY_LIMIT).map((action) => toLogEntry(action, data)),
  };
}

/** Éléments de la file, dans l'ordre des lignes reçues. Relève DatabaseReadError si une lecture échoue. */
export async function buildModerationItems(fastify: FastifyInstance, rows: QueueRow[]): Promise<ModerationItem[]> {
  if (rows.length === 0) return [];
  const data = await loadAll(fastify, rows);
  return rows.map((row) => toItem(row, data));
}
