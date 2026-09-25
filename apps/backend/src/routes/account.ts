import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LEGAL_DOCUMENT_VERSIONS, type ConsentStatus, type ConsentType, type LegalDocumentType } from "@monapp/shared-types";
import { deleteUserStorageFiles } from "../lib/storage.js";

const CONSENT_TYPES: ConsentType[] = ["terms", "privacy_policy", "marketing_email"];

const recordConsentsSchema = z.object({
  consents: z
    .array(
      z.object({
        type: z.enum(CONSENT_TYPES as [ConsentType, ...ConsentType[]]),
        version: z.string().trim().min(1).max(40).optional(),
      })
    )
    .min(1)
    .max(CONSENT_TYPES.length),
});

function isLegalDocument(type: ConsentType): type is LegalDocumentType {
  return type in LEGAL_DOCUMENT_VERSIONS;
}

export default async function accountRoutes(fastify: FastifyInstance) {
  // Statut de consentement courant (le dernier événement par type) — sert à
  // afficher "CGU acceptées le ..." dans l'écran Compte.
  fastify.get("/api/consents", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    const { data, error } = await fastify.supabaseAdmin
      .from("consents")
      .select("type, granted_at, document_version")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      request.log.error({ error }, "Échec de lecture des consentements");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    // On ne garde que l'événement le plus récent par type (déjà trié par
    // created_at décroissant ci-dessus).
    const latestByType = new Map<ConsentType, { grantedAt: string | null; version: string | null }>();
    for (const row of (data as { type: ConsentType; granted_at: string | null; document_version: string | null }[]) ?? []) {
      if (!latestByType.has(row.type)) latestByType.set(row.type, { grantedAt: row.granted_at, version: row.document_version });
    }

    const statuses: ConsentStatus[] = CONSENT_TYPES.map((type) => {
      const latest = latestByType.get(type);
      const grantedAt = latest?.grantedAt ?? null;
      const version = latest?.version ?? null;
      const isCurrent = grantedAt !== null && (!isLegalDocument(type) || version === LEGAL_DOCUMENT_VERSIONS[type]);
      return { type, grantedAt, version, isCurrent };
    });

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

    // Un document juridique n'est accepté que dans sa version en vigueur :
    // l'historique doit montrer précisément quel texte a été accepté.
    const outdated = parsed.data.consents.find(
      (consent) => isLegalDocument(consent.type) && consent.version !== LEGAL_DOCUMENT_VERSIONS[consent.type]
    );
    if (outdated) {
      return reply.code(409).send({
        error: "outdated_document",
        message: "Ce document a été mis à jour. Relisez-le, puis acceptez-le à nouveau.",
      });
    }

    const userId = request.user!.id;
    const now = new Date().toISOString();

    const { error } = await fastify.supabaseAdmin.from("consents").insert(
      parsed.data.consents.map((consent) => ({
        user_id: userId,
        type: consent.type,
        granted_at: now,
        document_version: isLegalDocument(consent.type) ? LEGAL_DOCUMENT_VERSIONS[consent.type] : null,
      }))
    );

    if (error) {
      request.log.error({ error }, "Échec d'enregistrement du consentement");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    return reply.code(204).send();
  });

  // Export RGPD (droit d'accès et de portabilité) : un instantané JSON de
  // TOUTES les données personnelles de l'utilisateur. Toute nouvelle table
  // contenant des données personnelles doit être ajoutée ici (règle 10 du
  // programme) — le test tests/exportCompleteness.test.ts vérifie chaque
  // section. Si une seule lecture échoue, l'export entier échoue : un export
  // partiel présenté comme complet serait pire qu'une erreur (audit Lot Q,
  // SEC-01).
  fastify.get("/api/me/export", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;
    const db = fastify.supabaseAdmin;

    const failures: string[] = [];
    function rows<T>(section: string, result: { data: T[] | null; error: unknown }): T[] {
      if (result.error) failures.push(section);
      return result.data ?? [];
    }

    // Tables sans user_id direct (product_matches, post_tagged_pieces,
    // affiliate_conversions) : on récupère d'abord les lignes parentes de
    // l'utilisateur, puis leurs enfants par identifiant — plus simple et
    // plus sûr qu'un filtre sur une ressource jointe.
    const [searchesRes, postsRes, clicksRes] = await Promise.all([
      db.from("product_searches").select("*").eq("user_id", userId),
      db.from("posts").select("*").eq("user_id", userId),
      db.from("affiliate_clicks").select("*").eq("user_id", userId),
    ]);
    const productSearches = rows("productSearches", searchesRes);
    const posts = rows("posts", postsRes);
    const affiliateClicks = rows("affiliateClicks", clicksRes);

    const searchIds = productSearches.map((s) => s.id as string);
    const postIds = posts.map((p) => p.id as string);
    const clickIds = affiliateClicks.map((c) => c.id as string);
    const empty = Promise.resolve({ data: [] as Record<string, unknown>[], error: null });

    const [
      profileRes,
      matchesRes,
      taggedRes,
      conversionsRes,
      vaultRes,
      wishlistRes,
      followersRes,
      followingRes,
      reactionsRes,
      notificationsRes,
      blocksRes,
      reportsRes,
      commentsRes,
      consentsRes,
      exportRequestsRes,
    ] = await Promise.all([
      db.from("profiles").select("*").eq("id", userId).maybeSingle(),
      searchIds.length > 0 ? db.from("product_matches").select("*").in("search_id", searchIds) : empty,
      postIds.length > 0 ? db.from("post_tagged_pieces").select("*").in("post_id", postIds) : empty,
      clickIds.length > 0 ? db.from("affiliate_conversions").select("*").in("affiliate_click_id", clickIds) : empty,
      db.from("vault_items").select("*").eq("user_id", userId),
      db.from("wishlist_items").select("*").eq("user_id", userId),
      db.from("follows").select("follower_id, created_at").eq("followee_id", userId),
      db.from("follows").select("followee_id, created_at").eq("follower_id", userId),
      db.from("post_reactions").select("post_id, created_at").eq("user_id", userId),
      db.from("notifications").select("*").eq("user_id", userId),
      db.from("blocks").select("blocked_id, created_at").eq("blocker_id", userId),
      db.from("reports").select("*").eq("reporter_id", userId),
      db.from("comments").select("*").eq("user_id", userId),
      db.from("consents").select("*").eq("user_id", userId),
      db.from("data_export_requests").select("*").eq("user_id", userId),
    ]);

    if (profileRes.error) failures.push("profile");
    const exported = {
      exportedAt: new Date().toISOString(),
      profile: profileRes.data ?? null,
      productSearches,
      productMatches: rows("productMatches", matchesRes),
      vaultItems: rows("vaultItems", vaultRes),
      wishlistItems: rows("wishlistItems", wishlistRes),
      posts,
      postTaggedPieces: rows("postTaggedPieces", taggedRes),
      reactionsGiven: rows("reactionsGiven", reactionsRes),
      followers: rows("followers", followersRes),
      following: rows("following", followingRes),
      blockedAccounts: rows("blockedAccounts", blocksRes),
      reportsSubmitted: rows("reportsSubmitted", reportsRes),
      comments: rows("comments", commentsRes),
      notifications: rows("notifications", notificationsRes),
      affiliateClicks,
      affiliateConversions: rows("affiliateConversions", conversionsRes),
      consents: rows("consents", consentsRes),
      dataExportRequests: rows("dataExportRequests", exportRequestsRes),
    };

    if (failures.length > 0) {
      request.log.error({ failures }, "Export RGPD incomplet — échec de lecture");
      return reply.code(500).send({ error: "export_failed", message: "L'export a échoué, réessayez." });
    }

    const { error: requestLogError } = await db.from("data_export_requests").insert({
      user_id: userId,
      status: "ready",
      completed_at: new Date().toISOString(),
    });
    if (requestLogError) {
      request.log.error({ requestLogError }, "Échec d'enregistrement de la demande d'export");
    }

    return reply.send(exported);
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
