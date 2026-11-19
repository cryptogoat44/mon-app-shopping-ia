import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FOR_YOU_OFFSETS, SUGGESTIONS_MAX, type ForYouPage, type SuggestionsResponse } from "@monapp/shared-types";
import {
  DISCOVERY_SETTING_UNAVAILABLE,
  authorProposable,
  discoveryReady,
  forYouSet,
  openlyReported,
  pageAt,
  personalize,
  proposableTo,
  readAudiences,
  readAuthorFacts,
  reportedBy,
  suggestionCandidates,
} from "../lib/forYou.js";
import { toMemberRows } from "../lib/memberRows.js";
import { shownPosts } from "../lib/visibility.js";
import { parseDbRows, parseInput } from "../lib/validation.js";
import { POST_ROWS, hydratePosts } from "./posts.js";

// Fil « Pour vous » et suggestions de comptes (lot « découverte », migration
// 0050). Le classement et ses règles : lib/forYou.ts.
// GET /api/feed (« Abonnements ») ne change pas.
// Sans 0050, les deux routes répondent 404 (« indisponible ») : sans le
// réglage « Proposer mon compte aux autres membres », personne ne pourrait
// refuser d'y figurer. L'app cache alors « Pour vous » et la rangée de
// suggestions. Sonde illisible : 500, jamais « tout le monde est proposé ».

// `offset` : une position dans la liste du membre (FOR_YOU_MAX publications
// au plus), pas le curseur par date des autres fils : cette liste n'est pas
// rangée par date. Toute autre valeur : 400.
const forYouQuerySchema = z.object({ offset: z.enum(FOR_YOU_OFFSETS.map(String) as [string, ...string[]]).optional() });
const INVALID_QUERY = { error: "invalid_query", message: "Paramètre de liste invalide." } as const;

export default async function forYouRoutes(fastify: FastifyInstance) {
  // « Pour vous » : 15 publications par page. Rien n'est enregistré de ce qui
  // est lu ; la réponse n'est gardée par aucun cache.
  fastify.get(
    "/api/feed/for-you",
    { preHandler: [fastify.requireAuth, fastify.rateLimit("forYou")], config: { rateLimitName: "forYou" as const } },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const query = parseInput(forYouQuerySchema, request.query, reply, INVALID_QUERY);
      if (!query) return;
      const offset = Number(query.offset ?? "0");
      const viewerId = request.user!.id;
      if (!(await discoveryReady(fastify))) return reply.code(404).send(DISCOVERY_SETTING_UNAVAILABLE);

      const set = (await forYouSet(fastify)).posts;
      const [audiences, reported] = await Promise.all([
        readAudiences(
          fastify,
          viewerId,
          set.map((post) => post.authorId)
        ),
        reportedBy(
          fastify,
          viewerId,
          set.map((post) => post.id)
        ),
      ]);
      const { items: pageIds, nextOffset } = pageAt(personalize(set, audiences, reported), offset);
      if (pageIds.length === 0) return reply.send({ posts: [], nextOffset } satisfies ForYouPage);

      // Le classement n'est jamais le dernier contrôle : la page est relue.
      // Une publication supprimée, masquée, plus publique, dont l'image a été
      // retirée ou qui a reçu un signalement depuis, ou dont l'auteur est passé
      // en privé, a éteint le réglage, a été suspendu ou est en blocage avec le
      // membre (lus ci-dessus, dans cette même requête), est laissée de côté :
      // la page est alors plus courte, et l'app demande la suivante.
      const rows = parseDbRows(
        POST_ROWS,
        await shownPosts(fastify, "*").in("id", pageIds).eq("privacy", "public").not("media_url", "is", null).is("media_removed_at", null),
        "Publications de « Pour vous »"
      );
      const now = Date.now();
      const [facts, stillReported] = await Promise.all([
        readAuthorFacts(fastify, [...new Set(rows.map((row) => row.user_id))]),
        openlyReported(
          fastify,
          rows.map((row) => row.id)
        ),
      ]);
      const byId = new Map(rows.map((row) => [row.id, row]));
      const fresh = pageIds.flatMap((id) => {
        const row = byId.get(id);
        if (!row || stillReported.has(id) || !proposableTo(audiences.get(row.user_id)) || !authorProposable(facts.get(row.user_id), now)) return [];
        return [row];
      });
      // Les nombres de « j'aime » et de commentaires sont ceux de ce membre (hydratePosts), jamais ceux du classement.
      const page: ForYouPage = { posts: await hydratePosts(fastify, fresh, viewerId), nextOffset };
      return reply.send(page);
    }
  );

  // Comptes à découvrir : SUGGESTIONS_MAX au plus, d'abord des comptes suivis
  // par les comptes que le membre suit, puis les comptes publics les plus
  // actifs du classement. Chaque ligne passe par LA règle des listes
  // (lib/memberRows.ts), puis : ni déjà suivi, ni demandé, ni privé, ni sans
  // le réglage « Proposer mon compte aux autres membres ».
  fastify.get(
    "/api/users/suggestions",
    { preHandler: [fastify.requireAuth, fastify.rateLimit("memberList")], config: { rateLimitName: "memberList" as const } },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const viewerId = request.user!.id;
      if (!(await discoveryReady(fastify))) return reply.code(404).send(DISCOVERY_SETTING_UNAVAILABLE);
      const set = (await forYouSet(fastify)).posts;
      const pool = await suggestionCandidates(fastify, viewerId, set);
      if (pool.length === 0) return reply.send({ members: [] } satisfies SuggestionsResponse);
      const [facts, rows] = await Promise.all([readAuthorFacts(fastify, pool), toMemberRows(fastify, viewerId, pool, { contextOwnerId: null })]);
      const members = rows
        .filter((member) => {
          const known = facts.get(member.id);
          return !member.isMe && member.followState === "none" && !member.isPrivate && known !== undefined && known.username !== null && !known.isPrivate && known.discoverable;
        })
        .slice(0, SUGGESTIONS_MAX);
      const response: SuggestionsResponse = { members };
      return reply.send(response);
    }
  );
}
