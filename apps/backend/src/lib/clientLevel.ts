import type { FastifyRequest } from "fastify";

// Niveau de vocabulaire de l'app. Les anciennes versions de l'app iPhone
// restent longtemps en circulation : le serveur n'envoie un champ ou une
// valeur qu'elles ne connaissent pas (nouveaux types de notification, état
// d'un abonnement, actions sur les messages…) qu'à une app qui dit les
// comprendre, par le paramètre `v=2` de l'adresse (ou un niveau plus élevé).
// Sans lui, la réponse garde l'ancien vocabulaire : une app plus ancienne ne
// reçoit jamais une valeur qu'elle afficherait de travers.

/** L'app qui fait cette demande comprend-elle le vocabulaire « 2 » (ou plus) ? */
export function speaksV2(request: Pick<FastifyRequest, "query">): boolean {
  const query = request.query;
  const level = typeof query === "object" && query !== null ? (query as Record<string, unknown>).v : undefined;
  return typeof level === "string" && /^\d{1,3}$/.test(level) && Number(level) >= 2;
}
