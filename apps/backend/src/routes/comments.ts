import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { COMMENT_MAX_LENGTH, type PostAuthor, type PostComment, type PrivacyLevel } from "@monapp/shared-types";
import { fetchBlockedUserIds } from "../lib/blocks.js";
import { canViewPost } from "../lib/visibility.js";
import { INVALID_CURSOR, INVALID_ID, cursorQuerySchema, idParamsSchema, parseInput } from "../lib/validation.js";

// Commentaires (Lot F, section 5.A du programme) : à plat, ordre
// chronologique, 1 000 caractères au plus. Seules les personnes qui peuvent
// VOIR la publication peuvent la lire et la commenter (lib/visibility.ts) ;
// jamais en cas de blocage.

const COMMENTS_PAGE_SIZE = 30;

const createCommentSchema = z.object({
  body: z
    .string()
    .max(COMMENT_MAX_LENGTH, `Le commentaire est trop long (${COMMENT_MAX_LENGTH} caractères maximum).`)
    .refine((text) => text.trim().length > 0, "Le commentaire est vide."),
});

// Pagination vers les commentaires plus RÉCENTS (ordre chronologique).
const afterQuerySchema = cursorQuerySchema;

interface CommentRow {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

interface PostRef {
  id: string;
  user_id: string;
  privacy: PrivacyLevel;
}

const POST_NOT_FOUND = { error: "post_not_found", message: "Publication introuvable." };

async function loadVisiblePost(fastify: FastifyInstance, viewerId: string, postId: string): Promise<PostRef | null> {
  const { data: post } = await fastify.supabaseAdmin.from("posts").select("id, user_id, privacy").eq("id", postId).maybeSingle();
  if (!post || !(await canViewPost(fastify, viewerId, post as PostRef))) return null;
  return post as PostRef;
}

async function toComments(fastify: FastifyInstance, rows: CommentRow[], viewerId: string, postAuthorId: string): Promise<PostComment[]> {
  if (rows.length === 0) return [];
  const authorIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: profiles } = await fastify.supabaseAdmin
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", authorIds);
  const byId = new Map(
    ((profiles as { id: string; username: string | null; display_name: string; avatar_url: string | null }[]) ?? []).map((p) => [p.id, p])
  );
  return rows.map((row) => {
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
  });
}

export default async function commentsRoutes(fastify: FastifyInstance) {
  fastify.get("/api/posts/:id/comments", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const pageQuery = parseInput(afterQuerySchema, request.query, reply, INVALID_CURSOR);
    if (!pageQuery) return;
    const viewerId = request.user!.id;

    const post = await loadVisiblePost(fastify, viewerId, params.id);
    if (!post) return reply.code(404).send(POST_NOT_FOUND);

    // Les commentaires des comptes en blocage avec le lecteur n'apparaissent pas.
    const blocked = await fetchBlockedUserIds(fastify, viewerId);
    let query = fastify.supabaseAdmin
      .from("comments")
      .select("id, post_id, user_id, body, created_at")
      .eq("post_id", post.id)
      .is("hidden_at", null)
      .order("created_at", { ascending: true })
      .limit(COMMENTS_PAGE_SIZE + 1);
    if (blocked.size > 0) query = query.not("user_id", "in", `(${[...blocked].join(",")})`);
    if (pageQuery.cursor) query = query.gt("created_at", pageQuery.cursor);

    const { data, error } = await query;
    if (error) {
      request.log.error({ error }, "Échec de lecture des commentaires");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    const rows = (data as CommentRow[]) ?? [];
    const hasMore = rows.length > COMMENTS_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, COMMENTS_PAGE_SIZE) : rows;
    return reply.send({
      comments: await toComments(fastify, pageRows, viewerId, post.user_id),
      nextCursor: hasMore ? (pageRows.at(-1)?.created_at ?? null) : null,
    });
  });

  fastify.post(
    "/api/posts/:id/comments",
    { preHandler: [fastify.requireAuth, fastify.rateLimit("comment")], config: { rateLimitName: "comment" } },
    async (request, reply) => {
      const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
      if (!params) return;
      const viewerId = request.user!.id;

      const parsed = createCommentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", message: parsed.error.issues[0]?.message ?? "Commentaire invalide." });
      }

      const post = await loadVisiblePost(fastify, viewerId, params.id);
      if (!post) return reply.code(404).send(POST_NOT_FOUND);

      const { data: inserted, error } = await fastify.supabaseAdmin
        .from("comments")
        .insert({ post_id: post.id, user_id: viewerId, body: parsed.data.body.trim() })
        .select("id, post_id, user_id, body, created_at")
        .single();
      if (error || !inserted) {
        request.log.error({ error }, "Échec de création d'un commentaire");
        return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
      }

      // Notification in-app à l'auteur de la publication — jamais pour ses
      // propres commentaires.
      if (post.user_id !== viewerId) {
        await fastify.supabaseAdmin.from("notifications").insert({
          user_id: post.user_id,
          actor_id: viewerId,
          type: "comment",
          post_id: post.id,
          comment_id: (inserted as CommentRow).id,
        });
      }

      const [comment] = await toComments(fastify, [inserted as CommentRow], viewerId, post.user_id);
      return reply.send(comment);
    }
  );

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
