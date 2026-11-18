// Publications enregistrées (lot « vie sociale », migration 0048) :
// enregistrer une publication qu'on voit (et la ranger dans une de ses
// collections), la retirer, et la liste « Publications enregistrées ». Règles :
// lib/savedPosts.ts. Aucune notification, aucun compteur : l'auteur n'apprend
// jamais qu'une publication a été enregistrée, ni par qui.
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { SAVED_POSTS_PAGE_SIZE, type SavePostResponse, type SavedPostsPage } from "@monapp/shared-types";
import { postVisibleTo, readAudience } from "../lib/audience.js";
import { COLLECTION_NOT_FOUND, readOwnCollection } from "../lib/collections.js";
import { reportedIdsFor } from "../lib/reportedByViewer.js";
import { SAVED_POSTS_FULL, SAVED_POSTS_UNAVAILABLE, SAVED_ROWS, savedPostsFull, savedPostsReady } from "../lib/savedPosts.js";
import { INVALID_ID, idParamsSchema, parseDbRows, parseInput } from "../lib/validation.js";
import { findViewablePost, shownPosts } from "../lib/visibility.js";
import { POST_ROWS, hydratePosts } from "./posts.js";

const ID = z.guid();
// Date d'enregistrement telle que la base la renvoie (microsecondes
// comprises), jamais réécrite : la page suivante ne saute ni ne répète rien.
const TIMESTAMP_PARAM = z
  .string()
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/);
const listQuerySchema = z.object({ cursor: TIMESTAMP_PARAM.optional(), collectionId: ID.optional() });
const saveBodySchema = z.object({ collectionId: ID.nullable().optional() }).strict();

const POST_NOT_FOUND = { error: "post_not_found", message: "Publication introuvable." } as const;
const INVALID_SAVE = { error: "invalid_body", message: "Enregistrement invalide." } as const;
const INVALID_QUERY = { error: "invalid_query", message: "Paramètre de liste invalide." } as const;
const SERVER_ERROR = { error: "internal_error", message: "Une erreur est survenue." } as const;

/** 404 « indisponible » tant que la migration 0048 manque ; vrai sinon. */
async function ensureReady(fastify: FastifyInstance, reply: FastifyReply): Promise<boolean> {
  if (await savedPostsReady(fastify)) return true;
  void reply.code(404).send(SAVED_POSTS_UNAVAILABLE);
  return false;
}

export default async function savedPostsRoutes(fastify: FastifyInstance) {
  // Enregistrer une publication, ou la ranger ailleurs (une autre de ses
  // collections, ou aucune) : la même requête. Seulement une publication que
  // le membre voit maintenant ; seulement une de SES collections. Pas réservé
  // aux comptes actifs : enregistrer ne montre rien à personne.
  fastify.put(
    "/api/posts/:id/save",
    { preHandler: [fastify.requireAuth, fastify.rateLimit("savePost")], config: { rateLimitName: "savePost" as const } },
    async (request, reply) => {
      const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
      if (!params) return;
      const body = parseInput(saveBodySchema, request.body ?? {}, reply, INVALID_SAVE);
      if (!body) return;
      if (!(await ensureReady(fastify, reply))) return;
      const userId = request.user!.id;

      // Masquée, bloquée, hors de sa visibilité, compte privé : 404, sans dire pourquoi.
      const post = await findViewablePost(fastify, userId, params.id);
      if (!post) return reply.code(404).send(POST_NOT_FOUND);
      const collectionId = body.collectionId ?? null;
      // La collection d'un autre, ou inconnue : la même réponse.
      if (collectionId !== null && !(await readOwnCollection(fastify, userId, collectionId))) return reply.code(404).send(COLLECTION_NOT_FOUND);

      const db = fastify.supabaseAdmin;
      const existing = await db.from("saved_posts").select("post_id").eq("user_id", userId).eq("post_id", post.id).maybeSingle();
      if (existing.error) {
        request.log.error({ code: (existing.error as { code?: string }).code ?? null }, "Publication enregistrée illisible");
        return reply.code(500).send(SERVER_ERROR);
      }
      // Plafond : seulement pour une nouvelle publication (ranger ailleurs reste permis).
      if (!existing.data && (await savedPostsFull(fastify, userId))) return reply.code(409).send(SAVED_POSTS_FULL);

      // La date d'enregistrement n'est jamais réécrite : ranger ailleurs ne
      // change pas la place dans la liste.
      const { error } = await db.from("saved_posts").upsert({ user_id: userId, post_id: post.id, collection_id: collectionId }, { onConflict: "user_id,post_id" });
      if (error) {
        const code = (error as { code?: string }).code ?? null;
        // 23503 : la publication vient d'être supprimée, ou la collection (la
        // base refuse aussi la collection d'un autre membre).
        if (code === "23503") {
          if (collectionId !== null && !(await readOwnCollection(fastify, userId, collectionId))) return reply.code(404).send(COLLECTION_NOT_FOUND);
          return reply.code(404).send(POST_NOT_FOUND);
        }
        request.log.error({ code }, "Échec de l'enregistrement d'une publication");
        return reply.code(500).send(SERVER_ERROR);
      }
      return reply.send({ saved: true, collectionId } satisfies SavePostResponse);
    }
  );

  // Retirer une publication de ses enregistrées : toujours permis, même quand
  // le membre ne la voit plus (aucune vérification de visibilité), et sans
  // erreur si elle n'y était pas.
  fastify.delete("/api/posts/:id/save", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    if (!(await ensureReady(fastify, reply))) return;
    const { error } = await fastify.supabaseAdmin.from("saved_posts").delete().eq("user_id", request.user!.id).eq("post_id", params.id);
    if (error) {
      request.log.error({ code: (error as { code?: string }).code ?? null }, "Échec du retrait d'une publication enregistrée");
      return reply.code(500).send(SERVER_ERROR);
    }
    return reply.code(204).send();
  });

  // Ses publications enregistrées, les plus récemment enregistrées d'abord ;
  // `collectionId` : seulement celles rangées dans cette collection (la sienne).
  //   - Chaque ligne n'est rendue que si le membre peut ENCORE voir la
  //     publication : ni masquée, ni d'un compte en blocage avec lui, ni hors
  //     de sa visibilité (compte privé compris), ni signalée par lui.
  //   - Le tri se fait APRÈS la lecture : une page peut être plus courte que
  //     prévu, ou vide, alors qu'il en reste ; la réponse ne dit jamais
  //     combien de lignes ont été laissées de côté. Le curseur est la date de
  //     la dernière ligne LUE.
  //   - Coût par page : les lignes, les publications, un readAudience pour
  //     leurs auteurs, ses signalements, puis hydratePosts ; rien par ligne.
  fastify.get("/api/saved-posts", { preHandler: fastify.requireAuth }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const query = parseInput(listQuerySchema, request.query, reply, INVALID_QUERY);
    if (!query) return;
    if (!(await ensureReady(fastify, reply))) return;
    const userId = request.user!.id;
    if (query.collectionId && !(await readOwnCollection(fastify, userId, query.collectionId))) return reply.code(404).send(COLLECTION_NOT_FOUND);

    const db = fastify.supabaseAdmin;
    let read = db
      .from("saved_posts")
      .select("post_id, collection_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("post_id", { ascending: false })
      .limit(SAVED_POSTS_PAGE_SIZE + 1);
    if (query.collectionId) read = read.eq("collection_id", query.collectionId);
    if (query.cursor) read = read.lt("created_at", query.cursor);
    const rows = parseDbRows(SAVED_ROWS, await read, "Publications enregistrées");
    const hasMore = rows.length > SAVED_POSTS_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, SAVED_POSTS_PAGE_SIZE) : rows;
    const nextCursor = hasMore ? (pageRows.at(-1)?.created_at ?? null) : null;
    if (pageRows.length === 0) return reply.send({ posts: [], nextCursor } satisfies SavedPostsPage);

    // Les publications encore montrées (jamais une publication masquée), puis
    // le droit de chacune, relu maintenant.
    const { data, error } = await shownPosts(fastify, "*").in(
      "id",
      pageRows.map((row) => row.post_id)
    );
    if (error) {
      request.log.error({ code: (error as { code?: string }).code ?? null }, "Échec de lecture des publications enregistrées");
      return reply.code(500).send(SERVER_ERROR);
    }
    const posts = parseDbRows(POST_ROWS, { data, error: null }, "Publications enregistrées");
    const [audience, reported] = await Promise.all([
      readAudience(
        fastify,
        userId,
        posts.map((post) => post.user_id),
        { suspended: false, requested: false }
      ),
      reportedIdsFor(fastify, request.log, userId, "post").then((ids) => new Set(ids)),
    ]);
    const byId = new Map(posts.map((post) => [post.id, post]));
    const visible = pageRows.flatMap((row) => {
      const post = byId.get(row.post_id);
      if (!post) return [];
      const link = audience.get(post.user_id);
      if (!link || !postVisibleTo(link, post.privacy)) return [];
      if (post.user_id !== userId && reported.has(post.id)) return [];
      return [post];
    });
    return reply.send({ posts: await hydratePosts(fastify, visible, userId), nextCursor } satisfies SavedPostsPage);
  });
}
