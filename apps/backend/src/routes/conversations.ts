// Messages privés (lot messages, migration 0032) : la liste des
// conversations (et des invitations reçues), une conversation, l'envoi d'un
// message (texte et/ou carte jointe : une envie, ou un résultat d'une de vos
// recherches), accepter ou refuser une invitation.
// Règles d'envoi : lib/messaging.ts. Pas de temps réel : l'app relit toutes
// les 5 s environ pendant qu'un écran des messages est ouvert ; la personne
// qui reçoit un message peut aussi être prévenue sur son téléphone
// (lot notifications, lib/push.ts, coupé par défaut).
// Lot « messages vus » (migration 0043) : une conversation ouverte dit aussi
// à la personne qui a écrit si l'autre membre l'a ouverte depuis (« Vu » ou
// « Envoyé » sous son dernier message). Règles : lib/readReceipts.ts.
// Lot « messages, plus de confort » (migration 0044) : aimer un message,
// répondre à un message précis, supprimer un de ses messages, envoyer une
// publication. Ce que chacun reçoit d'un tel message : lib/messageActions.ts.
// Les nouveaux champs ne partent que vers une app qui les comprend (`v=2`,
// lib/clientLevel.ts) ; sans la migration, tout fonctionne comme avant.
// Confidentialité : le texte d'un message n'est jamais écrit au journal.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  DEFAULT_MESSAGES_FROM,
  MESSAGE_MAX_LENGTH,
  MESSAGES_FROM,
  type ConversationLastMessage,
  type ConversationSummary,
  type ConversationThread,
  type ConversationsPage,
  type MessageReactionResponse,
  type MessagesStatus,
  type PostAuthor,
  type SendMessageResponse,
} from "@monapp/shared-types";
import { fetchBlockedUserIds } from "../lib/blocks.js";
import { CONTENT_NOT_ALLOWED, containsBannedWords } from "../lib/contentFilter.js";
import { RATE_LIMITS } from "../lib/rateLimits.js";
import { consumeRateLimit } from "../plugins/rateLimit.js";
import {
  CONVERSATION_NOT_FOUND,
  CONVERSATION_NOT_OPEN,
  INVALID_MESSAGE,
  INVITATION_PENDING,
  MESSAGE_ACTIONS_UNAVAILABLE,
  MESSAGE_EMPTY,
  MESSAGE_NOT_FOUND,
  MESSAGE_ROWS,
  MESSAGE_TOO_LONG,
  MESSAGES_UNAVAILABLE,
  NOT_AN_INVITATION,
  RECIPIENT_NOT_ACCEPTING,
  RECIPIENT_NOT_FOUND,
  SELF_MESSAGE,
  SIDE_COLUMNS,
  SIDE_ROWS,
  findConversationId,
  matchCard,
  messageActionsReady,
  messageColumns,
  messagesReady,
  needsRelation,
  orderedPair,
  planSend,
  readRelation,
  readSide,
  sendModeFor,
  viewerState,
  wishCard,
  type AttachedCard,
  type MessageRow,
  type SendPlan,
  type Side,
} from "../lib/messaging.js";
import { PRODUCT_MATCH_NOT_FOUND, findOwnMatchRow } from "../lib/ownMatches.js";
import { notInFilter, reportedIdsFor } from "../lib/reportedByViewer.js";
import { INVALID_ID, idParamsSchema, parseDbRows, parseInput, userIdParamsSchema } from "../lib/validation.js";
import { findViewablePost, isBlockedEitherWay } from "../lib/visibility.js";
import { WishImageError, copyWishImage, deleteWishCopy, findOwnWish } from "../lib/wishShare.js";
import { sharedWishForMessage } from "../lib/collections.js";
import { activityPushAvailable, notifyNewMessage, pushAvailable } from "../lib/push.js";
import { openBothWays, readReceiptsAfterSend, readReceiptsFor, readStamp } from "../lib/readReceipts.js";
import { withoutSuspendedFaces } from "../lib/profileModeration.js";
import { speaksV2 } from "../lib/clientLevel.js";
import { requestLocale } from "../lib/locale.js";
import { isDeleted, previewOf, toShownMessages, type MessageReader, type ShownOptions } from "../lib/messageActions.js";

/** Messages par page d'une conversation. */
const THREAD_PAGE_SIZE = 50;
/** Nouveaux messages renvoyés au plus par une relecture (`after`). */
const POLL_MAX = 100;
/** Conversations par page de la liste ; invitations reçues montrées au plus. */
const LIST_PAGE_SIZE = 50;
const INVITATIONS_MAX = 50;

const ID = z.guid();
// Date d'un message telle que la base la renvoie (microsecondes comprises),
// jamais réécrite : une relecture `after` ne renvoie pas le dernier message reçu.
const TIMESTAMP_PARAM = z
  .string()
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/);
// `changedSince` (lot « messages, plus de confort ») : la date `syncedAt` de la
// lecture précédente ; les messages aimés ou supprimés depuis sont renvoyés.
const threadQuerySchema = z
  .object({ after: TIMESTAMP_PARAM.optional(), before: TIMESTAMP_PARAM.optional(), changedSince: TIMESTAMP_PARAM.optional() })
  .refine((q) => !(q.after && q.before));
type ThreadQuery = z.infer<typeof threadQuerySchema>;
/** La date `syncedAt` recule d'autant sur l'horloge du serveur : une écriture
 * en cours au moment de la lecture n'est jamais manquée (la relire deux fois
 * est sans effet : l'app remplace le message par son identifiant). */
const SYNC_OVERLAP_MS = 10_000;
const listQuerySchema = z.object({ cursor: TIMESTAMP_PARAM.optional() });
const sendSchema = z
  .object({
    recipientId: ID,
    // Limite large avant le nettoyage des espaces ; la vraie limite suit.
    text: z.string().max(MESSAGE_MAX_LENGTH * 4).optional(),
    wishId: ID.optional(),
    // Lot collections : « En parler » d'une envie d'une collection de la personne.
    collectionItemId: ID.optional(),
    // « Envoyer à un ami » depuis l'écran Résultat : un résultat d'une de vos recherches.
    matchId: ID.optional(),
    // Lot « messages, plus de confort » : une publication que l'expéditeur peut voir…
    postId: ID.optional(),
    // … et le message de cette conversation auquel il répond.
    replyToId: ID.optional(),
  })
  // Une seule carte par message.
  .refine((body) => [body.wishId, body.collectionItemId, body.matchId, body.postId].filter(Boolean).length <= 1);
const reactionSchema = z.object({ liked: z.boolean() });

const INVALID_QUERY = { error: "invalid_query", message: "Paramètre de liste invalide." } as const;
const WISH_NOT_FOUND = { error: "wishlist_item_not_found", message: "Envie introuvable." } as const;
const IMAGE_UNAVAILABLE = {
  error: "wish_image_unavailable",
  message: "L'image de cette envie n'a pas pu être récupérée. Réessayez plus tard.",
} as const;
// Même refus pour un résultat envoyé (même code), avec le mot qui lui va.
const MATCH_IMAGE_UNAVAILABLE = {
  error: "wish_image_unavailable",
  message: "L'image de cette pièce n'a pas pu être récupérée. Réessayez plus tard.",
} as const;
const SERVER_ERROR = { error: "internal_error", message: "Une erreur est survenue." } as const;
const POST_NOT_FOUND = { error: "post_not_found", message: "Publication introuvable." } as const;
const INVALID_REACTION = { error: "invalid_body", message: "Réaction invalide." } as const;

const PROFILE_ROWS = z.array(
  z.object({
    id: ID,
    username: z.string().nullable(),
    display_name: z.string(),
    avatar_url: z.string().nullable(),
    messages_from: z.enum(MESSAGES_FROM).default(DEFAULT_MESSAGES_FROM),
  })
);
type ProfileRow = z.infer<typeof PROFILE_ROWS>[number];
const LAST_ROWS = z.array(z.object({ id: ID, last_message_id: ID.nullable() }));

function author(row: ProfileRow | undefined, id: string): PostAuthor {
  return { id, username: row?.username ?? "", displayName: row?.display_name ?? "", avatarUrl: row?.avatar_url ?? null };
}

/** Profils des autres personnes, tels que `viewerId` peut les voir (lot
 * « conformité Apple » : sans la photo d'un compte suspendu). */
async function readProfiles(fastify: FastifyInstance, ids: string[], viewerId: string): Promise<Map<string, ProfileRow>> {
  if (ids.length === 0) return new Map();
  const stored = parseDbRows(
    PROFILE_ROWS,
    await fastify.supabaseAdmin.from("profiles").select("id, username, display_name, avatar_url, messages_from").in("id", [...new Set(ids)]),
    "Profils des conversations"
  );
  const rows = await withoutSuspendedFaces(fastify, stored, viewerId);
  return new Map(rows.map((row) => [row.id, row]));
}

/** 404 « indisponible » tant que la migration 0032 manque ; vrai sinon. */
async function ensureReady(fastify: FastifyInstance, reply: FastifyReply): Promise<boolean> {
  if (await messagesReady(fastify)) return true;
  void reply.code(404).send(MESSAGES_UNAVAILABLE);
  return false;
}

/** 404 « indisponible » tant que la migration 0044 manque ; vrai sinon. */
async function ensureActions(fastify: FastifyInstance, reply: FastifyReply): Promise<boolean> {
  if (await messageActionsReady(fastify)) return true;
  void reply.code(404).send(MESSAGE_ACTIONS_UNAVAILABLE);
  return false;
}

/** Ce que cette demande peut recevoir : colonnes de 0044 lues ou non,
 * nouveaux champs envoyés ou non (`v=2`), langue des phrases de repli. */
async function shownOptions(fastify: FastifyInstance, request: FastifyRequest): Promise<ShownOptions> {
  return { actions: await messageActionsReady(fastify), v2: speaksV2(request), locale: requestLocale(request) };
}

const readerOf = (side: Pick<Side, "user_id" | "cleared_at">): MessageReader => ({ id: side.user_id, clearedAt: side.cleared_at });

/** Ce message est-il montré à ce membre dans sa conversation ? Jamais un
 * message masqué par la modération, d'avant ce qu'il a effacé de sa vue, ni
 * qu'il a signalé (les mêmes règles que readThreadMessages). */
async function shownTo(fastify: FastifyInstance, request: FastifyRequest, row: MessageRow, side: Side): Promise<boolean> {
  if (row.conversation_id !== side.conversation_id || row.hidden_at !== null) return false;
  if (side.cleared_at && row.created_at <= side.cleared_at) return false;
  return !(await reportedIdsFor(fastify, request.log, side.user_id, "message")).includes(row.id);
}

/** Un message et le côté de `userId` dans sa conversation, si elle lui est
 * visible (ni d'un autre, ni refusée, ni en blocage) et si le message lui
 * est montré. Sinon null : la route répond 404, toujours la même réponse. */
async function visibleMessage(fastify: FastifyInstance, request: FastifyRequest, messageId: string, userId: string): Promise<{ row: MessageRow; side: Side } | null> {
  const [row] = parseDbRows(MESSAGE_ROWS, await fastify.supabaseAdmin.from("messages").select(messageColumns(true)).eq("id", messageId).limit(1), "Message");
  if (!row) return null;
  const side = await readSide(fastify, row.conversation_id, userId);
  if (!side || side.invitation === "declined" || (await isBlockedEitherWay(fastify, userId, side.other_user_id))) return null;
  return (await shownTo(fastify, request, row, side)) ? { row, side } : null;
}

/** Mon côté d'une conversation visible : ni inconnue, ni d'un autre, ni
 * refusée, ni en blocage. Sinon 404, toujours la même réponse. */
async function visibleSide(fastify: FastifyInstance, reply: FastifyReply, conversationId: string, userId: string): Promise<Side | null> {
  const side = await readSide(fastify, conversationId, userId);
  if (!side || side.invitation === "declined" || (await isBlockedEitherWay(fastify, userId, side.other_user_id))) {
    void reply.code(404).send(CONVERSATION_NOT_FOUND);
    return null;
  }
  return side;
}

/** Messages d'une conversation montrés à `userId` : jamais ceux masqués par
 * la modération, ni ceux qu'il a signalés, ni ceux d'avant son refus. */
async function readThreadMessages(
  fastify: FastifyInstance,
  request: FastifyRequest,
  side: Side,
  query: ThreadQuery,
  /** Lot « messages, plus de confort » : lit aussi les messages changés depuis `changedSince`. */
  options: { actions: boolean; changed: boolean }
): Promise<{ rows: MessageRow[]; hasOlder: boolean; changed: MessageRow[] | null }> {
  const reported = notInFilter(await reportedIdsFor(fastify, request.log, side.user_id, "message"));
  // Les mêmes filtres pour les messages de la page et pour ceux qui ont changé.
  const shown = () => {
    let builder = fastify.supabaseAdmin.from("messages").select(messageColumns(options.actions)).eq("conversation_id", side.conversation_id).is("hidden_at", null);
    if (side.cleared_at) builder = builder.gt("created_at", side.cleared_at);
    if (reported) builder = builder.not("id", "in", reported);
    return builder;
  };
  // Une seule lecture de plus, et seulement quand l'app envoie `changedSince`
  // (index messages_changed_idx) : aimés ou supprimés depuis, 100 au plus.
  const changed =
    options.changed && query.changedSince
      ? parseDbRows(MESSAGE_ROWS, await shown().gt("updated_at", query.changedSince).order("updated_at", { ascending: true }).limit(POLL_MAX), "Messages changés")
      : null;
  if (query.after) {
    const rows = parseDbRows(MESSAGE_ROWS, await shown().gt("created_at", query.after).order("created_at", { ascending: true }).limit(POLL_MAX), "Nouveaux messages");
    return { rows, hasOlder: false, changed };
  }
  let builder = shown();
  if (query.before) builder = builder.lt("created_at", query.before);
  const rows = parseDbRows(MESSAGE_ROWS, await builder.order("created_at", { ascending: false }).limit(THREAD_PAGE_SIZE + 1), "Messages d'une conversation");
  return { rows: rows.slice(0, THREAD_PAGE_SIZE).reverse(), hasOlder: rows.length > THREAD_PAGE_SIZE, changed };
}

/** La conversation vue par `userId` (son côté est déjà vérifié). */
async function buildThread(
  fastify: FastifyInstance,
  request: FastifyRequest,
  side: Side,
  other: ProfileRow | undefined,
  query: ThreadQuery
): Promise<ConversationThread> {
  const theirs = await readSide(fastify, side.conversation_id, side.other_user_id);
  const relation = needsRelation(side)
    ? await readRelation(fastify, side.user_id, side.other_user_id, other?.messages_from)
    : { mutual: false, recipientAccepts: false };
  // Une invitation refusée par la personne qui lit : rien de ce qui précède n'est montré.
  const shown = await shownOptions(fastify, request);
  // Lot « messages, plus de confort » : ce qui a changé n'est lu que pour une app qui le comprend.
  const sync = shown.actions && shown.v2 && side.invitation !== "declined";
  const syncedAt = new Date(Date.now() - SYNC_OVERLAP_MS).toISOString();
  const { rows, hasOlder, changed } =
    side.invitation === "declined"
      ? { rows: [], hasOlder: false, changed: null }
      : await readThreadMessages(fastify, request, side, query, { actions: shown.actions, changed: sync });
  const reader = readerOf(side);
  const thread: ConversationThread = {
    id: side.conversation_id,
    other: author(other, side.other_user_id),
    state: viewerState(side),
    sendMode: sendModeFor(side, theirs, relation, Date.now()),
    messages: await toShownMessages(fastify, request.log, rows, reader, shown),
    hasOlder,
    // Lot « messages vus » : null hors d'une conversation ouverte aux deux.
    readReceipts: await readReceiptsFor(fastify, request.log, side, theirs),
  };
  if (!sync) return thread;
  if (changed) thread.changed = await toShownMessages(fastify, request.log, changed, reader, shown);
  // Page pleine : la suite part de son dernier message, rien n'est sauté.
  thread.syncedAt = (changed?.length === POLL_MAX ? changed.at(-1)?.updated_at : null) ?? syncedAt;
  return thread;
}

/** Aperçus de la liste : le dernier message de chaque conversation (texte
 * caché s'il est masqué ou signalé par la personne qui lit). */
async function lastMessages(fastify: FastifyInstance, request: FastifyRequest, userId: string, sides: Side[]): Promise<Map<string, ConversationLastMessage>> {
  if (sides.length === 0) return new Map();
  const shown = await shownOptions(fastify, request);
  const conversations = parseDbRows(
    LAST_ROWS,
    await fastify.supabaseAdmin.from("conversations").select("id, last_message_id").in("id", sides.map((side) => side.conversation_id)),
    "Derniers messages des conversations"
  );
  const lastIds = conversations.map((row) => row.last_message_id).filter((id): id is string => id !== null);
  if (lastIds.length === 0) return new Map();
  const [rows, reported] = await Promise.all([
    fastify.supabaseAdmin.from("messages").select(messageColumns(shown.actions)).in("id", lastIds).then((result) => parseDbRows(MESSAGE_ROWS, result, "Aperçus des conversations")),
    reportedIdsFor(fastify, request.log, userId, "message"),
  ]);
  const reportedIds = new Set(reported);
  const clearedAt = new Map(sides.map((side) => [side.conversation_id, side.cleared_at]));
  const previews = new Map<string, ConversationLastMessage>();
  for (const row of rows) {
    const cleared = clearedAt.get(row.conversation_id);
    if (cleared && row.created_at <= cleared) continue;
    const hidden = row.hidden_at !== null || reportedIds.has(row.id);
    // Jamais le contenu d'un message supprimé, ni rien d'une publication envoyée.
    previews.set(row.conversation_id, previewOf(row, userId, hidden, shown));
  }
  return previews;
}

function blockedFilter(blocked: Set<string>): string | null {
  // Identifiants venus de notre base, jamais du client.
  return blocked.size > 0 ? `(${[...blocked].join(",")})` : null;
}

export default async function conversationsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: fastify.requireAuth };

  // Disponibilité (l'app cache l'entrée Messages sans 0032) et nombre de
  // conversations avec un message non lu, invitations reçues comprises —
  // relu avec les notifications. `push` (lot notifications) : les
  // notifications sur le téléphone sont allumées (PUSH_ENABLED et 0035) ;
  // sinon, l'app ne les propose jamais et ne demande aucune autorisation.
  // `activityPush` (lot « découverte ») : celles de l'activité aussi
  // (PUSH_ENABLED et 0051), avec ou sans la messagerie ; sinon, l'app cache
  // leurs quatre interrupteurs et ne les propose pas.
  fastify.get("/api/messages/status", auth, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!(await messagesReady(fastify))) {
      return reply.send({ enabled: false, unreadCount: 0, push: false, actions: false, activityPush: await activityPushAvailable(fastify) } satisfies MessagesStatus);
    }
    const userId = request.user!.id;
    const blocked = blockedFilter(await fetchBlockedUserIds(fastify, userId));
    let query = fastify.supabaseAdmin
      .from("conversation_participants")
      .select("conversation_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("unread", true)
      .neq("invitation", "declined");
    if (blocked) query = query.not("other_user_id", "in", blocked);
    const { count, error } = await query;
    if (error) {
      request.log.error({ error }, "Échec de lecture des messages non lus");
      return reply.code(500).send(SERVER_ERROR);
    }
    // `actions` (lot « messages, plus de confort ») : la base a la migration 0044 ;
    // sinon, l'app ne propose ni « Aimer », ni « Répondre », ni « Supprimer »,
    // ni l'envoi d'une publication.
    return reply.send({
      enabled: true,
      unreadCount: count ?? 0,
      push: await pushAvailable(fastify),
      actions: await messageActionsReady(fastify),
      activityPush: await activityPushAvailable(fastify),
    } satisfies MessagesStatus);
  });

  // Conversations (ouvertes, invitations envoyées), des plus récentes aux
  // plus anciennes ; invitations reçues à part (première page). Jamais une
  // conversation refusée, ni avec un compte en blocage.
  fastify.get("/api/conversations", auth, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    const query = parseInput(listQuerySchema, request.query, reply, INVALID_QUERY);
    if (!query) return;
    const userId = request.user!.id;
    const blocked = blockedFilter(await fetchBlockedUserIds(fastify, userId));

    const sidesQuery = (states: string[], limit: number) => {
      let builder = fastify.supabaseAdmin
        .from("conversation_participants")
        .select(SIDE_COLUMNS)
        .eq("user_id", userId)
        .in("invitation", states)
        .order("last_message_at", { ascending: false })
        .limit(limit);
      if (blocked) builder = builder.not("other_user_id", "in", blocked);
      return builder;
    };
    let mainQuery = sidesQuery(["none", "sent"], LIST_PAGE_SIZE + 1);
    if (query.cursor) mainQuery = mainQuery.lt("last_message_at", query.cursor);
    const [mainRows, invitationRows] = await Promise.all([
      mainQuery.then((result) => parseDbRows(SIDE_ROWS, result, "Conversations")),
      query.cursor ? Promise.resolve([] as Side[]) : sidesQuery(["received"], INVITATIONS_MAX).then((result) => parseDbRows(SIDE_ROWS, result, "Invitations reçues")),
    ]);
    const pageRows = mainRows.slice(0, LIST_PAGE_SIZE);
    const all = [...pageRows, ...invitationRows];
    const [profiles, previews] = await Promise.all([
      readProfiles(fastify, all.map((side) => side.other_user_id), userId),
      lastMessages(fastify, request, userId, all),
    ]);
    const summary = (side: Side): ConversationSummary => ({
      id: side.conversation_id,
      other: author(profiles.get(side.other_user_id), side.other_user_id),
      state: viewerState(side) as ConversationSummary["state"],
      lastMessage: previews.get(side.conversation_id) ?? null,
      lastMessageAt: side.last_message_at,
      unread: side.unread,
    });
    const page: ConversationsPage = {
      conversations: pageRows.map(summary),
      invitations: invitationRows.map(summary),
      nextCursor: mainRows.length > LIST_PAGE_SIZE ? (pageRows.at(-1)?.last_message_at ?? null) : null,
    };
    reply.header("Cache-Control", "no-store");
    return reply.send(page);
  });

  // La conversation avec une personne (bouton « Message » d'un profil) :
  // existante, ou ce que le premier message sera (direct, invitation, ou
  // refusé selon son réglage).
  fastify.get("/api/conversations/with/:userId", auth, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const userId = request.user!.id;
    if (params.userId === userId) return reply.code(400).send(SELF_MESSAGE);
    const profiles = await readProfiles(fastify, [params.userId], userId);
    const other = profiles.get(params.userId);
    if (!other?.username || (await isBlockedEitherWay(fastify, userId, params.userId))) return reply.code(404).send(RECIPIENT_NOT_FOUND);

    const conversationId = await findConversationId(fastify, userId, params.userId);
    const side = conversationId ? await readSide(fastify, conversationId, userId) : null;
    reply.header("Cache-Control", "no-store");
    if (side) return reply.send(await buildThread(fastify, request, side, other, {}));
    const relation = await readRelation(fastify, userId, params.userId, other.messages_from);
    const thread: ConversationThread = {
      id: null,
      other: author(other, other.id),
      state: "new",
      sendMode: sendModeFor(null, null, relation, Date.now()),
      messages: [],
      hasOlder: false,
      readReceipts: null,
    };
    return reply.send(thread);
  });

  // Une conversation : les derniers messages, les plus anciens (`before`) ou
  // les nouveaux depuis le dernier reçu (`after`, relecture de l'app).
  fastify.get("/api/conversations/:id", auth, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const query = parseInput(threadQuerySchema, request.query, reply, INVALID_QUERY);
    if (!query) return;
    const side = await visibleSide(fastify, reply, params.id, request.user!.id);
    if (!side) return;
    const profiles = await readProfiles(fastify, [side.other_user_id], request.user!.id);
    reply.header("Cache-Control", "no-store");
    return reply.send(await buildThread(fastify, request, side, profiles.get(side.other_user_id), query));
  });

  // Marquer comme lue (à l'ouverture, et à chaque nouveau message vu). La
  // date de cette lecture ne sort jamais du serveur : l'autre membre apprend
  // seulement, dans une conversation ouverte, que son dernier message a été
  // vu, et jamais par une lecture qui précède son ouverture : celle d'une
  // invitation reçue reste donc privée (lib/readReceipts.ts).
  fastify.post("/api/conversations/:id/read", auth, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const userId = request.user!.id;
    const side = await visibleSide(fastify, reply, params.id, userId);
    if (!side) return;
    const { error } = await fastify.supabaseAdmin
      .from("conversation_participants")
      .update({ unread: false, last_read_at: readStamp(side, Date.now()) })
      .eq("conversation_id", params.id)
      .eq("user_id", userId);
    if (error) {
      request.log.error({ error }, "Échec du marquage d'une conversation comme lue");
      return reply.code(500).send(SERVER_ERROR);
    }
    return reply.code(204).send();
  });

  // Accepter une invitation reçue : la conversation s'ouvre pour les deux.
  fastify.post("/api/conversations/:id/accept", auth, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const userId = request.user!.id;
    const side = await visibleSide(fastify, reply, params.id, userId);
    if (!side) return;
    if (side.invitation === "none") return reply.code(204).send();
    if (side.invitation !== "received") return reply.code(409).send(NOT_AN_INVITATION);
    const now = new Date().toISOString();
    const db = fastify.supabaseAdmin;
    const mine = await db
      .from("conversation_participants")
      .update({ invitation: "none", invitation_at: now, unread: false, last_read_at: now })
      .eq("conversation_id", params.id)
      .eq("user_id", userId)
      .eq("invitation", "received");
    const theirs = mine.error
      ? mine
      : await db
          .from("conversation_participants")
          .update({ invitation: "none", invitation_at: now })
          .eq("conversation_id", params.id)
          .eq("user_id", side.other_user_id)
          .eq("invitation", "sent");
    if (theirs.error) {
      request.log.error({ error: theirs.error }, "Échec de l'acceptation d'une invitation");
      return reply.code(500).send(SERVER_ERROR);
    }
    return reply.code(204).send();
  });

  // Refuser une invitation reçue : la conversation disparaît pour vous ; la
  // personne qui invite n'est pas prévenue et ne peut pas réinviter avant 30 jours.
  fastify.post("/api/conversations/:id/decline", auth, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const userId = request.user!.id;
    const side = await visibleSide(fastify, reply, params.id, userId);
    if (!side) return;
    if (side.invitation !== "received") return reply.code(409).send(NOT_AN_INVITATION);
    // Messages cachés : jusqu'au dernier message, daté par la base (jamais
    // l'horloge du serveur, qui peut différer de quelques instants).
    const { error } = await fastify.supabaseAdmin
      .from("conversation_participants")
      .update({ invitation: "declined", invitation_at: new Date().toISOString(), cleared_at: side.last_message_at, unread: false })
      .eq("conversation_id", params.id)
      .eq("user_id", userId)
      .eq("invitation", "received");
    if (error) {
      request.log.error({ error }, "Échec du refus d'une invitation");
      return reply.code(500).send(SERVER_ERROR);
    }
    return reply.code(204).send();
  });

  // Envoyer un message à une personne : la conversation est trouvée ou créée
  // ici. Refusé à un compte suspendu, et limité (messages, invitations,
  // cartes jointes).
  fastify.post(
    "/api/messages",
    {
      preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("messageSend")],
      config: { rateLimitName: "messageSend" },
    },
    async (request, reply) => {
      if (!(await ensureReady(fastify, reply))) return;
      const body = parseInput(sendSchema, request.body, reply, INVALID_MESSAGE);
      if (!body) return;
      const userId = request.user!.id;
      const text = body.text?.trim() ?? "";
      if (text === "" && !body.wishId && !body.collectionItemId && !body.matchId && !body.postId) return reply.code(400).send(MESSAGE_EMPTY);
      if (text.length > MESSAGE_MAX_LENGTH) return reply.code(400).send(MESSAGE_TOO_LONG);
      // Filtre des mots interdits (chantier 3) : le texte, comme un commentaire.
      if (containsBannedWords(text)) return reply.code(400).send(CONTENT_NOT_ALLOWED);
      if (body.recipientId === userId) return reply.code(400).send(SELF_MESSAGE);
      // Lot « messages, plus de confort » : sans la migration 0044, ni réponse ni publication.
      const actions = await messageActionsReady(fastify);
      if ((body.replyToId || body.postId) && !actions) return reply.code(404).send(MESSAGE_ACTIONS_UNAVAILABLE);

      // « Introuvable » sans dire pourquoi (profil inexistant, incomplet ou blocage).
      const recipient = (await readProfiles(fastify, [body.recipientId], userId)).get(body.recipientId);
      if (!recipient?.username || (await isBlockedEitherWay(fastify, userId, body.recipientId))) return reply.code(404).send(RECIPIENT_NOT_FOUND);

      const existingId = await findConversationId(fastify, userId, body.recipientId);
      const [mine, theirs] = existingId
        ? await Promise.all([readSide(fastify, existingId, userId), readSide(fastify, existingId, body.recipientId)])
        : [null, null];
      const relation = await readRelation(fastify, userId, body.recipientId, recipient.messages_from);
      const plan = planSend(mine, theirs, relation, Date.now());
      if (!plan.ok) return reply.code(plan.refusal === "pending" ? 409 : 403).send(plan.refusal === "pending" ? INVITATION_PENDING : RECIPIENT_NOT_ACCEPTING);
      // Réponse à un message : il doit être dans CETTE conversation et montré
      // à l'expéditeur (ni masqué, ni supprimé, ni signalé par lui, ni d'avant
      // ce qu'il a effacé de sa vue ; jamais depuis une invitation refusée).
      if (body.replyToId) {
        const [quoted] = mine && mine.invitation !== "declined"
          ? parseDbRows(MESSAGE_ROWS, await fastify.supabaseAdmin.from("messages").select(messageColumns(true)).eq("id", body.replyToId).limit(1), "Message cité")
          : [];
        if (!quoted || !mine || isDeleted(quoted) || !(await shownTo(fastify, request, quoted, mine))) return reply.code(404).send(MESSAGE_NOT_FOUND);
      }
      // Publication envoyée : l'expéditeur doit pouvoir la voir lui-même
      // (masquage, blocages, confidentialité), et ne pas l'avoir signalée.
      // Rien d'elle n'est recopié dans le message : ni légende, ni image, ni
      // auteur ; la personne qui la reçoit ne la verra que si elle y a droit,
      // au moment où elle regarde (lib/messageActions.ts).
      if (body.postId) {
        const viewable = (await findViewablePost(fastify, userId, body.postId)) !== null;
        if (!viewable || (await reportedIdsFor(fastify, request.log, userId, "post")).includes(body.postId)) return reply.code(404).send(POST_NOT_FOUND);
      }
      if (plan.invitation && !consumeRateLimit(request, "messageInvite")) return sendLimit(reply, "messageInvite");

      // Envie jointe : une des Envies de l'expéditeur, image copiée dans notre
      // stockage (jamais l'adresse du marchand), comptée comme une pièce envoyée.
      // Lot collections : ou une envie d'une collection de la personne à qui il
      // écrit, montrée à ses amis (« En parler ») ; la copie est rangée chez
      // l'expéditeur, comme pour ses propres envies.
      const wish = body.wishId
        ? await findOwnWish(fastify, userId, body.wishId)
        : body.collectionItemId
          ? await sharedWishForMessage(fastify, userId, body.recipientId, body.collectionItemId)
          : null;
      if ((body.wishId || body.collectionItemId) && !wish) return reply.code(404).send(WISH_NOT_FOUND);
      // « Envoyer à un ami » : un résultat d'une recherche de l'expéditeur (celui
      // d'une autre personne : même 404 qu'un résultat inexistant), sans passer
      // par ses Envies. Même carte, même copie de l'image, mêmes limites.
      const match = body.matchId ? await findOwnMatchRow(fastify, userId, body.matchId) : null;
      const card: AttachedCard | null = wish ? wishCard(wish) : match ? matchCard(match) : null;
      if (body.matchId && !card) return reply.code(404).send(PRODUCT_MATCH_NOT_FOUND);
      let copy: { url: string; thumbUrl: string } | null = null;
      if (card) {
        if (!consumeRateLimit(request, "pieceSend")) return sendLimit(reply, "pieceSend");
        try {
          copy = await copyWishImage(fastify, request.log, userId, card.imageSource);
        } catch (error) {
          if (error instanceof WishImageError) return reply.code(422).send(match ? MATCH_IMAGE_UNAVAILABLE : IMAGE_UNAVAILABLE);
          throw error;
        }
      }
      const discardCopy = () => (copy ? deleteWishCopy(fastify, userId, [copy.url, copy.thumbUrl]) : Promise.resolve());

      const written = await writeConversation(fastify, request, userId, body.recipientId, existingId, plan, mine, theirs);
      if (!written.ok) {
        await discardCopy();
        if (written.refusal) return reply.code(written.refusal.status).send(written.refusal.body);
        return reply.code(500).send(SERVER_ERROR);
      }

      const { data, error } = await fastify.supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: written.conversationId,
          sender_id: userId,
          body: text === "" ? null : text,
          ...(card && copy ? { ...card.columns, wish_image_url: copy.url, wish_image_thumb_url: copy.thumbUrl } : {}),
          // Aucune copie d'image pour une publication : elle ne compte pas comme une pièce envoyée.
          ...(body.postId ? { post_id: body.postId, shared_post: true } : {}),
          ...(body.replyToId ? { reply_to_id: body.replyToId } : {}),
        })
        .select(messageColumns(actions))
        .single();
      if (error || !data) {
        await discardCopy();
        if (written.created) await fastify.supabaseAdmin.from("conversations").delete().eq("id", written.conversationId);
        // Jamais le texte du message : seulement le code de l'erreur (lib/logPrivacy.ts).
        request.log.error({ error }, "Échec de l'envoi d'un message");
        return reply.code(500).send(SERVER_ERROR);
      }
      const [message] = await toShownMessages(
        fastify,
        request.log,
        parseDbRows(MESSAGE_ROWS, { data: [data], error: null }, "Message envoyé"),
        { id: userId, clearedAt: plan.clearMine ? null : (mine?.cleared_at ?? null) },
        { actions, v2: speaksV2(request), locale: requestLocale(request) }
      );
      // Jamais le titre ni le lien de la carte : sa nature seulement.
      request.log.info(
        { invitation: plan.invitation, withWish: card !== null, fromResult: match !== null, withPost: body.postId !== undefined, reply: body.replyToId !== undefined },
        "Message envoyé"
      );
      // Lot notifications : la personne qui reçoit est prévenue sur son
      // téléphone, sans faire attendre cette réponse (lib/push.ts).
      notifyNewMessage(fastify, request.log, { senderId: userId, recipientId: body.recipientId, conversationId: written.conversationId });
      const response: SendMessageResponse = {
        conversationId: written.conversationId,
        message: message!,
        state: viewerState({ invitation: written.mine }),
        sendMode: written.mine === "sent" ? "waiting" : "direct",
        // Lot « messages vus » : rien pour une invitation envoyée.
        readReceipts: written.mine === "none" ? await readReceiptsAfterSend(fastify, request.log, written.conversationId, userId) : null,
      };
      return reply.code(201).send(response);
    }
  );

  // Aimer un message (❤️), ou ne plus l'aimer : le sien ou celui de l'autre
  // membre, dans une conversation ouverte aux deux. Refaire la même demande
  // ne change rien. Personne n'est prévenu : ni notification, ni « non lu »,
  // ni notification sur le téléphone ; l'autre membre le voit à sa relecture.
  fastify.put(
    "/api/messages/:id/reaction",
    {
      preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("messageReact")],
      config: { rateLimitName: "messageReact" },
    },
    async (request, reply) => {
      if (!(await ensureReady(fastify, reply))) return;
      if (!(await ensureActions(fastify, reply))) return;
      const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
      if (!params) return;
      const body = parseInput(reactionSchema, request.body, reply, INVALID_REACTION);
      if (!body) return;
      const userId = request.user!.id;
      const found = await visibleMessage(fastify, request, params.id, userId);
      if (!found || isDeleted(found.row)) return reply.code(404).send(MESSAGE_NOT_FOUND);
      const theirs = await readSide(fastify, found.side.conversation_id, found.side.other_user_id);
      if (!openBothWays(found.side, theirs)) return reply.code(409).send(CONVERSATION_NOT_OPEN);

      const db = fastify.supabaseAdmin;
      const existing = await db.from("message_reactions").select("message_id").eq("message_id", params.id).eq("user_id", userId).limit(1);
      if (existing.error) {
        request.log.error({ error: existing.error }, "Échec de lecture d'un « j'aime » de message");
        return reply.code(500).send(SERVER_ERROR);
      }
      const likedNow = ((existing.data as unknown[] | null) ?? []).length > 0;
      if (body.liked !== likedNow) {
        const written = body.liked
          ? await db.from("message_reactions").insert({ message_id: params.id, user_id: userId })
          : await db.from("message_reactions").delete().eq("message_id", params.id).eq("user_id", userId);
        // Deux demandes en même temps : la seconde trouve le « j'aime » déjà là.
        if (written.error && written.error.code !== "23505") {
          request.log.error({ error: written.error }, "Échec de l'écriture d'un « j'aime » de message");
          return reply.code(500).send(SERVER_ERROR);
        }
        // Horloge du serveur : l'app de l'autre membre l'apprend à sa relecture (`changedSince`).
        const touched = await db.from("messages").update({ updated_at: new Date().toISOString() }).eq("id", params.id);
        if (touched.error) request.log.warn({ code: touched.error.code ?? null }, "« J'aime » enregistré, date de changement non écrite");
      }
      const [message] = await toShownMessages(fastify, request.log, [found.row], readerOf(found.side), { actions: true, v2: true, locale: requestLocale(request) });
      return reply.send({ message: message! } satisfies MessageReactionResponse);
    }
  );

  // Supprimer un de SES messages, pour les deux membres : il reste la ligne
  // « Message supprimé ». Possible aussi pour un compte suspendu (retirer un
  // contenu reste permis), sans limite de temps. Le texte, la carte et la
  // copie de l'image sont effacés de la base et du stockage.
  // Exception, pour la modération : si ce message a déjà été signalé (que le
  // signalement soit traité ou non), son contenu reste dans la base ; seule
  // la date de suppression est écrite, et plus aucun des deux membres ne le
  // reçoit. Les signalements sont lus AVANT l'écriture : un signalement qui
  // arrive un instant plus tard trouve un message déjà effacé (limite connue,
  // décision 3 du fondateur).
  fastify.delete("/api/messages/:id", auth, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    if (!(await ensureActions(fastify, reply))) return;
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const userId = request.user!.id;
    const found = await visibleMessage(fastify, request, params.id, userId);
    // Le message d'un autre : la même réponse qu'un message inexistant.
    if (!found || found.row.sender_id !== userId) return reply.code(404).send(MESSAGE_NOT_FOUND);
    const { row } = found;
    if (isDeleted(row)) return reply.code(204).send();

    const db = fastify.supabaseAdmin;
    const reports = await db.from("reports").select("id").eq("target_type", "message").eq("target_id", row.id).limit(1);
    if (reports.error) {
      // Dans le doute, rien n'est effacé.
      request.log.error({ error: reports.error }, "Échec de lecture des signalements d'un message à supprimer");
      return reply.code(500).send(SERVER_ERROR);
    }
    const kept = ((reports.data as unknown[] | null) ?? []).length > 0;
    const now = new Date().toISOString();
    const erased = {
      body: null,
      wish_title: null,
      wish_image_url: null,
      wish_image_thumb_url: null,
      wish_merchant_name: null,
      wish_merchant_url: null,
      wish_product_match_id: null,
      wish_price_min: null,
      wish_currency: null,
      post_id: null,
      shared_post: false,
      reply_to_id: null,
    };
    const { error } = await db
      .from("messages")
      .update({ deleted_at: now, updated_at: now, ...(kept ? {} : erased) })
      .eq("id", row.id)
      .eq("sender_id", userId)
      .is("deleted_at", null);
    if (error) {
      request.log.error({ error }, "Échec de la suppression d'un message");
      return reply.code(500).send(SERVER_ERROR);
    }
    // Ses « j'aime » partent avec lui ; les réponses qui le citaient sont
    // relues par l'app de l'autre membre (elles montrent « Message indisponible »).
    const [reactions, quoting] = await Promise.all([
      db.from("message_reactions").delete().eq("message_id", row.id),
      db.from("messages").update({ updated_at: now }).eq("reply_to_id", row.id),
    ]);
    if (reactions.error || quoting.error) request.log.warn({ code: (reactions.error ?? quoting.error)?.code ?? null }, "Message supprimé, suites incomplètes");
    // La copie de l'image de l'envie jointe : effacée du stockage, sauf contenu conservé.
    if (!kept) await deleteWishCopy(fastify, userId, [row.wish_image_url, row.wish_image_thumb_url]);
    // Jamais le texte : seulement ce qui a été fait.
    request.log.info({ kept }, "Message supprimé par son auteur");
    return reply.code(204).send();
  });
}

function sendLimit(reply: FastifyReply, name: "messageInvite" | "pieceSend") {
  const rule = RATE_LIMITS[name];
  return reply.code(429).send({ error: rule.error, message: rule.message });
}

type Written =
  | { ok: true; conversationId: string; created: boolean; mine: Side["invitation"] }
  | { ok: false; refusal: { status: number; body: { error: string; message: string } } | null };

/** Crée la conversation, ou écrit les états qui changent (acceptation
 * implicite, nouvelle invitation, réouverture), avant le message. Deux
 * premiers messages simultanés : la base n'en garde qu'une (paire unique),
 * l'envoi reprend sur celle-ci. */
async function writeConversation(
  fastify: FastifyInstance,
  request: FastifyRequest,
  senderId: string,
  recipientId: string,
  existingId: string | null,
  plan: Extract<SendPlan, { ok: true }>,
  mine: Side | null,
  theirs: Side | null
): Promise<Written> {
  const db = fastify.supabaseAdmin;
  const now = new Date().toISOString();
  if (!existingId) {
    const { data, error } = await db.from("conversations").insert(orderedPair(senderId, recipientId)).select("id").single();
    if (error?.code === "23505") {
      const raceId = await findConversationId(fastify, senderId, recipientId);
      const [raceMine, raceTheirs] = raceId ? await Promise.all([readSide(fastify, raceId, senderId), readSide(fastify, raceId, recipientId)]) : [null, null];
      if (!raceId || !raceMine || !raceTheirs) return { ok: false, refusal: null };
      const replan = planSend(raceMine, raceTheirs, await readRelation(fastify, senderId, recipientId), Date.now());
      if (!replan.ok) {
        return { ok: false, refusal: replan.refusal === "pending" ? { status: 409, body: INVITATION_PENDING } : { status: 403, body: RECIPIENT_NOT_ACCEPTING } };
      }
      return writeConversation(fastify, request, senderId, recipientId, raceId, replan, raceMine, raceTheirs);
    }
    const conversationId = (data as { id?: string } | null)?.id;
    if (error || !conversationId) {
      request.log.error({ error }, "Échec de la création d'une conversation");
      return { ok: false, refusal: null };
    }
    const at = plan.invitation ? now : null;
    const { error: sidesError } = await db.from("conversation_participants").insert([
      { conversation_id: conversationId, user_id: senderId, other_user_id: recipientId, invitation: plan.mine, invitation_at: at },
      { conversation_id: conversationId, user_id: recipientId, other_user_id: senderId, invitation: plan.theirs, invitation_at: at },
    ]);
    if (sidesError) {
      await db.from("conversations").delete().eq("id", conversationId);
      request.log.error({ error: sidesError }, "Échec de la création d'une conversation");
      return { ok: false, refusal: null };
    }
    return { ok: true, conversationId, created: true, mine: plan.mine };
  }

  // États qui changent, chacun à condition de ne pas avoir changé depuis la lecture.
  const updates: { userId: string; from: Side["invitation"]; values: Record<string, unknown> }[] = [];
  if (mine && (mine.invitation !== plan.mine || plan.clearMine)) {
    // Lot « messages vus » : répondre à une invitation reçue (ou écrire après
    // l'avoir refusée) vaut lecture, comme « Accepter » : la lecture est datée
    // du moment où la conversation s'ouvre, jamais d'avant.
    const answers = plan.mine === "none" && (mine.invitation === "received" || mine.invitation === "declined");
    updates.push({
      userId: senderId,
      from: mine.invitation,
      values: { invitation: plan.mine, invitation_at: now, ...(plan.clearMine ? { cleared_at: null } : {}), ...(answers ? { last_read_at: now } : {}) },
    });
  }
  if (theirs && theirs.invitation !== plan.theirs) {
    updates.push({ userId: recipientId, from: theirs.invitation, values: { invitation: plan.theirs, invitation_at: now } });
  }
  for (const update of updates) {
    const { error } = await db
      .from("conversation_participants")
      .update(update.values)
      .eq("conversation_id", existingId)
      .eq("user_id", update.userId)
      .eq("invitation", update.from);
    if (error) {
      request.log.error({ error }, "Échec de la mise à jour d'une conversation");
      return { ok: false, refusal: null };
    }
  }
  return { ok: true, conversationId: existingId, created: false, mine: plan.mine };
}
