import type { FastifyRequest } from "fastify";

// Niveau de l'app qui appelle. Une app récente ajoute « v=2 » à l'adresse
// des routes dont la réponse a gagné du vocabulaire (nouveaux types de
// notification, état d'un abonnement…). Sans ce paramètre, le serveur répond
// avec l'ancien vocabulaire : une app plus ancienne ne reçoit jamais une
// valeur qu'elle afficherait de travers.

/** Vrai si l'app a demandé le nouveau vocabulaire (paramètre d'adresse « v=2 »). */
export function speaksV2(request: Pick<FastifyRequest, "query">): boolean {
  const query = request.query;
  return typeof query === "object" && query !== null && (query as Record<string, unknown>).v === "2";
}
