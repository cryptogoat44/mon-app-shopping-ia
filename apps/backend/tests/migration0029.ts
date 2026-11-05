import type { FastifyInstance } from "fastify";

/** La migration 0029 (lot garde-fous) est-elle appliquée sur la base des
 * tests ? Avec elle, une recherche en panne ne compte plus dans la part du
 * jour de la personne (serpapi_quota) ; sans elle, si. Les tests avec la base
 * acceptent les deux, tant que 0029 n'est pas sur spotto-dev-2. */
export async function migration0029Applied(app: FastifyInstance): Promise<boolean> {
  const { error } = await app.supabaseAdmin.from("ai_calls").select("id").limit(0);
  return !error;
}
