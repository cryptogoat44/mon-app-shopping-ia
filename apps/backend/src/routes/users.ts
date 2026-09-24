import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Post, PublicProfile, UserProfile } from "@monapp/shared-types";
import { INVALID_CURSOR, INVALID_ID, cursorQuerySchema, parseInput, userIdParamsSchema } from "../lib/validation.js";
import { isBlockedEitherWay, isFollowing, visiblePrivacies } from "../lib/visibility.js";
import { hydratePosts, type PostRow } from "./posts.js";

const USER_POSTS_PAGE_SIZE = 18;

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(40),
});

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
}

export default async function usersRoutes(fastify: FastifyInstance) {
  fastify.get("/api/users/search", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", message: "Requête de recherche invalide." });
    }

    const userId = request.user!.id;
    const query = parsed.data.q.toLowerCase();
    const pattern = `%${query}%`;

    // Deux requêtes séparées et paramétrées plutôt qu'un .or() construit par
    // interpolation de chaîne : la syntaxe de filtre PostgREST donne un sens
    // spécial à la virgule et aux parenthèses, donc injecter le texte tapé
    // par l'utilisateur directement dedans permettrait de manipuler le
    // filtre plutôt que de simplement chercher ce texte.
    const [byUsername, byDisplayName] = await Promise.all([
      fastify.supabaseAdmin
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .not("username", "is", null)
        .neq("id", userId)
        .ilike("username", pattern)
        .limit(20),
      fastify.supabaseAdmin
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .not("username", "is", null)
        .neq("id", userId)
        .ilike("display_name", pattern)
        .limit(20),
    ]);

    if (byUsername.error || byDisplayName.error) {
      request.log.error({ error: byUsername.error ?? byDisplayName.error }, "Échec de recherche de profils");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const seenIds = new Set<string>();
    const candidateRows: ProfileRow[] = [];
    for (const row of [...(byUsername.data ?? []), ...(byDisplayName.data ?? [])] as ProfileRow[]) {
      if (seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      candidateRows.push(row);
      if (candidateRows.length >= 20) break;
    }

    const candidateIds = candidateRows.map((p) => p.id);

    // Invisibilité mutuelle : un profil bloqué par moi, ou qui m'a bloqué,
    // ne doit apparaître dans aucune recherche.
    let blockedIds = new Set<string>();
    if (candidateIds.length > 0) {
      const [{ data: blockedByMe }, { data: blockingMe }] = await Promise.all([
        fastify.supabaseAdmin.from("blocks").select("blocked_id").eq("blocker_id", userId).in("blocked_id", candidateIds),
        fastify.supabaseAdmin.from("blocks").select("blocker_id").eq("blocked_id", userId).in("blocker_id", candidateIds),
      ]);
      blockedIds = new Set([
        ...(blockedByMe ?? []).map((b) => b.blocked_id as string),
        ...(blockingMe ?? []).map((b) => b.blocker_id as string),
      ]);
    }

    const rows = candidateRows.filter((row) => !blockedIds.has(row.id));
    const profileIds = rows.map((p) => p.id);

    let followingIds = new Set<string>();
    if (profileIds.length > 0) {
      const { data: follows } = await fastify.supabaseAdmin
        .from("follows")
        .select("followee_id")
        .eq("follower_id", userId)
        .in("followee_id", profileIds);
      followingIds = new Set((follows ?? []).map((f) => f.followee_id as string));
    }

    const results: PublicProfile[] = rows.map((row) => ({
      id: row.id,
      username: row.username!,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      isFollowing: followingIds.has(row.id),
    }));

    return reply.send(results);
  });

  // Profil d'un autre utilisateur (Lot Q, décision 6) : identité, bio et
  // nombres d'abonnés / d'abonnements. JAMAIS le Vault ni son nombre de
  // pièces. Un blocage, dans un sens ou dans l'autre, rend le profil
  // introuvable (404, sans dire pourquoi).
  fastify.get("/api/users/:userId", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const viewerId = request.user!.id;
    const targetId = params.userId;
    const notFound = () => reply.code(404).send({ error: "user_not_found", message: "Profil introuvable." });

    const { data: row } = await fastify.supabaseAdmin
      .from("profiles")
      .select("id, username, display_name, avatar_url, bio")
      .eq("id", targetId)
      .maybeSingle();
    // Profil pas encore complété (sans nom d'utilisateur) : pas de page publique.
    if (!row || !row.username) return notFound();
    const isMe = targetId === viewerId;
    if (!isMe && (await isBlockedEitherWay(fastify, viewerId, targetId))) return notFound();

    const [followers, following, viewerFollows] = await Promise.all([
      fastify.supabaseAdmin.from("follows").select("*", { count: "exact", head: true }).eq("followee_id", targetId),
      fastify.supabaseAdmin.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", targetId),
      isMe ? Promise.resolve(false) : isFollowing(fastify, viewerId, targetId),
    ]);

    const profile: UserProfile = {
      id: row.id as string,
      username: row.username as string,
      displayName: row.display_name as string,
      avatarUrl: (row.avatar_url as string | null) ?? null,
      bio: (row.bio as string | null) ?? null,
      followersCount: followers.count ?? 0,
      followingCount: following.count ?? 0,
      isFollowing: viewerFollows,
      isMe,
    };
    return reply.send(profile);
  });

  // Ses publications, chacune selon SA confidentialité : publique pour
  // tous, « abonnés » pour ses abonnés, privée pour personne d'autre.
  fastify.get("/api/users/:userId/posts", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const pageQuery = parseInput(cursorQuerySchema, request.query, reply, INVALID_CURSOR);
    if (!pageQuery) return;
    const viewerId = request.user!.id;
    const targetId = params.userId;
    const isMe = targetId === viewerId;

    if (!isMe && (await isBlockedEitherWay(fastify, viewerId, targetId))) {
      return reply.code(404).send({ error: "user_not_found", message: "Profil introuvable." });
    }
    const follows = isMe ? false : await isFollowing(fastify, viewerId, targetId);

    let query = fastify.supabaseAdmin
      .from("posts")
      .select("*")
      .eq("user_id", targetId)
      .in("privacy", visiblePrivacies(isMe, follows))
      .order("created_at", { ascending: false })
      .limit(USER_POSTS_PAGE_SIZE + 1);
    if (pageQuery.cursor) query = query.lt("created_at", pageQuery.cursor);

    const { data, error } = await query;
    if (error) {
      request.log.error({ error }, "Échec de lecture des publications d'un profil");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    const rows = (data as PostRow[]) ?? [];
    const hasMore = rows.length > USER_POSTS_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, USER_POSTS_PAGE_SIZE) : rows;
    const posts: Post[] = await hydratePosts(fastify, pageRows, viewerId);
    return reply.send({ posts, nextCursor: hasMore ? (pageRows.at(-1)?.created_at ?? null) : null });
  });
}
