import type { FastifyInstance } from "fastify";
import { voieCEnabled } from "../lib/aiSwitches.js";
import { speaksV2 } from "../lib/clientLevel.js";
import { logQuotaSettings } from "../lib/memberQuotas.js";
import { readSearchCounts } from "../lib/searchCapacity.js";
import { callsPerPhoto, capacityForOlderApp, capacityStatus } from "../lib/searchCapacityStatus.js";

// Lot limites annoncées (2026-11-03) : le compteur des recherches, lu AVANT
// l'effort (accueil du Spotter, écran de cadrage) au lieu d'être découvert
// après « Lancer ». Une simple lecture de serpapi_quota (p_reserve = false) :
// aucune place réservée, aucun appel au fournisseur, aucun coût. Ne renvoie
// que la part de la personne qui demande et l'état du service, jamais les
// compteurs du service ni rien sur les autres comptes.
// Lot quotas (0053) : aussi sa part du mois (monthlyQuota ; null quand elle
// n'en a pas : abonné sans garde-fou), jamais rien de son droit d'abonnement.
// Une app plus ancienne (sans `v=2`) ignore monthlyQuota : sa part du mois
// épuisée lui est annoncée comme la pause du mois (capacityForOlderApp).

export const CAPACITY_UNREADABLE = {
  error: "search_capacity_unreadable",
  message: "Le compteur de recherches est momentanément illisible.",
} as const;

export default async function searchCapacityRoutes(fastify: FastifyInstance) {
  // Réglages des quotas lus une fois au démarrage : une valeur invalide est ignorée, et dite ici.
  logQuotaSettings(fastify.log);
  fastify.get(
    "/api/searches/capacity",
    {
      preHandler: [fastify.requireAuth, fastify.rateLimit("searchCapacityRead")],
      config: { rateLimitName: "searchCapacityRead" },
    },
    async (request, reply) => {
      // Base injoignable ou réponse illisible : l'app n'affiche rien et ne bloque rien.
      const counts = await readSearchCounts(fastify, request.log, request.user!.id).catch(() => null);
      if (!counts) return reply.code(503).send(CAPACITY_UNREADABLE);
      // Le compteur change à chaque recherche : jamais servi depuis un cache.
      reply.header("Cache-Control", "no-store");
      const status = capacityStatus(counts.row, counts.caps, callsPerPhoto(voieCEnabled()), new Date(), counts.tier);
      // Une app d'avant le lot quotas (sans `v=2`) ne lit pas monthlyQuota : sa part du mois épuisée lui est dite autrement.
      return reply.send(speaksV2(request) ? status : capacityForOlderApp(status));
    }
  );
}
