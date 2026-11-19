// Messages, plus de confort (lot messages confort, migration 0044) : ce que
// la personne qui lit reçoit d'un message aimé, cité, supprimé, ou qui porte
// une publication. Règles, toutes vérifiées par tests/messagerieConfort.test.ts :
// - un message supprimé ne renvoie JAMAIS son contenu à l'un des deux
//   membres, même quand la base l'a conservé pour la modération (il avait
//   été signalé avant) : ni texte, ni carte, ni « j'aime », ni citation ;
// - une publication envoyée n'est jamais recopiée dans le message : elle est
//   relue ici pour la personne qui regarde, à chaque lecture, et montrée
//   seulement si elle a le droit de la voir à ce moment-là (masquage,
//   blocages, confidentialité : lib/visibility.ts) et si elle ne l'a pas
//   signalée. Sinon : « indisponible », sans auteur, ni légende, ni image.
//   La personne qui l'a envoyée suit la même règle ;
// - un message cité n'est montré (extrait) que s'il est lui-même montré à la
//   personne qui lit : ni masqué, ni supprimé, ni signalé par elle, ni
//   d'avant ce qu'elle a effacé de sa vue ;
// - une app plus ancienne (sans `v=2`) ne reçoit aucun de ces champs : un
//   message supprimé ou qui ne porte qu'une publication lui arrive avec une
//   phrase fixe à la place du texte, dans sa langue.
// Une lecture impossible ne fait jamais échouer la conversation : elle vaut
// « indisponible » (publication, citation) ou « pas aimé ».
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { MESSAGE_QUOTE_MAX_LENGTH, type ChatMessage, type ConversationLastMessage, type MessagePostCard, type MessageQuote, type PostAuthor } from "@monapp/shared-types";
import type { Locale } from "./locale.js";
import { clip, toChatMessages, type MessageRow } from "./messaging.js";
import { withoutSuspendedFaces } from "./profileModeration.js";
import { reportedIdsFor } from "./reportedByViewer.js";
import { findViewablePost, shownPosts } from "./visibility.js";

/** Ce que reçoit une app plus ancienne à la place du texte. */
export const FALLBACK_TEXT = {
  deleted: { fr: "Message supprimé", en: "Message deleted" },
  sharedPost: { fr: "Publication partagée", en: "Shared post" },
} as const satisfies Record<string, Record<Locale, string>>;

/** La personne qui lit, et ce qu'elle a effacé de sa vue (refus d'une invitation). */
export interface MessageReader {
  id: string;
  clearedAt: string | null;
}

export interface ShownOptions {
  /** La base a la migration 0044 (les lignes portent ses colonnes). */
  actions: boolean;
  /** L'app comprend les nouveaux champs (paramètre `v=2`). */
  v2: boolean;
  locale: Locale;
}

const ID = z.guid();
const REACTION_ROWS = z.array(z.object({ message_id: ID, user_id: ID }));
const QUOTED_ROWS = z.array(
  z.object({
    id: ID,
    conversation_id: ID,
    sender_id: ID,
    body: z.string().nullable(),
    wish_title: z.string().nullable(),
    shared_post: z.boolean().nullable().optional(),
    hidden_at: z.string().nullable(),
    deleted_at: z.string().nullable().optional(),
    created_at: z.string(),
  })
);
type QuotedRow = z.infer<typeof QUOTED_ROWS>[number];
const POST_ROWS = z.array(
  z.object({
    id: ID,
    user_id: ID,
    caption: z.string().nullable(),
    media_url: z.string().nullable(),
    media_thumb_url: z.string().nullable().optional(),
    media_removed_at: z.string().nullable().optional(),
  })
);
const AUTHOR_ROWS = z.array(z.object({ id: ID, username: z.string().nullable(), display_name: z.string(), avatar_url: z.string().nullable() }));

const UNAVAILABLE_POST: MessagePostCard = { available: false };

/** Ce message a été supprimé par la personne qui l'a écrit. */
export function isDeleted(row: Pick<MessageRow, "deleted_at">): boolean {
  return typeof row.deleted_at === "string";
}

/** « J'aime » de chaque message : celui de la personne qui lit, celui de l'autre membre. */
async function readLikes(fastify: FastifyInstance, log: FastifyBaseLogger, ids: string[], readerId: string): Promise<Map<string, { mine: boolean; theirs: boolean }>> {
  const likes = new Map<string, { mine: boolean; theirs: boolean }>();
  if (ids.length === 0) return likes;
  const result = await fastify.supabaseAdmin.from("message_reactions").select("message_id, user_id").in("message_id", ids);
  const rows = REACTION_ROWS.safeParse(result.data);
  if (result.error || !rows.success) {
    log.warn({ code: result.error?.code ?? null }, "« J'aime » des messages illisibles : aucun n'est montré");
    return likes;
  }
  for (const row of rows.data) {
    const entry = likes.get(row.message_id) ?? { mine: false, theirs: false };
    if (row.user_id === readerId) entry.mine = true;
    else entry.theirs = true;
    likes.set(row.message_id, entry);
  }
  return likes;
}

/** Le message cité, tel que la personne qui lit peut le voir (règle 4). */
function quoteOf(quoted: QuotedRow | undefined, replyToId: string, conversationId: string, reader: MessageReader, reported: ReadonlySet<string>): MessageQuote {
  const shown =
    quoted !== undefined &&
    quoted.conversation_id === conversationId &&
    quoted.hidden_at === null &&
    !isDeleted(quoted) &&
    !reported.has(quoted.id) &&
    !(reader.clearedAt !== null && quoted.created_at <= reader.clearedAt);
  if (!shown) return { id: replyToId, mine: false, kind: "unavailable", excerpt: null };
  const mine = quoted.sender_id === reader.id;
  if (quoted.body !== null) return { id: quoted.id, mine, kind: "text", excerpt: clip(quoted.body, MESSAGE_QUOTE_MAX_LENGTH) };
  if (quoted.wish_title !== null) return { id: quoted.id, mine, kind: "wish", excerpt: clip(quoted.wish_title, MESSAGE_QUOTE_MAX_LENGTH) };
  // Une publication envoyée : jamais rien d'elle dans la citation.
  return { id: quoted.id, mine, kind: quoted.shared_post === true ? "post" : "unavailable", excerpt: null };
}

/** Les messages cités par ces lignes (une lecture), ce que la personne a signalé compris. */
async function readQuotes(fastify: FastifyInstance, log: FastifyBaseLogger, rows: MessageRow[], reader: MessageReader): Promise<Map<string, MessageQuote>> {
  const quotes = new Map<string, MessageQuote>();
  const quoting = rows.filter((row) => typeof row.reply_to_id === "string");
  if (quoting.length === 0) return quotes;
  const ids = [...new Set(quoting.map((row) => row.reply_to_id as string))];
  const [result, reportedIds] = await Promise.all([
    fastify.supabaseAdmin.from("messages").select("id, conversation_id, sender_id, body, wish_title, shared_post, hidden_at, deleted_at, created_at").in("id", ids),
    reportedIdsFor(fastify, log, reader.id, "message"),
  ]);
  const parsed = QUOTED_ROWS.safeParse(result.data);
  if (result.error || !parsed.success) log.warn({ code: result.error?.code ?? null }, "Messages cités illisibles : montrés « indisponibles »");
  const byId = new Map((parsed.success && !result.error ? parsed.data : []).map((row) => [row.id, row]));
  const reported = new Set(reportedIds);
  for (const row of quoting) quotes.set(row.id, quoteOf(byId.get(row.reply_to_id as string), row.reply_to_id as string, row.conversation_id, reader, reported));
  return quotes;
}

/** Les publications que la personne qui lit a le droit de voir maintenant,
 * parmi `postIds` (règles 1 et 2) : une vérification par publication, quel
 * que soit le nombre de messages qui la portent. Les autres sont absentes
 * de la réponse (« indisponible »). */
export async function readPostCards(fastify: FastifyInstance, log: FastifyBaseLogger, postIds: string[], readerId: string): Promise<Map<string, MessagePostCard>> {
  const cards = new Map<string, MessagePostCard>();
  const ids = [...new Set(postIds)];
  if (ids.length === 0) return cards;
  try {
    const reported = new Set(await reportedIdsFor(fastify, log, readerId, "post"));
    const viewable = (
      await Promise.all(
        ids
          .filter((id) => !reported.has(id))
          .map((id) =>
            findViewablePost(fastify, readerId, id)
              .then((post) => post?.id ?? null)
              .catch(() => null)
          )
      )
    ).filter((id): id is string => id !== null);
    if (viewable.length === 0) return cards;
    const posts = POST_ROWS.safeParse((await shownPosts(fastify, "id, user_id, caption, media_url, media_thumb_url, media_removed_at").in("id", viewable)).data);
    if (!posts.success) return cards;
    const stored = AUTHOR_ROWS.safeParse(
      (await fastify.supabaseAdmin.from("profiles").select("id, username, display_name, avatar_url").in("id", [...new Set(posts.data.map((post) => post.user_id))])).data
    );
    if (!stored.success) return cards;
    // Comme partout ailleurs : sans la photo d'un auteur suspendu.
    const authors = new Map((await withoutSuspendedFaces(fastify, stored.data, readerId)).map((row) => [row.id, row]));
    const allowed = new Set(viewable);
    for (const post of posts.data) {
      const profile = authors.get(post.user_id);
      // Relue entre-temps comme non visible, ou auteur introuvable : rien.
      if (!allowed.has(post.id) || !profile) continue;
      const author: PostAuthor = { id: profile.id, username: profile.username ?? "", displayName: profile.display_name, avatarUrl: profile.avatar_url };
      const removed = typeof post.media_removed_at === "string";
      cards.set(post.id, { available: true, id: post.id, author, thumbUrl: removed ? null : (post.media_thumb_url ?? post.media_url), caption: post.caption });
    }
  } catch {
    log.warn("Publications envoyées illisibles : montrées « indisponibles »");
    cards.clear();
  }
  return cards;
}

/** Messages renvoyés à l'app, tels que `reader` peut les voir. */
export async function toShownMessages(fastify: FastifyInstance, log: FastifyBaseLogger, rows: MessageRow[], reader: MessageReader, options: ShownOptions): Promise<ChatMessage[]> {
  const live = rows.filter((row) => !isDeleted(row));
  // Le contenu d'un message supprimé ne passe jamais par ici, conservé ou non.
  const base = new Map((await toChatMessages(fastify, live, reader.id)).map((message) => [message.id, message]));
  const rich = options.actions && options.v2;
  const [likes, quotes, posts] = rich
    ? await Promise.all([
        readLikes(fastify, log, live.map((row) => row.id), reader.id),
        readQuotes(fastify, log, live, reader),
        readPostCards(fastify, log, live.filter((row) => row.shared_post === true && typeof row.post_id === "string").map((row) => row.post_id as string), reader.id),
      ])
    : [new Map<string, { mine: boolean; theirs: boolean }>(), new Map<string, MessageQuote>(), new Map<string, MessagePostCard>()];

  return rows.map((row) => {
    const mine = row.sender_id === reader.id;
    if (isDeleted(row)) {
      return options.v2
        ? { id: row.id, mine, text: null, wish: null, post: null, deleted: true, createdAt: row.created_at }
        : { id: row.id, mine, text: FALLBACK_TEXT.deleted[options.locale], wish: null, createdAt: row.created_at };
    }
    const message = base.get(row.id)!;
    const sharesPost = options.actions && row.shared_post === true;
    if (!rich) {
      // App plus ancienne : une phrase fixe à la place d'une bulle vide, rien de la publication.
      return sharesPost && message.text === null && message.wish === null ? { ...message, text: FALLBACK_TEXT.sharedPost[options.locale] } : message;
    }
    const post: MessagePostCard | null = sharesPost ? ((typeof row.post_id === "string" ? posts.get(row.post_id) : undefined) ?? UNAVAILABLE_POST) : null;
    return { ...message, liked: likes.get(row.id) ?? { mine: false, theirs: false }, replyTo: quotes.get(row.id) ?? null, post };
  });
}

/** L'aperçu d'une conversation dans la liste : jamais le contenu d'un
 * message supprimé, jamais rien d'une publication envoyée. `hidden` : masqué
 * par la modération, ou signalé par la personne qui lit. */
export function previewOf(row: MessageRow, readerId: string, hidden: boolean, options: ShownOptions): ConversationLastMessage {
  const mine = row.sender_id === readerId;
  if (isDeleted(row)) {
    return options.v2
      ? { text: null, hasWish: false, mine, hidden, createdAt: row.created_at, deleted: true }
      : { text: hidden ? null : FALLBACK_TEXT.deleted[options.locale], hasWish: false, mine, hidden, createdAt: row.created_at };
  }
  const hasWish = !hidden && row.wish_title !== null;
  const sharesPost = !hidden && options.actions && row.shared_post === true;
  const preview: ConversationLastMessage = { text: hidden ? null : row.body, hasWish, mine, hidden, createdAt: row.created_at };
  if (!sharesPost) return preview;
  if (options.v2) return { ...preview, hasPost: true };
  return preview.text === null && !hasWish ? { ...preview, text: FALLBACK_TEXT.sharedPost[options.locale] } : preview;
}
