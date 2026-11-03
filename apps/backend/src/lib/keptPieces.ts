// Pièces déjà gardées par une personne (lot « Retrouver ses pièces ») : dans
// ses Envies (wishlist_items) ou dans son Vault (vault_items), reliées à une
// proposition du Spotter par product_match_id. Toujours filtré sur la
// personne : rien ne dit jamais ce que d'autres ont gardé.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { chunks } from "./pagedReads.js";

const KEPT_ROWS = z.array(z.object({ product_match_id: z.string().uuid().nullable() }));

/** Parmi `matchIds`, les propositions que `userId` a déjà dans `table`.
 * « Gardée » et « Ajoutée au Vault » ne sont qu'un repère : lecture
 * impossible, aucun repère (journalisé) plutôt qu'un résultat en erreur ;
 * un second ajout au Vault reste de toute façon sans doublon (POST /api/vault). */
export async function keptMatchIds(
  fastify: FastifyInstance,
  table: "wishlist_items" | "vault_items",
  userId: string,
  matchIds: readonly string[]
): Promise<string[]> {
  const kept = new Set<string>();
  for (const part of chunks(matchIds)) {
    const { data, error } = await fastify.supabaseAdmin
      .from(table)
      .select("product_match_id")
      .eq("user_id", userId)
      .in("product_match_id", part);
    const rows = KEPT_ROWS.safeParse(data);
    if (error || !rows.success) {
      fastify.log.error({ error, table }, "Échec de lecture des pièces déjà gardées");
      return [];
    }
    for (const row of rows.data) if (row.product_match_id) kept.add(row.product_match_id);
  }
  return [...kept];
}
