import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { FollowResponse, MemberPage } from "@monapp/shared-types";
import { PRIVATE_ACCOUNTS_UNAVAILABLE, privateAccountsReady, readAudienceOf } from "../lib/audience.js";
import { speaksV2 } from "../lib/clientLevel.js";
import { toMemberRows } from "../lib/memberRows.js";
import { GENERIC_SERVER_ERROR } from "../lib/messages.js";
import { notify } from "../lib/notify.js";
import { RATE_LIMITS } from "../lib/rateLimits.js";
import { consumeRateLimitFor } from "../plugins/rateLimit.js";
import { INVALID_CURSOR, INVALID_ID, cursorQuerySchema, parseDbRows, parseInput, userIdParamsSchema } from "../lib/validation.js";

// Abonnements, et demandes d'abonnement aux comptes privés (lot « vie
// sociale », migration 0045). Compte public : on s'abonne tout de suite,
// comme avant. Compte privé : une demande, que son propriétaire accepte ou
// refuse ; tant qu'elle attend, elle ne donne AUCUN accès. Un refus n'est pas
// annoncé et ne laisse aucune trace : le bouton redevient « Suivre ».

const REQUESTS_PAGE_SIZE = 30;

const INTERNAL_ERROR = { error: "internal_error", message: GENERIC_SERVER_ERROR } as const;
const REQUEST_NOT_FOUND = { error: "request_not_found", message: "Demande introuvable." } as const;
/** Une app d'avant le lot « vie sociale » afficherait « Abonné » : rien n'est écrit. */
const UPDATE_REQUIRED = {
  error: "private_account_update_required",
  message: "Ce compte est privé. Mettez à jour l'app pour demander à le suivre.",
} as const;

const REQUEST_ROWS = z.array(z.object({ requester_id: z.guid(), created_at: z.string() }));

export default async function followsRoutes(fastify: FastifyInstance) {
  const db = () => fastify.supabaseAdmin;

  /** La demande de `requesterId` auprès de `targetId` et sa notification. Rend false si l'effacement échoue. */
  async function eraseRequest(requesterId: string, targetId: string): Promise<boolean> {
    const erased = await db().from("follow_requests").delete().eq("requester_id", requesterId).eq("target_id", targetId);
    const notified = await db().from("notifications").delete().eq("type", "follow_request").eq("user_id", targetId).eq("actor_id", requesterId);
    return !erased.error && !notified.error;
  }

  /** Réponse d'un abonnement : l'état pour une app récente, rien (204) pour les autres, comme avant. */
  function answer(reply: FastifyReply, v2: boolean, state: FollowResponse["state"]) {
    if (!v2) return reply.code(204).send();
    const body: FollowResponse = { state };
    return reply.send(body);
  }

  fastify.post(
    "/api/follows/:userId",
    {
      preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("follow")],
      config: { rateLimitName: "follow" },
    },
    async (request, reply) => {
      const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
      if (!params) return;
      const followeeId = params.userId;
      const followerId = request.user!.id;
      const v2 = speaksV2(request);

      if (followeeId === followerId) {
        return reply.code(400).send({ error: "invalid_target", message: "Impossible de se suivre soi-même." });
      }

      const { data: target } = await db().from("profiles").select("id").eq("id", followeeId).single();
      if (!target) {
        return reply.code(404).send({ error: "user_not_found", message: "Profil introuvable." });
      }

      // Blocage (dans un sens ou dans l'autre), abonnement déjà là, compte
      // privé, demande déjà en attente : une seule lecture groupée.
      const link = await readAudienceOf(fastify, followerId, followeeId, { suspended: false });
      if (link.blocked) {
        return reply.code(403).send({ error: "blocked", message: "Action impossible entre ces deux comptes." });
      }
      // Déjà abonné (pour un compte privé : déjà accepté) : rien à refaire.
      if (link.follows) return answer(reply, v2, "following");

      if (link.isPrivate) {
        if (!v2) return reply.code(403).send(UPDATE_REQUIRED);
        if (link.requested) return answer(reply, v2, "requested");
        // Demandes répétées au même compte : 2 par 24 heures au plus.
        const limit = consumeRateLimitFor(`${followerId}:${followeeId}`, "followRequestPair");
        if (!limit.allowed) {
          const rule = RATE_LIMITS.followRequestPair;
          reply.header("Retry-After", Math.ceil(limit.retryAfterMs / 1000).toString());
          return reply.code(429).send({ error: rule.error, message: rule.message });
        }
        const { error } = await db().from("follow_requests").insert({ requester_id: followerId, target_id: followeeId });
        // 23505 : la même demande, arrivée deux fois en même temps.
        if (error && (error as { code?: string }).code !== "23505") {
          request.log.error({ error }, "Échec de la demande d'abonnement");
          return reply.code(500).send(INTERNAL_ERROR);
        }
        if (!error) {
          // Jamais deux notifications pour la même demande : une ancienne, restée par erreur, est retirée d'abord.
          await db().from("notifications").delete().eq("type", "follow_request").eq("user_id", followeeId).eq("actor_id", followerId);
          await notify(fastify, request.log, { recipientId: followeeId, actorId: followerId, type: "follow_request" });
        }
        return answer(reply, v2, "requested");
      }

      const { error } = await db()
        .from("follows")
        .upsert({ follower_id: followerId, followee_id: followeeId }, { onConflict: "follower_id,followee_id" });

      if (error) {
        request.log.error({ error }, "Échec de l'abonnement");
        return reply.code(500).send(INTERNAL_ERROR);
      }

      // Uniquement pour un nouvel abonnement — pas de spam si l'utilisateur
      // suit/désabonne/suit à nouveau dans la foulée.
      await notify(fastify, request.log, { recipientId: followeeId, actorId: followerId, type: "follow" });
      // Compte redevenu public entre-temps : une demande restée en attente n'a plus lieu d'être.
      if (await privateAccountsReady(fastify)) await eraseRequest(followerId, followeeId);

      return answer(reply, v2, "following");
    }
  );

  // Ne plus suivre, ou annuler sa demande en attente (et sa notification).
  fastify.delete("/api/follows/:userId", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const followeeId = params.userId;
    const followerId = request.user!.id;

    const { error } = await db().from("follows").delete().eq("follower_id", followerId).eq("followee_id", followeeId);
    const erased = (await privateAccountsReady(fastify)) ? await eraseRequest(followerId, followeeId) : true;

    if (error || !erased) {
      request.log.error({ error }, "Échec du désabonnement");
      return reply.code(500).send(INTERNAL_ERROR);
    }

    return reply.code(204).send();
  });

  // Demandes reçues, les plus récentes d'abord. Jamais un compte en blocage,
  // suspendu ou sans nom d'utilisateur (lib/memberRows.ts) : une page peut
  // donc être plus courte que prévu, seul `nextCursor` dit s'il y a une suite.
  fastify.get("/api/follow-requests", { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!(await privateAccountsReady(fastify))) return reply.code(404).send(PRIVATE_ACCOUNTS_UNAVAILABLE);
    const pageQuery = parseInput(cursorQuerySchema, request.query, reply, INVALID_CURSOR);
    if (!pageQuery) return;
    const userId = request.user!.id;

    let query = db()
      .from("follow_requests")
      .select("requester_id, created_at")
      .eq("target_id", userId)
      .order("created_at", { ascending: false })
      .limit(REQUESTS_PAGE_SIZE + 1);
    if (pageQuery.cursor) query = query.lt("created_at", pageQuery.cursor);
    const rows = parseDbRows(REQUEST_ROWS, await query, "Demandes d'abonnement reçues");
    const hasMore = rows.length > REQUESTS_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, REQUESTS_PAGE_SIZE) : rows;

    const page: MemberPage = {
      members: await toMemberRows(
        fastify,
        userId,
        pageRows.map((row) => row.requester_id),
        { contextOwnerId: userId }
      ),
      nextCursor: hasMore ? (pageRows.at(-1)?.created_at ?? null) : null,
    };
    return reply.send(page);
  });

  // Accepter : la personne devient abonnée, la demande et sa notification
  // disparaissent, elle est prévenue. Refusé à un compte suspendu, comme « suivre ».
  fastify.post("/api/follow-requests/:userId/accept", { preHandler: [fastify.requireAuth, fastify.requireActiveAccount] }, async (request, reply) => {
    if (!(await privateAccountsReady(fastify))) return reply.code(404).send(PRIVATE_ACCOUNTS_UNAVAILABLE);
    const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const requesterId = params.userId;
    const userId = request.user!.id;

    const pending = await db().from("follow_requests").select("requester_id").eq("requester_id", requesterId).eq("target_id", userId).maybeSingle();
    if (pending.error) {
      request.log.error({ error: pending.error }, "Échec de lecture d'une demande d'abonnement");
      return reply.code(500).send(INTERNAL_ERROR);
    }
    if (!pending.data) return reply.code(404).send(REQUEST_NOT_FOUND);
    // Un blocage efface les demandes (routes/blocks.ts) ; vérifié quand même :
    // jamais un abonnement entre deux comptes en blocage.
    if ((await readAudienceOf(fastify, userId, requesterId, { suspended: false, requested: false })).blocked) {
      await eraseRequest(requesterId, userId);
      return reply.code(404).send(REQUEST_NOT_FOUND);
    }

    const { error } = await db()
      .from("follows")
      .upsert({ follower_id: requesterId, followee_id: userId }, { onConflict: "follower_id,followee_id" });
    if (error) {
      request.log.error({ error }, "Échec de l'acceptation d'une demande d'abonnement");
      return reply.code(500).send(INTERNAL_ERROR);
    }
    if (!(await eraseRequest(requesterId, userId))) request.log.warn("Demande d'abonnement acceptée, mais restée dans la liste");
    await notify(fastify, request.log, { recipientId: requesterId, actorId: userId, type: "follow_accepted" });
    return reply.code(204).send();
  });

  // Refuser : la demande et sa notification sont effacées, rien d'autre. La
  // personne n'est pas prévenue et rien n'est gardé du refus. Même réponse
  // qu'il y ait eu une demande ou non. Permis à un compte suspendu : on ne
  // fait que retirer quelque chose.
  fastify.delete("/api/follow-requests/:userId", { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!(await privateAccountsReady(fastify))) return reply.code(404).send(PRIVATE_ACCOUNTS_UNAVAILABLE);
    const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    if (!(await eraseRequest(params.userId, request.user!.id))) {
      request.log.error("Échec du refus d'une demande d'abonnement");
      return reply.code(500).send(INTERNAL_ERROR);
    }
    return reply.code(204).send();
  });
}
