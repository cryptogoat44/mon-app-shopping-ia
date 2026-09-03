import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ConsentStatus, ConsentType } from "@monapp/shared-types";

const CONSENT_TYPES: ConsentType[] = ["terms", "privacy_policy", "marketing_email"];

const recordConsentsSchema = z.object({
  types: z.array(z.enum(CONSENT_TYPES as [ConsentType, ...ConsentType[]])).min(1),
});

// Buckets de stockage qui contiennent des fichiers rangés sous
// `${userId}/...` — à vider quand un compte est supprimé, sans quoi les
// fichiers restent orphelins sur le stockage malgré la suppression en base.
const USER_STORAGE_BUCKETS = ["screenshots", "vault-media", "post-media"];

async function deleteUserStorageFiles(fastify: FastifyInstance, userId: string): Promise<void> {
  for (const bucket of USER_STORAGE_BUCKETS) {
    const { data: files, error } = await fastify.supabaseAdmin.storage.from(bucket).list(userId);
    if (error || !files || files.length === 0) continue;

    const paths = files.map((f) => `${userId}/${f.name}`);
    await fastify.supabaseAdmin.storage.from(bucket).remove(paths);
  }
}

export default async function accountRoutes(fastify: FastifyInstance) {
  // Statut de consentement courant (le dernier événement par type) — sert à
  // afficher "CGU acceptées le ..." dans l'écran Compte.
  fastify.get("/api/consents", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    const { data, error } = await fastify.supabaseAdmin
      .from("consents")
      .select("type, granted_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      request.log.error({ error }, "Échec de lecture des consentements");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    // On ne garde que l'événement le plus récent par type (déjà trié par
    // created_at décroissant ci-dessus).
    const latestByType = new Map<ConsentType, string | null>();
    for (const row of (data as { type: ConsentType; granted_at: string | null }[]) ?? []) {
      if (!latestByType.has(row.type)) latestByType.set(row.type, row.granted_at);
    }

    const statuses: ConsentStatus[] = CONSENT_TYPES.map((type) => ({
      type,
      grantedAt: latestByType.get(type) ?? null,
    }));

    return reply.send(statuses);
  });

  // Enregistre un événement de consentement par type demandé. On insère
  // toujours une nouvelle ligne (jamais de mise à jour) : le consentement
  // est un historique d'événements, pas un simple statut qu'on écrase — en
  // cas de contrôle, on doit pouvoir montrer quand il a été donné.
  fastify.post("/api/consents", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const parsed = recordConsentsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", message: "Requête invalide." });
    }

    const userId = request.user!.id;
    const now = new Date().toISOString();

    const { error } = await fastify.supabaseAdmin.from("consents").insert(
      parsed.data.types.map((type) => ({
        user_id: userId,
        type,
        granted_at: now,
      }))
    );

    if (error) {
      request.log.error({ error }, "Échec d'enregistrement du consentement");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    return reply.code(204).send();
  });

  // Export RGPD : un instantané JSON de toutes les données personnelles de
  // l'utilisateur. Servi directement dans la réponse (pas de génération
  // asynchrone ni d'email) — suffisant vu le volume de données en Phase 1.
  fastify.get("/api/me/export", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;
    const db = fastify.supabaseAdmin;

    // Les product_matches n'ont pas de user_id direct (ils appartiennent à
    // une recherche) : on récupère d'abord les recherches, puis leurs
    // résultats par search_id — plus simple et plus sûr qu'un filtre sur
    // une ressource jointe.
    const searches = await db.from("product_searches").select("*").eq("user_id", userId);
    const searchIds = (searches.data ?? []).map((s) => s.id as string);

    const [matches, vaultItems, posts, followers, following, consents, clicks, profile] = await Promise.all([
      searchIds.length > 0
        ? db.from("product_matches").select("*").in("search_id", searchIds)
        : Promise.resolve({ data: [] as unknown[] }),
      db.from("vault_items").select("*").eq("user_id", userId),
      db.from("posts").select("*").eq("user_id", userId),
      db.from("follows").select("follower_id, created_at").eq("followee_id", userId),
      db.from("follows").select("followee_id, created_at").eq("follower_id", userId),
      db.from("consents").select("type, granted_at, revoked_at, created_at").eq("user_id", userId),
      db.from("affiliate_clicks").select("affiliate_link_id, clicked_at").eq("user_id", userId),
      db.from("profiles").select("*").eq("id", userId).single(),
    ]);

    await db.from("data_export_requests").insert({
      user_id: userId,
      status: "ready",
      completed_at: new Date().toISOString(),
    });

    return reply.send({
      exportedAt: new Date().toISOString(),
      profile: profile.data ?? null,
      productSearches: searches.data ?? [],
      productMatches: matches.data ?? [],
      vaultItems: vaultItems.data ?? [],
      posts: posts.data ?? [],
      followers: followers.data ?? [],
      following: following.data ?? [],
      consents: consents.data ?? [],
      affiliateClicks: clicks.data ?? [],
    });
  });

  // Suppression réelle de compte : supprime l'utilisateur Supabase Auth (les
  // clés étrangères "on delete cascade" du schéma nettoient déjà profils,
  // vault, posts, recherches, abonnements, consentements...), puis vide les
  // fichiers de stockage associés pour ne laisser aucune trace orpheline.
  fastify.delete("/api/me", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    await deleteUserStorageFiles(fastify, userId);

    const { error } = await fastify.supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      request.log.error({ error }, "Échec de suppression du compte");
      return reply.code(500).send({ error: "internal_error", message: "La suppression a échoué." });
    }

    return reply.code(204).send();
  });
}
