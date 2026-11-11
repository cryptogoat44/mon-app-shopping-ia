// Messages privés (lot messages, migration 0032) : la liste des
// conversations (et des invitations reçues), une conversation, l'envoi d'un
// message (texte et/ou carte jointe : une envie, ou un résultat d'une de vos
// recherches), accepter ou refuser une invitation.
// Règles d'envoi : lib/messaging.ts. Pas de temps réel : l'app relit toutes
// les 5 s environ pendant qu'un écran des messages est ouvert ; la personne
// qui reçoit un message peut aussi être prévenue sur son téléphone
// (lot notifications, lib/push.ts, coupé par défaut).
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
  INVALID_MESSAGE,
  INVITATION_PENDING,
  MESSAGE_COLUMNS,
  MESSAGE_EMPTY,
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
  messagesReady,
  needsRelation,
  orderedPair,
  planSend,
  readRelation,
  readSide,
  sendModeFor,
  toChatMessages,
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
import { isBlockedEitherWay } from "../lib/visibility.js";
import { WishImageError, copyWishImage, deleteWishCopy, findOwnWish } from "../lib/wishShare.js";
import { sharedWishForMessage } from "../lib/collections.js";
import { notifyNewMessage, pushAvailable } from "../lib/push.js";

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
const threadQuerySchema = z.object({ after: TIMESTAMP_PARAM.optional(), before: TIMESTAMP_PARAM.optional() }).refine((q) => !(q.after && q.before));
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
  })
  // Une seule carte par message.
  .refine((body) => [body.wishId, body.collectionItemId, body.matchId].filter(Boolean).length <= 1);

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

async function readProfiles(fastify: FastifyInstance, ids: string[]): Promise<Map<string, ProfileRow>> {
  if (ids.length === 0) return new Map();
  const rows = parseDbRows(
    PROFILE_ROWS,
    await fastify.supabaseAdmin.from("profiles").select("id, username, display_name, avatar_url, messages_from").in("id", [...new Set(ids)]),
    "Profils des conversations"
  );
  return new Map(rows.map((row) => [row.id, row]));
}

/** 404 « indisponible » tant que la migration 0032 manque ; vrai sinon. */
async function ensureReady(fastify: FastifyInstance, reply: FastifyReply): Promise<boolean> {
  if (await messagesReady(fastify)) return true;
  void reply.code(404).send(MESSAGES_UNAVAILABLE);
  return false;
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
  query: { after?: string; before?: string }
): Promise<{ rows: MessageRow[]; hasOlder: boolean }> {
  let builder = fastify.supabaseAdmin.from("messages").select(MESSAGE_COLUMNS).eq("conversation_id", side.conversation_id).is("hidden_at", null);
  if (side.cleared_at) builder = builder.gt("created_at", side.cleared_at);
  const reported = notInFilter(await reportedIdsFor(fastify, request.log, side.user_id, "message"));
  if (reported) builder = builder.not("id", "in", reported);
  if (query.after) {
    const rows = parseDbRows(MESSAGE_ROWS, await builder.gt("created_at", query.after).order("created_at", { ascending: true }).limit(POLL_MAX), "Nouveaux messages");
    return { rows, hasOlder: false };
  }
  if (query.before) builder = builder.lt("created_at", query.before);
  const rows = parseDbRows(MESSAGE_ROWS, await builder.order("created_at", { ascending: false }).limit(THREAD_PAGE_SIZE + 1), "Messages d'une conversation");
  return { rows: rows.slice(0, THREAD_PAGE_SIZE).reverse(), hasOlder: rows.length > THREAD_PAGE_SIZE };
}

/** La conversation vue par `userId` (son côté est déjà vérifié). */
async function buildThread(
  fastify: FastifyInstance,
  request: FastifyRequest,
  side: Side,
  other: ProfileRow | undefined,
  query: { after?: string; before?: string }
): Promise<ConversationThread> {
  const theirs = await readSide(fastify, side.conversation_id, side.other_user_id);
  const relation = needsRelation(side)
    ? await readRelation(fastify, side.user_id, side.other_user_id, other?.messages_from)
    : { mutual: false, recipientAccepts: false };
  // Une invitation refusée par la personne qui lit : rien de ce qui précède n'est montré.
  const { rows, hasOlder } = side.invitation === "declined" ? { rows: [], hasOlder: false } : await readThreadMessages(fastify, request, side, query);
  return {
    id: side.conversation_id,
    other: author(other, side.other_user_id),
    state: viewerState(side),
    sendMode: sendModeFor(side, theirs, relation, Date.now()),
    messages: await toChatMessages(fastify, rows, side.user_id),
    hasOlder,
  };
}

/** Aperçus de la liste : le dernier message de chaque conversation (texte
 * caché s'il est masqué ou signalé par la personne qui lit). */
async function lastMessages(fastify: FastifyInstance, request: FastifyRequest, userId: string, sides: Side[]): Promise<Map<string, ConversationLastMessage>> {
  if (sides.length === 0) return new Map();
  const conversations = parseDbRows(
    LAST_ROWS,
    await fastify.supabaseAdmin.from("conversations").select("id, last_message_id").in("id", sides.map((side) => side.conversation_id)),
    "Derniers messages des conversations"
  );
  const lastIds = conversations.map((row) => row.last_message_id).filter((id): id is string => id !== null);
  if (lastIds.length === 0) return new Map();
  const [rows, reported] = await Promise.all([
    fastify.supabaseAdmin.from("messages").select(MESSAGE_COLUMNS).in("id", lastIds).then((result) => parseDbRows(MESSAGE_ROWS, result, "Aperçus des conversations")),
    reportedIdsFor(fastify, request.log, userId, "message"),
  ]);
  const reportedIds = new Set(reported);
  const clearedAt = new Map(sides.map((side) => [side.conversation_id, side.cleared_at]));
  const previews = new Map<string, ConversationLastMessage>();
  for (const row of rows) {
    const cleared = clearedAt.get(row.conversation_id);
    if (cleared && row.created_at <= cleared) continue;
    const hidden = row.hidden_at !== null || reportedIds.has(row.id);
    previews.set(row.conversation_id, {
      text: hidden ? null : row.body,
      hasWish: !hidden && row.wish_title !== null,
      mine: row.sender_id === userId,
      hidden,
      createdAt: row.created_at,
    });
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
  fastify.get("/api/messages/status", auth, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!(await messagesReady(fastify))) return reply.send({ enabled: false, unreadCount: 0, push: false } satisfies MessagesStatus);
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
    return reply.send({ enabled: true, unreadCount: count ?? 0, push: await pushAvailable(fastify) } satisfies MessagesStatus);
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
      readProfiles(fastify, all.map((side) => side.other_user_id)),
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
    const profiles = await readProfiles(fastify, [params.userId]);
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
    const profiles = await readProfiles(fastify, [side.other_user_id]);
    reply.header("Cache-Control", "no-store");
    return reply.send(await buildThread(fastify, request, side, profiles.get(side.other_user_id), query));
  });

  // Marquer comme lue (à l'ouverture, et à chaque nouveau message vu).
  fastify.post("/api/conversations/:id/read", auth, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const userId = request.user!.id;
    if (!(await visibleSide(fastify, reply, params.id, userId))) return;
    const { error } = await fastify.supabaseAdmin
      .from("conversation_participants")
      .update({ unread: false, last_read_at: new Date().toISOString() })
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
      if (text === "" && !body.wishId && !body.collectionItemId && !body.matchId) return reply.code(400).send(MESSAGE_EMPTY);
      if (text.length > MESSAGE_MAX_LENGTH) return reply.code(400).send(MESSAGE_TOO_LONG);
      // Filtre des mots interdits (chantier 3) : le texte, comme un commentaire.
      if (containsBannedWords(text)) return reply.code(400).send(CONTENT_NOT_ALLOWED);
      if (body.recipientId === userId) return reply.code(400).send(SELF_MESSAGE);

      // « Introuvable » sans dire pourquoi (profil inexistant, incomplet ou blocage).
      const recipient = (await readProfiles(fastify, [body.recipientId])).get(body.recipientId);
      if (!recipient?.username || (await isBlockedEitherWay(fastify, userId, body.recipientId))) return reply.code(404).send(RECIPIENT_NOT_FOUND);

      const existingId = await findConversationId(fastify, userId, body.recipientId);
      const [mine, theirs] = existingId
        ? await Promise.all([readSide(fastify, existingId, userId), readSide(fastify, existingId, body.recipientId)])
        : [null, null];
      const relation = await readRelation(fastify, userId, body.recipientId, recipient.messages_from);
      const plan = planSend(mine, theirs, relation, Date.now());
      if (!plan.ok) return reply.code(plan.refusal === "pending" ? 409 : 403).send(plan.refusal === "pending" ? INVITATION_PENDING : RECIPIENT_NOT_ACCEPTING);
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
        })
        .select(MESSAGE_COLUMNS)
        .single();
      if (error || !data) {
        await discardCopy();
        if (written.created) await fastify.supabaseAdmin.from("conversations").delete().eq("id", written.conversationId);
        // Jamais le texte du message : seulement le code de l'erreur (lib/logPrivacy.ts).
        request.log.error({ error }, "Échec de l'envoi d'un message");
        return reply.code(500).send(SERVER_ERROR);
      }
      const [message] = await toChatMessages(fastify, parseDbRows(MESSAGE_ROWS, { data: [data], error: null }, "Message envoyé"), userId);
      // Jamais le titre ni le lien de la carte : sa nature seulement.
      request.log.info({ invitation: plan.invitation, withWish: card !== null, fromResult: match !== null }, "Message envoyé");
      // Lot notifications : la personne qui reçoit est prévenue sur son
      // téléphone, sans faire attendre cette réponse (lib/push.ts).
      notifyNewMessage(fastify, request.log, { senderId: userId, recipientId: body.recipientId, conversationId: written.conversationId });
      const response: SendMessageResponse = {
        conversationId: written.conversationId,
        message: message!,
        state: viewerState({ invitation: written.mine }),
        sendMode: written.mine === "sent" ? "waiting" : "direct",
      };
      return reply.code(201).send(response);
    }
  );
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
    updates.push({ userId: senderId, from: mine.invitation, values: { invitation: plan.mine, invitation_at: now, ...(plan.clearMine ? { cleared_at: null } : {}) } });
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
