// Liens de vidéos TikTok et Instagram (mission « liens vidéo ») : reconnaître
// un lien partagé, dire ce que la mémoire collective sait de cette vidéo,
// noter un spot, confirmer une pièce, et donner à l'app le code d'intégration
// officiel d'Instagram.
//
// Le serveur ne télécharge JAMAIS une vidéo, une image ni une miniature de
// TikTok ou d'Instagram. Ses deux seuls appels sortants, ici :
// - suivre la redirection d'un lien court TikTok (lib/videoLinks.ts) ;
// - demander à Meta le code d'intégration d'une publication
//   (lib/instagramEmbed.ts).
// Toutes les routes demandent un compte connecté et ont leur limite de débit.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  VIDEO_LINK_INPUT_MAX_LENGTH,
  VIDEO_SPOT_SOURCES,
  type InstagramEmbedResponse,
  type VideoLink,
  type VideoLinksStatus,
  type VideoLookupResponse,
  type VideoProduct,
} from "@monapp/shared-types";
import { instagramEmbed } from "../lib/instagramEmbed.js";
import { GENERIC_SERVER_ERROR } from "../lib/messages.js";
import { DatabaseReadError, parseInput } from "../lib/validation.js";
import { resolveVideoLink, type ResolvedVideoLink } from "../lib/videoLinks.js";
import { confirmVideoProduct, readVideoProducts, recordVideoSpot, videoMemoryReady } from "../lib/videoMemory.js";
import { videoPlayers } from "../lib/videoPlayers.js";
import { consumeRateLimit } from "../plugins/rateLimit.js";

const INVALID_LINK = { error: "invalid_link", message: "Lien invalide." } as const;
const INVALID_BODY = { error: "invalid_body", message: "Requête invalide." } as const;
const SERVER_ERROR = { error: "internal_error", message: GENERIC_SERVER_ERROR } as const;
const NOT_A_VIDEO = { error: "not_a_video_link", message: "Ce lien n'est pas celui d'une vidéo TikTok ou Instagram." } as const;
const LINK_UNREACHABLE = { error: "link_unreachable", message: "Ce lien n'a pas pu être vérifié pour le moment. Réessayez dans un instant." } as const;
const MEMORY_UNAVAILABLE = { error: "video_memory_unavailable", message: "Les pièces déjà repérées ne sont pas encore disponibles." } as const;
const SEARCH_NOT_FOUND = { error: "search_not_found", message: "Recherche introuvable." } as const;
const SEARCH_NOT_FINISHED = { error: "search_not_finished", message: "Cette recherche n'est pas terminée." } as const;
const NO_PRODUCTS = { error: "no_products", message: "Cette recherche n'a donné aucune pièce." } as const;
const PRODUCT_NOT_FOUND = { error: "video_product_not_found", message: "Cette pièce n'a pas été repérée dans cette vidéo." } as const;
const PLAYER_OFF = { error: "player_off", message: "Le lecteur Instagram est désactivé." } as const;
const EMBED_UNAVAILABLE = { error: "embed_unavailable", message: "Cette publication ne peut pas être affichée ici." } as const;
const EMBED_BUSY = { error: "embed_busy", message: "Le lecteur Instagram est momentanément indisponible." } as const;

const urlField = z.string().min(1).max(VIDEO_LINK_INPUT_MAX_LENGTH);
const lookupQuerySchema = z.object({ url: urlField });
const spotSchema = z.strictObject({
  url: urlField,
  searchId: z.guid(),
  source: z.enum(VIDEO_SPOT_SOURCES),
  momentSeconds: z.number().int().min(0).max(86_400).nullish(),
});
const confirmSchema = z.strictObject({ url: urlField, productKey: z.string().regex(/^[0-9a-f]{64}$/) });

export default async function videoLinksRoutes(fastify: FastifyInstance) {
  /** Reconnaît le lien reçu ; un lien court TikTok fait partir un appel
   * (compté : par membre et pour tout le service), sauf réponse en mémoire. */
  function resolve(request: FastifyRequest, input: string): Promise<ResolvedVideoLink> {
    return resolveVideoLink(input, {
      beforeFetch: () => consumeRateLimit(request, "videoShortLink") && consumeRateLimit(request, "videoShortLinkGlobal"),
    });
  }

  /** La vidéo désignée par `input`, ou null après avoir répondu (lien non reconnu, ou invérifiable pour l'instant). */
  async function videoOf(request: FastifyRequest, reply: FastifyReply, input: string): Promise<VideoLink | null> {
    const resolved = await resolve(request, input);
    if (resolved.link) return resolved.link;
    const transient = resolved.issue === "unreachable" || resolved.issue === "rate_limited";
    void reply.code(transient ? 503 : 422).send(transient ? LINK_UNREACHABLE : NOT_A_VIDEO);
    return null;
  }

  // Ce qui est allumé : les deux interrupteurs des lecteurs (ils ne peuvent
  // que couper : l'app retombe alors sur l'écran de secours) et la mémoire.
  fastify.get("/api/video-links/status", { preHandler: fastify.requireAuth }, async (_request, reply) => {
    const status: VideoLinksStatus = { players: videoPlayers(), memory: await videoMemoryReady(fastify) };
    return reply.send(status);
  });

  // Un lien partagé ou collé : la vidéo reconnue, et les pièces déjà repérées
  // par d'autres membres (sans jamais dire lesquels). Un lien non reconnu
  // n'est pas une erreur : `link` est null, l'app propose la capture.
  fastify.get(
    "/api/video-links/lookup",
    { preHandler: [fastify.requireAuth, fastify.rateLimit("videoLookup")], config: { rateLimitName: "videoLookup" as const } },
    async (request, reply) => {
      const query = parseInput(lookupQuerySchema, request.query, reply, INVALID_LINK);
      if (!query) return;
      const resolved = await resolve(request, query.url);
      const players = videoPlayers();
      const memory = await videoMemoryReady(fastify);
      let products: VideoProduct[] = [];
      let memoryAvailable = memory;
      if (resolved.link && memory) {
        try {
          products = await readVideoProducts(fastify, resolved.link, request.user!.id);
        } catch (error) {
          if (!(error instanceof DatabaseReadError)) throw error;
          // La mémoire illisible ne doit jamais empêcher de spotter la vidéo.
          request.log.error({ error }, "Liens vidéo : pièces déjà repérées illisibles");
          memoryAvailable = false;
        }
      }
      const response: VideoLookupResponse = { link: resolved.link, linkIssue: resolved.link ? null : resolved.issue, players, memoryAvailable, products };
      return reply.send(response);
    }
  );

  // Le code d'intégration officiel d'une publication Instagram, pour le
  // lecteur de l'app. Lecteur coupé : 404 « player_off », aucun appel à Meta.
  fastify.get(
    "/api/video-links/instagram-embed",
    { preHandler: [fastify.requireAuth, fastify.rateLimit("videoEmbed")], config: { rateLimitName: "videoEmbed" as const } },
    async (request, reply) => {
      const query = parseInput(lookupQuerySchema, request.query, reply, INVALID_LINK);
      if (!query) return;
      if (!videoPlayers().instagram) return reply.code(404).send(PLAYER_OFF);
      const link = await videoOf(request, reply, query.url);
      if (!link) return;
      if (link.platform !== "instagram") return reply.code(422).send(NOT_A_VIDEO);
      const embed = await instagramEmbed(link);
      if (!embed.ok) {
        request.log.info({ issue: embed.issue }, "Liens vidéo : code d'intégration Instagram indisponible");
        return embed.issue === "unavailable" ? reply.code(404).send(EMBED_UNAVAILABLE) : reply.code(503).send(EMBED_BUSY);
      }
      const response: InstagramEmbedResponse = { html: embed.html, creatorHandle: embed.creatorHandle };
      return reply.send(response);
    }
  );

  // Après une recherche réussie sur une image de cette vidéo : le spot est
  // noté (une fois par recherche). Refusé à un compte suspendu : il change ce
  // que les autres membres voient.
  fastify.post(
    "/api/video-links/spots",
    { preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("videoSpot")], config: { rateLimitName: "videoSpot" as const } },
    async (request, reply) => {
      const body = parseInput(spotSchema, request.body, reply, INVALID_BODY);
      if (!body) return;
      if (!(await videoMemoryReady(fastify))) return reply.code(404).send(MEMORY_UNAVAILABLE);
      const link = await videoOf(request, reply, body.url);
      if (!link) return;
      try {
        const outcome = await recordVideoSpot(fastify, {
          userId: request.user!.id,
          link,
          searchId: body.searchId,
          source: body.source,
          momentSeconds: body.momentSeconds ?? null,
        });
        if (outcome === "search_not_found") return reply.code(404).send(SEARCH_NOT_FOUND);
        if (outcome === "search_not_finished") return reply.code(409).send(SEARCH_NOT_FINISHED);
        if (outcome === "no_products") return reply.code(422).send(NO_PRODUCTS);
        request.log.info({ outcome, platform: link.platform, source: body.source }, "Liens vidéo : spot noté");
        return reply.send({ recorded: true });
      } catch (error) {
        if (!(error instanceof DatabaseReadError)) throw error;
        request.log.error({ error }, "Liens vidéo : spot non enregistré");
        return reply.code(500).send(SERVER_ERROR);
      }
    }
  );

  // « C'est bien cette pièce » : une fois par membre, par vidéo et par pièce.
  fastify.post(
    "/api/video-links/confirm",
    { preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("videoConfirm")], config: { rateLimitName: "videoConfirm" as const } },
    async (request, reply) => {
      const body = parseInput(confirmSchema, request.body, reply, INVALID_BODY);
      if (!body) return;
      if (!(await videoMemoryReady(fastify))) return reply.code(404).send(MEMORY_UNAVAILABLE);
      const link = await videoOf(request, reply, body.url);
      if (!link) return;
      try {
        const outcome = await confirmVideoProduct(fastify, request.user!.id, link, body.productKey);
        if (outcome === "unknown_video" || outcome === "unknown_product") return reply.code(404).send(PRODUCT_NOT_FOUND);
        return reply.send({ confirmed: true });
      } catch (error) {
        if (!(error instanceof DatabaseReadError)) throw error;
        request.log.error({ error }, "Liens vidéo : confirmation non enregistrée");
        return reply.code(500).send(SERVER_ERROR);
      }
    }
  );
}
