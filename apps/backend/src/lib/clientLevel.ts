import type { FastifyRequest } from "fastify";

// Niveau de vocabulaire de l'app. Les anciennes versions de l'app iPhone
// restent longtemps en circulation : le serveur n'envoie un champ ou une
// valeur qu'elles ne connaissent pas qu'à une app qui dit les comprendre, par
// le paramètre `v=2` de l'adresse. Sans lui, la réponse garde l'ancien
// vocabulaire.

/** L'app qui fait cette demande comprend-elle le vocabulaire « 2 » (ou plus) ? */
export function speaksV2(request: Pick<FastifyRequest, "query">): boolean {
  const query = request.query;
  const level = typeof query === "object" && query !== null ? (query as Record<string, unknown>).v : undefined;
  return typeof level === "string" && /^\d{1,3}$/.test(level) && Number(level) >= 2;
}
