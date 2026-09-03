import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PublicProfile } from "@monapp/shared-types";

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

    const seen = new Set<string>();
    const rows: ProfileRow[] = [];
    for (const row of [...(byUsername.data ?? []), ...(byDisplayName.data ?? [])] as ProfileRow[]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
      if (rows.length >= 20) break;
    }

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
}
