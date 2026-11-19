import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { COMMENT_MAX_LENGTH, type CommentMention, type CommentsPage, type LikeCommentResponse, type PostAuthor, type PostComment } from "@monapp/shared-types";
import { readViewersAudience, type Audience } from "../lib/audience.js";
import { fetchBlockedUserIds } from "../lib/blocks.js";
import { speaksV2 } from "../lib/clientLevel.js";
import { COMMENT_NOT_FOUND, COMMENT_THREADS_UNAVAILABLE, commentThreadsReady, findShownComment, type ShownComment } from "../lib/comments.js";
import { CONTENT_NOT_ALLOWED, containsBannedWords } from "../lib/contentFilter.js";
import { resolveMentions } from "../lib/mentions.js";
import { notInFilter, reportedIdsFor } from "../lib/reportedByViewer.js";
import { findViewablePost } from "../lib/visibility.js";
import { notify } from "../lib/notify.js";
import { DatabaseReadError, INVALID_CURSOR, INVALID_ID, cursorQuerySchema, idParamsSchema, parseDbRows, parseInput } from "../lib/validation.js";
import { withoutSuspendedFaces } from "../lib/profileModeration.js";
import { consumeRateLimit } from "../plugins/rateLimit.js";

// Commentaires (Lot F, section 5.A du programme) : ordre chronologique,
// 1 000 caractères au plus. Seules les personnes qui peuvent VOIR la
// publication peuvent la lire et la commenter (lib/visibility.ts) ; jamais en
// cas de blocage.
//
// Lot « vie sociale » (migration 0046) : réponses à un commentaire (un seul
// niveau), « j'aime » d'un commentaire, mentions « @pseudo ». Une app qui le
// demande (« v=2 ») reçoit les commentaires d'origine seulement, chacun avec
// ses « j'aime », ses mentions et le nombre de ses réponses, qu'elle charge à
// part. Une app plus ancienne reçoit la liste à plat d'avant, où une réponse
// est un commentaire comme un autre. Sans la migration : exactement comme avant.
//
// Règles de visibilité (chacune a son test, tests/commentaires.test.ts) :
//  1. chaque route commence par findViewablePost : qui ne peut pas voir la
//     publication reçoit 404 pour les commentaires, les réponses et les « j'aime » ;
//  2. une réponse n'est montrée que si son commentaire d'origine l'est (ni
//     masqué, ni signalé par le lecteur, ni d'un auteur en blocage avec lui) ;
//     et une réponse ne mentionne ni ne prévient un membre en blocage avec
//     l'auteur du commentaire d'origine (il ne voit pas le fil) ;
//  3. les commentaires et réponses des comptes en blocage avec le lecteur sont
//     absents, et leurs « j'aime » ne sont pas comptés ;
//  4. une mention n'est renvoyée que si le compte mentionné porte toujours ce
//     pseudo et n'est pas en blocage avec le lecteur : sinon, simple texte.

const COMMENTS_PAGE_SIZE = 30;

const createCommentSchema = z.object({
  body: z
    .string()
    .max(COMMENT_MAX_LENGTH, `Le commentaire est trop long (${COMMENT_MAX_LENGTH} caractères maximum).`)
    .refine((text) => text.trim().length > 0, "Le commentaire est vide."),
  /** Le commentaire auquel on répond (migration 0046). */
  parentId: z.guid("Commentaire invalide.").optional(),
});

const likeCommentSchema = z.object({ liked: z.boolean() });

// Pagination vers les commentaires plus RÉCENTS (ordre chronologique).
const afterQuerySchema = cursorQuerySchema;

interface CommentRow {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  created_at: string;
  /** Lu seulement avec la migration 0046. */
  parent_id?: string | null;
}

const FLAT_COLUMNS = "id, post_id, user_id, body, created_at";
const THREAD_COLUMNS = `${FLAT_COLUMNS}, parent_id`;

const ID = z.guid();
const REACTION_ROWS = z.array(z.object({ comment_id: ID, user_id: ID }));
const MENTION_ROWS = z.array(z.object({ comment_id: ID, user_id: ID, handle: z.string() }));
const REPLY_ROWS = z.array(z.object({ id: ID, parent_id: ID.nullable(), user_id: ID }));
const PARENT_ROWS = z.array(z.object({ id: ID, user_id: ID, hidden_at: z.string().nullable() }));
const nothing = Promise.resolve({ data: [], error: null });

const POST_NOT_FOUND = { error: "post_not_found", message: "Publication introuvable." };
const INTERNAL_ERROR = { error: "internal_error", message: "Une erreur est survenue." };

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
}

/** Profils de ces comptes, tels que le lecteur peut les voir (jamais la photo d'un compte suspendu). */
async function readProfiles(fastify: FastifyInstance, ids: readonly string[], viewerId: string): Promise<Map<string, ProfileRow>> {
  if (ids.length === 0) return new Map();
  const { data: storedProfiles } = await fastify.supabaseAdmin
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", [...new Set(ids)]);
  // Lot « conformité Apple » : la photo d'un auteur suspendu n'est plus montrée aux autres.
  const profiles = await withoutSuspendedFaces(fastify, (storedProfiles as ProfileRow[]) ?? [], viewerId);
  return new Map(profiles.map((p) => [p.id, p]));
}

function toComment(row: CommentRow, byId: Map<string, ProfileRow>, viewerId: string, postAuthorId: string): PostComment {
  const profile = byId.get(row.user_id);
  const author: PostAuthor = {
    id: row.user_id,
    username: profile?.username ?? "",
    displayName: profile?.display_name ?? "",
    avatarUrl: profile?.avatar_url ?? null,
  };
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    author,
    canDelete: row.user_id === viewerId || postAuthorId === viewerId,
  };
}

/** La liste à plat d'avant (app sans « v=2 », ou base sans la migration 0046). */
async function toComments(fastify: FastifyInstance, rows: CommentRow[], viewerId: string, postAuthorId: string): Promise<PostComment[]> {
  if (rows.length === 0) return [];
  const byId = await readProfiles(fastify, rows.map((r) => r.user_id), viewerId);
  return rows.map((row) => toComment(row, byId, viewerId, postAuthorId));
}

interface ThreadContext {
  viewerId: string;
  postAuthorId: string;
  /** Comptes en blocage avec le lecteur. */
  blocked: ReadonlySet<string>;
  /** Commentaires signalés par le lecteur. */
  reported: ReadonlySet<string>;
  /** Compter les réponses (commentaires d'origine seulement). */
  withReplies: boolean;
}

/** Commentaires d'une page, avec leurs « j'aime », leurs mentions et (pour
 * les commentaires d'origine) le nombre de leurs réponses. Trois lectures
 * groupées pour la page, plus celle des profils — jamais une par commentaire.
 * Lecture impossible : DatabaseReadError, jamais un nombre ou une mention par défaut. */
async function toThreadComments(fastify: FastifyInstance, rows: CommentRow[], context: ThreadContext): Promise<PostComment[]> {
  if (rows.length === 0) return [];
  const db = fastify.supabaseAdmin;
  const ids = rows.map((row) => row.id);
  const [reactionsResult, mentionsResult, repliesResult] = await Promise.all([
    db.from("comment_reactions").select("comment_id, user_id").in("comment_id", ids),
    db.from("comment_mentions").select("comment_id, user_id, handle").in("comment_id", ids),
    context.withReplies ? db.from("comments").select("id, parent_id, user_id").in("parent_id", ids).is("hidden_at", null) : nothing,
  ]);
  const reactions = parseDbRows(REACTION_ROWS, reactionsResult, "« J'aime » des commentaires");
  // Règle 4 (première moitié) : jamais la mention d'un compte en blocage avec le lecteur.
  const mentionRows = parseDbRows(MENTION_ROWS, mentionsResult, "Mentions des commentaires").filter((row) => !context.blocked.has(row.user_id));
  const replies = parseDbRows(REPLY_ROWS, repliesResult, "Réponses aux commentaires");

  const byId = await readProfiles(fastify, [...rows.map((row) => row.user_id), ...mentionRows.map((row) => row.user_id)], context.viewerId);

  // Règle 3 : les « j'aime » des comptes en blocage avec le lecteur ne sont pas comptés.
  const likeCount = new Map<string, number>();
  const liked = new Set<string>();
  for (const reaction of reactions) {
    if (context.blocked.has(reaction.user_id)) continue;
    likeCount.set(reaction.comment_id, (likeCount.get(reaction.comment_id) ?? 0) + 1);
    if (reaction.user_id === context.viewerId) liked.add(reaction.comment_id);
  }
  // Règle 4 (seconde moitié) : le compte porte toujours ce pseudo. Après un
  // changement de pseudo, « @ancien » ne mène plus à personne.
  const mentions = new Map<string, CommentMention[]>();
  for (const mention of mentionRows) {
    if (byId.get(mention.user_id)?.username !== mention.handle) continue;
    mentions.set(mention.comment_id, [...(mentions.get(mention.comment_id) ?? []), { handle: mention.handle, userId: mention.user_id }]);
  }
  // Réponses montrées à ce lecteur : ni d'un compte en blocage, ni signalées par lui.
  const replyCount = new Map<string, number>();
  for (const reply of replies) {
    if (reply.parent_id === null || context.blocked.has(reply.user_id) || context.reported.has(reply.id)) continue;
    replyCount.set(reply.parent_id, (replyCount.get(reply.parent_id) ?? 0) + 1);
  }

  return rows.map((row) => ({
    ...toComment(row, byId, context.viewerId, context.postAuthorId),
    parentId: row.parent_id ?? null,
    likeCount: likeCount.get(row.id) ?? 0,
    viewerHasLiked: liked.has(row.id),
    mentions: mentions.get(row.id) ?? [],
    replyCount: replyCount.get(row.id) ?? 0,
  }));
}

/** Règle 2, pour la liste à plat : retire les réponses dont le commentaire
 * d'origine n'est pas montré à ce lecteur. Une lecture groupée pour la page. */
async function withShownParents(fastify: FastifyInstance, rows: CommentRow[], blocked: ReadonlySet<string>, reported: ReadonlySet<string>): Promise<CommentRow[]> {
  const parentIds = [...new Set(rows.map((row) => row.parent_id).filter((id): id is string => typeof id === "string"))];
  if (parentIds.length === 0) return rows;
  const parents = parseDbRows(PARENT_ROWS, await fastify.supabaseAdmin.from("comments").select("id, user_id, hidden_at").in("id", parentIds), "Commentaires d'origine");
  const shown = new Set(parents.filter((parent) => parent.hidden_at === null && !blocked.has(parent.user_id) && !reported.has(parent.id)).map((parent) => parent.id));
  return rows.filter((row) => typeof row.parent_id !== "string" || shown.has(row.parent_id));
}

export default async function commentsRoutes(fastify: FastifyInstance) {
  fastify.get("/api/posts/:id/comments", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const pageQuery = parseInput(afterQuerySchema, request.query, reply, INVALID_CURSOR);
    if (!pageQuery) return;
    const viewerId = request.user!.id;

    // Publication masquée par la modération : ses commentaires disparaissent avec elle.
    const post = await findViewablePost(fastify, viewerId, params.id);
    if (!post) return reply.code(404).send(POST_NOT_FOUND);

    const threads = await commentThreadsReady(fastify);
    // « v=2 » : commentaires d'origine seulement, les réponses se chargent à part.
    const threaded = threads && speaksV2(request);

    // Les commentaires des comptes en blocage avec le lecteur n'apparaissent pas.
    const blocked = await fetchBlockedUserIds(fastify, viewerId);
    let query = fastify.supabaseAdmin
      .from("comments")
      .select(threads ? THREAD_COLUMNS : FLAT_COLUMNS)
      .eq("post_id", post.id)
      .is("hidden_at", null)
      .order("created_at", { ascending: true })
      .limit(COMMENTS_PAGE_SIZE + 1);
    if (threaded) query = query.is("parent_id", null);
    if (blocked.size > 0) query = query.not("user_id", "in", `(${[...blocked].join(",")})`);
    // Chantier 3 : un commentaire signalé disparaît aussitôt pour la personne qui l'a signalé.
    const reportedIds = await reportedIdsFor(fastify, request.log, viewerId, "comment");
    const reported = notInFilter(reportedIds);
    if (reported) query = query.not("id", "in", reported);
    if (pageQuery.cursor) query = query.gt("created_at", pageQuery.cursor);

    const { data, error } = await query;
    if (error) {
      request.log.error({ error }, "Échec de lecture des commentaires");
      return reply.code(500).send(INTERNAL_ERROR);
    }
    const rows = (data as unknown as CommentRow[]) ?? [];
    const hasMore = rows.length > COMMENTS_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, COMMENTS_PAGE_SIZE) : rows;
    // Le curseur est la date de la dernière ligne LUE, même si elle n'est pas montrée.
    const nextCursor = hasMore ? (pageRows.at(-1)?.created_at ?? null) : null;
    const reportedSet = new Set(reportedIds);

    const comments = threaded
      ? await toThreadComments(fastify, pageRows, { viewerId, postAuthorId: post.user_id, blocked, reported: reportedSet, withReplies: true })
      : await toComments(fastify, threads ? await withShownParents(fastify, pageRows, blocked, reportedSet) : pageRows, viewerId, post.user_id);
    const page: CommentsPage = { comments, nextCursor };
    return reply.send(page);
  });

  // Réponses d'un commentaire, les plus anciennes d'abord (migration 0046).
  // Le commentaire doit être montré au lecteur (findShownComment) : sinon 404,
  // la même réponse que pour un commentaire inconnu.
  fastify.get("/api/comments/:id/replies", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const pageQuery = parseInput(afterQuerySchema, request.query, reply, INVALID_CURSOR);
    if (!pageQuery) return;
    const viewerId = request.user!.id;
    if (!(await commentThreadsReady(fastify))) return reply.code(404).send(COMMENT_THREADS_UNAVAILABLE);

    const parent = await findShownComment(fastify, request.log, viewerId, params.id);
    if (!parent) return reply.code(404).send(COMMENT_NOT_FOUND);

    let query = fastify.supabaseAdmin
      .from("comments")
      .select(THREAD_COLUMNS)
      .eq("parent_id", parent.comment.id)
      .is("hidden_at", null)
      .order("created_at", { ascending: true })
      .limit(COMMENTS_PAGE_SIZE + 1);
    if (parent.blocked.size > 0) query = query.not("user_id", "in", `(${[...parent.blocked].join(",")})`);
    const reported = notInFilter([...parent.reported]);
    if (reported) query = query.not("id", "in", reported);
    if (pageQuery.cursor) query = query.gt("created_at", pageQuery.cursor);

    const { data, error } = await query;
    if (error) {
      request.log.error({ error }, "Échec de lecture des réponses");
      return reply.code(500).send(INTERNAL_ERROR);
    }
    const rows = (data as unknown as CommentRow[]) ?? [];
    const hasMore = rows.length > COMMENTS_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, COMMENTS_PAGE_SIZE) : rows;
    const page: CommentsPage = {
      comments: await toThreadComments(fastify, pageRows, { viewerId, postAuthorId: parent.post.user_id, blocked: parent.blocked, reported: parent.reported, withReplies: false }),
      nextCursor: hasMore ? (pageRows.at(-1)?.created_at ?? null) : null,
    };
    return reply.send(page);
  });

  fastify.post(
    "/api/posts/:id/comments",
    { preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("comment")], config: { rateLimitName: "comment" } },
    async (request, reply) => {
      const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
      if (!params) return;
      const viewerId = request.user!.id;

      const parsed = createCommentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", message: parsed.error.issues[0]?.message ?? "Commentaire invalide." });
      }
      const body = parsed.data.body.trim();

      // Filtre des mots interdits (chantier 3, règle 1.2 d'Apple).
      if (containsBannedWords(body)) return reply.code(400).send(CONTENT_NOT_ALLOWED);

      const post = await findViewablePost(fastify, viewerId, params.id);
      if (!post) return reply.code(404).send(POST_NOT_FOUND);

      const threads = await commentThreadsReady(fastify);
      // Répondre : le commentaire visé doit être sous CETTE publication et
      // montré à l'appelant. Personne ne répond à un membre qui l'a bloqué.
      let parent: ShownComment | null = null;
      if (parsed.data.parentId !== undefined) {
        if (!threads) return reply.code(404).send(COMMENT_THREADS_UNAVAILABLE);
        parent = await findShownComment(fastify, request.log, viewerId, parsed.data.parentId);
        if (!parent || parent.post.id !== post.id) return reply.code(404).send(COMMENT_NOT_FOUND);
      }

      // Règle 2 vaut aussi pour ceux qu'une réponse touche : un membre en
      // blocage avec l'auteur du commentaire d'origine ne voit pas le fil. Il
      // n'y est ni mentionné, ni prévenu (« comment » comme « reply »).
      // Lecture impossible : ni mention, ni notification pour cette réponse.
      let threadLinks: Map<string, Audience> | null = null;
      if (parent) {
        try {
          threadLinks = await readViewersAudience(fastify, [post.user_id, parent.comment.user_id], parent.rootAuthorId);
        } catch {
          request.log.warn("Réponse sans mention ni notification : fil illisible");
        }
      }
      const seesThread = (userId: string) => parent === null || threadLinks?.get(userId)?.blocked === false;

      // Mentions retenues, AVANT d'écrire : une lecture impossible ne laisse
      // pas un commentaire enregistré derrière une réponse d'erreur. Elle
      // publie le commentaire sans aucune mention (simple texte).
      let mentions: CommentMention[] = [];
      if (threads && (parent === null || threadLinks !== null)) {
        try {
          mentions = await resolveMentions(fastify, {
            authorId: viewerId,
            text: body,
            post,
            ...(parent ? { threadAuthorId: parent.rootAuthorId } : {}),
            consume: () => consumeRateLimit(request, "mentionNotify"),
          });
        } catch {
          request.log.warn("Mentions non retenues : règles illisibles");
        }
      }

      const { data: inserted, error } = await fastify.supabaseAdmin
        .from("comments")
        // Un seul niveau : une réponse à une réponse est rattachée au commentaire d'origine.
        .insert({ post_id: post.id, user_id: viewerId, body, ...(parent ? { parent_id: parent.rootId } : {}) })
        .select(threads ? THREAD_COLUMNS : FLAT_COLUMNS)
        .single();
      if (error || !inserted) {
        request.log.error({ error }, "Échec de création d'un commentaire");
        return reply.code(500).send(INTERNAL_ERROR);
      }
      const row = inserted as unknown as CommentRow;

      if (mentions.length > 0) {
        const written = await fastify.supabaseAdmin
          .from("comment_mentions")
          .insert(mentions.map((mention) => ({ comment_id: row.id, user_id: mention.userId, author_id: viewerId, handle: mention.handle })));
        if (written.error) {
          // Pas de lien, donc pas de notification : le « @pseudo » reste un simple texte.
          request.log.warn({ code: (written.error as { code?: string }).code ?? null }, "Mentions non enregistrées");
          mentions = [];
        }
      }

      // Notifications in-app (lib/notify.ts : jamais à soi-même, jamais entre
      // deux comptes en blocage, jamais à qui ne voit plus la publication).
      // Une seule par destinataire et par commentaire : l'auteur de la
      // publication (« comment »), puis l'auteur du commentaire auquel on
      // répond (« reply »), puis chaque membre mentionné (« mention », une
      // seule par auteur, destinataire et publication). Pour une réponse,
      // seulement ceux qui voient le fil (seesThread).
      const notified = new Set<string>([post.user_id]);
      if (seesThread(post.user_id)) {
        await notify(fastify, request.log, { recipientId: post.user_id, actorId: viewerId, type: "comment", postId: post.id, commentId: row.id });
      }
      if (parent && !notified.has(parent.comment.user_id) && seesThread(parent.comment.user_id)) {
        notified.add(parent.comment.user_id);
        await notify(fastify, request.log, { recipientId: parent.comment.user_id, actorId: viewerId, type: "reply", postId: post.id, commentId: row.id });
      }
      for (const mention of mentions) {
        if (notified.has(mention.userId)) continue;
        notified.add(mention.userId);
        await notify(fastify, request.log, { recipientId: mention.userId, actorId: viewerId, type: "mention", postId: post.id, commentId: row.id, oncePerPost: true });
      }

      const [comment] = await toComments(fastify, [row], viewerId, post.user_id);
      const created: PostComment | undefined =
        comment && threads ? { ...comment, parentId: row.parent_id ?? null, likeCount: 0, viewerHasLiked: false, mentions, replyCount: 0 } : comment;
      return reply.send(created);
    }
  );

  // Aimer / ne plus aimer un commentaire (migration 0046). L'app dit l'état
  // voulu : répéter la demande ne change rien. Aucune notification.
  const likeOptions = {
    preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("commentLike")],
    config: { rateLimitName: "commentLike" as const },
  };
  fastify.put("/api/comments/:id/like", likeOptions, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const body = parseInput(likeCommentSchema, request.body, reply, { error: "invalid_body" });
    if (!body) return;
    const viewerId = request.user!.id;
    if (!(await commentThreadsReady(fastify))) return reply.code(404).send(COMMENT_THREADS_UNAVAILABLE);

    // Publication invisible, commentaire masqué, signalé par soi, ou d'un
    // compte en blocage : 404, sans dire pourquoi.
    const shown = await findShownComment(fastify, request.log, viewerId, params.id);
    if (!shown) return reply.code(404).send(COMMENT_NOT_FOUND);

    const db = fastify.supabaseAdmin;
    const written = body.liked
      ? await db.from("comment_reactions").upsert({ comment_id: shown.comment.id, user_id: viewerId }, { onConflict: "comment_id,user_id" })
      : await db.from("comment_reactions").delete().eq("comment_id", shown.comment.id).eq("user_id", viewerId);
    if (written.error) {
      request.log.error({ error: written.error }, "Échec d'un « j'aime » sur un commentaire");
      return reply.code(500).send(INTERNAL_ERROR);
    }

    // Le même nombre que dans la liste : sans les comptes en blocage avec le lecteur.
    let countQuery = db.from("comment_reactions").select("comment_id", { count: "exact", head: true }).eq("comment_id", shown.comment.id);
    if (shown.blocked.size > 0) countQuery = countQuery.not("user_id", "in", `(${[...shown.blocked].join(",")})`);
    const { count, error } = await countQuery;
    if (error) throw new DatabaseReadError("« J'aime » d'un commentaire : compte illisible");
    const result: LikeCommentResponse = { likeCount: count ?? 0, viewerHasLiked: body.liked };
    return reply.send(result);
  });

  // Retirer SA mention d'un commentaire (migration 0046) : la ligne et sa
  // notification disparaissent ; le texte garde « @pseudo », sans lien.
  // Seul le membre mentionné le peut : la suppression ne vise que ses lignes.
  // Un geste de confidentialité : permis à un compte suspendu, sans condition
  // de visibilité, et sans effet s'il n'y a rien à retirer.
  fastify.delete("/api/comments/:id/mentions/me", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const userId = request.user!.id;
    if (!(await commentThreadsReady(fastify))) return reply.code(404).send(COMMENT_THREADS_UNAVAILABLE);

    const db = fastify.supabaseAdmin;
    const mention = await db.from("comment_mentions").delete().eq("comment_id", params.id).eq("user_id", userId);
    const notice = await db.from("notifications").delete().eq("user_id", userId).eq("type", "mention").eq("comment_id", params.id);
    if (mention.error || notice.error) {
      request.log.error({ error: mention.error ?? notice.error }, "Échec du retrait d'une mention");
      return reply.code(500).send(INTERNAL_ERROR);
    }
    return reply.code(204).send();
  });

  // Suppression : l'auteur du commentaire, ou l'auteur de la publication.
  // La notification liée disparaît avec lui (cascade).
  fastify.delete("/api/comments/:id", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const viewerId = request.user!.id;
    const notFound = () => reply.code(404).send({ error: "comment_not_found", message: "Commentaire introuvable." });

    const { data: comment } = await fastify.supabaseAdmin.from("comments").select("id, post_id, user_id").eq("id", params.id).maybeSingle();
    if (!comment) return notFound();
    let allowed = comment.user_id === viewerId;
    if (!allowed) {
      const { data: post } = await fastify.supabaseAdmin.from("posts").select("user_id").eq("id", comment.post_id).maybeSingle();
      allowed = post?.user_id === viewerId;
    }
    if (!allowed) return notFound();

    const { error } = await fastify.supabaseAdmin.from("comments").delete().eq("id", params.id);
    if (error) {
      request.log.error({ error }, "Échec de suppression d'un commentaire");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    return reply.code(204).send();
  });
}
