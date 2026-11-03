// Propriété d'un résultat de recherche (product_matches) : un résultat n'a
// pas de user_id, il appartient à la personne dont la recherche parente
// (product_searches.user_id) l'a produit. Utilisée par POST /api/wishlist et
// POST /api/vault. Même règle que les pièces taguées d'une publication, le
// signalement d'une proposition et le clic vers le marchand (cas « sa propre
// recherche »), qui la vérifient encore chacun de leur côté.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DatabaseReadError } from "./validation.js";

const OWN_MATCH_ROW = z.object({
  id: z.string().uuid(),
  image_url: z.string(),
  merchant_url: z.string(),
  product_searches: z.object({ user_id: z.string().uuid() }),
});

/** Un résultat d'une recherche de la personne, avec ses liens tels que la
 * recherche les a rangés (venus du fournisseur, jamais de l'app). */
export interface OwnMatch {
  id: string;
  imageUrl: string;
  merchantUrl: string;
}

/** Le résultat `matchId` s'il vient d'une recherche de `userId` ; null s'il
 * n'existe pas ou vient de la recherche d'une autre personne (même réponse
 * dans les deux cas : rien à deviner). Lecture impossible : DatabaseReadError. */
export async function findOwnMatch(fastify: FastifyInstance, userId: string, matchId: string): Promise<OwnMatch | null> {
  const { data, error } = await fastify.supabaseAdmin
    .from("product_matches")
    .select("id, image_url, merchant_url, product_searches!inner(user_id)")
    .eq("id", matchId)
    .maybeSingle();
  if (error) throw new DatabaseReadError("Lecture d'un résultat de recherche impossible");
  if (data === null) return null;
  const row = OWN_MATCH_ROW.safeParse(data);
  if (!row.success) throw new DatabaseReadError("Résultat de recherche illisible");
  if (row.data.product_searches.user_id !== userId) return null;
  return { id: row.data.id, imageUrl: row.data.image_url, merchantUrl: row.data.merchant_url };
}
