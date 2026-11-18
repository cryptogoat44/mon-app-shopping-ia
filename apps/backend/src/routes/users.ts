import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MEMBER_LIST_PAGE_SIZE, PRIVATE_ACCOUNT_ERROR, type MemberPage, type Post, type PublicProfile, type UserProfile } from "@monapp/shared-types";
import { INVALID_CURSOR, INVALID_ID, cursorQuerySchema, parseDbRows, parseInput, userIdParamsSchema } from "../lib/validation.js";
import { shownPosts, visiblePrivacies } from "../lib/visibility.js";
import { canSeeAuthorContent, readAudience, readAudienceOf } from "../lib/audience.js";
import { followStateOf, toMemberRows } from "../lib/memberRows.js";
import { withoutSuspendedFaces } from "../lib/profileModeration.js";
import { notInFilter, reportedIdsFor } from "../lib/reportedByViewer.js";
import { POST_ROWS, hydratePosts } from "./posts.js";

const USER_POSTS_PAGE_SIZE = 18;

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(40),
});

/** Une ligne de `follows`, lue du côté qui intéresse la liste. */
const FOLLOW_ROWS = z.array(z.object({ follower_id: z.guid(), followee_id: z.guid(), created_at: z.string() }));

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

    // Une seule lecture groupée (lib/audience.ts). Invisibilité mutuelle : un
    // profil bloqué par moi, ou qui m'a bloqué, n'apparaît dans aucune
    // recherche ; un compte suspendu par la modération non plus (lot 5). Un
    // compte privé apparaît, avec son nom et sa photo seulement (comme sur
    // son profil), et l'app y propose « Suivre » ou « Demandé ».
    const audiences = await readAudience(
      fastify,
      userId,
      candidateRows.map((p) => p.id)
    );
    const results: PublicProfile[] = candidateRows.flatMap((row) => {
      const audience = audiences.get(row.id);
      if (!audience || audience.blocked || audience.suspended) return [];
      return [
        {
          id: row.id,
          username: row.username!,
          displayName: row.display_name,
          avatarUrl: row.avatar_url,
          isFollowing: audience.follows,
          isPrivate: audience.isPrivate,
          followState: followStateOf(audience),
        },
      ];
    });

    return reply.send(results);
  });

  // Profil d'un autre utilisateur (Lot Q, décision 6) : identité, bio et
  // nombres d'abonnés / d'abonnements. JAMAIS le Vault ni son nombre de
  // pièces. Un blocage, dans un sens ou dans l'autre, rend le profil
  // introuvable (404, sans dire pourquoi). Lot « conformité Apple » : la bio
  // et la photo d'un compte suspendu ne sont montrées qu'à lui-même.
  fastify.get("/api/users/:userId", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const viewerId = request.user!.id;
    const targetId = params.userId;
    const notFound = () => reply.code(404).send({ error: "user_not_found", message: "Profil introuvable." });

    const { data: stored } = await fastify.supabaseAdmin
      .from("profiles")
      .select("id, username, display_name, avatar_url, bio")
      .eq("id", targetId)
      .maybeSingle();
    // Profil pas encore complété (sans nom d'utilisateur) : pas de page publique.
    if (!stored || !stored.username) return notFound();
    const isMe = targetId === viewerId;
    const audience = await readAudienceOf(fastify, viewerId, targetId, { suspended: false });
    if (audience.blocked) return notFound();
    const [row] = await withoutSuspendedFaces(
      fastify,
      [{ ...stored, id: stored.id as string, avatar_url: (stored.avatar_url as string | null) ?? null, bio: (stored.bio as string | null) ?? null }],
      viewerId
    );
    if (!row) return notFound();

    // Compte privé (migration 0045) : qui n'est pas un abonné accepté ne voit
    // que nom, photo, bio et compteurs d'abonnés et d'abonnements ; jamais le
    // nombre de publications (0), ni rien d'autre.
    const privacies = canSeeAuthorContent(audience) ? visiblePrivacies(isMe, audience.follows, audience.isPrivate) : [];
    const [followers, following, posts] = await Promise.all([
      fastify.supabaseAdmin.from("follows").select("*", { count: "exact", head: true }).eq("followee_id", targetId),
      fastify.supabaseAdmin.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", targetId),
      // Nombre de publications que CE visiteur peut voir (le même que la
      // grille) : ne révèle jamais l'existence de publications privées ni masquées.
      privacies.length > 0
        ? shownPosts(fastify, "id", { count: "exact", head: true }).eq("user_id", targetId).in("privacy", privacies)
        : Promise.resolve({ count: 0 }),
    ]);

    const profile: UserProfile = {
      id: row.id as string,
      username: row.username as string,
      displayName: row.display_name as string,
      avatarUrl: row.avatar_url,
      bio: row.bio,
      followersCount: followers.count ?? 0,
      followingCount: following.count ?? 0,
      postsCount: posts.count ?? 0,
      isFollowing: audience.follows,
      isMe,
      isPrivate: audience.isPrivate,
      followState: followStateOf(audience),
    };
    return reply.send(profile);
  });

  // Ses publications, chacune selon SA confidentialité : publique pour
  // tous, « abonnés » pour ses abonnés, privée pour personne d'autre.
  // Compte privé : seulement pour ses abonnés acceptés.
  fastify.get("/api/users/:userId/posts", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const pageQuery = parseInput(cursorQuerySchema, request.query, reply, INVALID_CURSOR);
    if (!pageQuery) return;
    const viewerId = request.user!.id;
    const targetId = params.userId;
    const isMe = targetId === viewerId;

    const audience = await readAudienceOf(fastify, viewerId, targetId, { suspended: false, requested: false });
    if (audience.blocked) {
      return reply.code(404).send({ error: "user_not_found", message: "Profil introuvable." });
    }
    // Compte privé : rien pour qui n'est pas un abonné accepté, quelle que
    // soit la visibilité de chaque publication — et aucune lecture des publications.
    const privacies = canSeeAuthorContent(audience) ? visiblePrivacies(isMe, audience.follows, audience.isPrivate) : [];
    if (privacies.length === 0) return reply.send({ posts: [], nextCursor: null });

    let query = shownPosts(fastify, "*")
      .eq("user_id", targetId)
      .in("privacy", privacies)
      .order("created_at", { ascending: false })
      .limit(USER_POSTS_PAGE_SIZE + 1);
    if (pageQuery.cursor) query = query.lt("created_at", pageQuery.cursor);
    // Chantier 3 : les publications que le visiteur a signalées ne lui sont plus montrées.
    const reported = isMe ? null : notInFilter(await reportedIdsFor(fastify, request.log, viewerId, "post"));
    if (reported) query = query.not("id", "in", reported);

    const { data, error } = await query;
    if (error) {
      request.log.error({ error }, "Échec de lecture des publications d'un profil");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    const rows = parseDbRows(POST_ROWS, { data, error: null }, "Publications d'un profil");
    const hasMore = rows.length > USER_POSTS_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, USER_POSTS_PAGE_SIZE) : rows;
    const posts: Post[] = await hydratePosts(fastify, pageRows, viewerId);
    return reply.send({ posts, nextCursor: hasMore ? (pageRows.at(-1)?.created_at ?? null) : null });
  });

  // Listes des abonnés et des abonnements d'un membre (lot « vie sociale »,
  // sans migration), les plus récents d'abord, 30 lignes lues par page.
  //   - Le membre lit ses deux listes ; un autre ne les lit que s'il peut voir
  //     son contenu (canSeeAuthorContent) : jamais à travers un blocage (404,
  //     comme un profil inconnu), jamais un compte privé sans en être un
  //     abonné accepté (403).
  //   - Chaque ligne passe par LA règle des listes (lib/memberRows.ts) : pas
  //     de compte bloqué avec le lecteur, suspendu, sans nom d'utilisateur, ni
  //     de compte privé montré à un inconnu. Le tri se fait APRÈS la lecture :
  //     une page peut être plus courte que prévu, ou vide, alors qu'il en
  //     reste ; le curseur est la date de la dernière ligne LUE, et la réponse
  //     ne dit jamais combien de lignes ont été laissées de côté.
  //   - Jamais la date d'un abonnement dans une ligne.
  // Sans la migration 0045, tous les comptes sont publics : les listes marchent.
  const memberListOptions = {
    preHandler: [fastify.requireAuth, fastify.rateLimit("memberList")],
    config: { rateLimitName: "memberList" as const },
  };
  for (const kind of ["followers", "following"] as const) {
    // Abonnés : les lignes où le membre est suivi. Abonnements : celles où il suit.
    const ownerColumn = kind === "followers" ? "followee_id" : "follower_id";
    const memberColumn = kind === "followers" ? "follower_id" : "followee_id";

    fastify.get(`/api/users/:userId/${kind}`, memberListOptions, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
      if (!params) return;
      const pageQuery = parseInput(cursorQuerySchema, request.query, reply, INVALID_CURSOR);
      if (!pageQuery) return;
      const viewerId = request.user!.id;
      const targetId = params.userId;

      const stored = await fastify.supabaseAdmin.from("profiles").select("id, username").eq("id", targetId).maybeSingle();
      if (stored.error) {
        request.log.error({ error: stored.error }, "Échec de lecture du profil d'une liste de membres");
        return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
      }
      // Inconnu, profil pas encore complété, ou blocage dans un sens ou dans l'autre : la même réponse.
      const notFound = () => reply.code(404).send({ error: "user_not_found", message: "Profil introuvable." });
      if (!stored.data || !stored.data.username) return notFound();
      const audience = await readAudienceOf(fastify, viewerId, targetId, { suspended: false, requested: false });
      if (audience.blocked) return notFound();
      if (!canSeeAuthorContent(audience)) {
        return reply.code(403).send({ error: PRIVATE_ACCOUNT_ERROR, message: "Ce compte est privé." });
      }

      let query = fastify.supabaseAdmin
        .from("follows")
        .select("follower_id, followee_id, created_at")
        .eq(ownerColumn, targetId)
        .order("created_at", { ascending: false })
        .limit(MEMBER_LIST_PAGE_SIZE + 1);
      if (pageQuery.cursor) query = query.lt("created_at", pageQuery.cursor);
      const rows = parseDbRows(FOLLOW_ROWS, await query, kind === "followers" ? "Abonnés d'un membre" : "Abonnements d'un membre");
      const hasMore = rows.length > MEMBER_LIST_PAGE_SIZE;
      const pageRows = hasMore ? rows.slice(0, MEMBER_LIST_PAGE_SIZE) : rows;

      const page: MemberPage = {
        members: await toMemberRows(
          fastify,
          viewerId,
          pageRows.map((row) => row[memberColumn]),
          { contextOwnerId: targetId }
        ),
        nextCursor: hasMore ? (pageRows.at(-1)?.created_at ?? null) : null,
      };
      return reply.send(page);
    });
  }
}
