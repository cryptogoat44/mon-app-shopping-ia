// Propriété d'un résultat de recherche (product_matches) : un résultat n'a
// pas de user_id, il appartient à la personne dont la recherche parente
// (product_searches.user_id) l'a produit. Utilisée par POST /api/wishlist,
// POST /api/vault et POST /api/messages (résultat envoyé à un ami). Même
// règle que les pièces taguées d'une publication, le signalement d'une
// proposition et le clic vers le marchand (cas « sa propre recherche »), qui
// la vérifient encore chacun de leur côté.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DatabaseReadError, parseDbRows } from "./validation.js";

/** Même réponse pour un résultat inexistant ou celui d'une autre personne. */
export const PRODUCT_MATCH_NOT_FOUND = { error: "product_match_not_found", message: "Produit introuvable." } as const;

const OWN_MATCH_ROW = z.object({
  id: z.string().uuid(),
  image_url: z.string(),
  merchant_url: z.string(),
  // Alertes prix (clé « même pièce ») ; absent d'une lecture plus ancienne.
  merchant_name: z.string().nullable().optional(),
  product_searches: z.object({ user_id: z.string().uuid() }),
});

/** Un résultat d'une recherche de la personne, avec ses liens tels que la
 * recherche les a rangés (venus du fournisseur, jamais de l'app). */
export interface OwnMatch {
  id: string;
  imageUrl: string;
  merchantUrl: string;
  merchantName: string | null;
}

/** Le résultat `matchId` s'il vient d'une recherche de `userId` ; null s'il
 * n'existe pas ou vient de la recherche d'une autre personne (même réponse
 * dans les deux cas : rien à deviner). Lecture impossible : DatabaseReadError. */
export async function findOwnMatch(fastify: FastifyInstance, userId: string, matchId: string): Promise<OwnMatch | null> {
  const { data, error } = await fastify.supabaseAdmin
    .from("product_matches")
    .select("id, image_url, merchant_url, merchant_name, product_searches!inner(user_id)")
    .eq("id", matchId)
    .maybeSingle();
  if (error) throw new DatabaseReadError("Lecture d'un résultat de recherche impossible");
  if (data === null) return null;
  const row = OWN_MATCH_ROW.safeParse(data);
  if (!row.success) throw new DatabaseReadError("Résultat de recherche illisible");
  if (row.data.product_searches.user_id !== userId) return null;
  return { id: row.data.id, imageUrl: row.data.image_url, merchantUrl: row.data.merchant_url, merchantName: row.data.merchant_name ?? null };
}

const MATCH_CARD_COLUMNS = "id, search_id, product_name, brand, image_url, price_min, currency, merchant_name, merchant_url";
const MATCH_CARD_ROW = z.object({
  id: z.string().uuid(),
  search_id: z.string().uuid(),
  product_name: z.string(),
  brand: z.string().nullable(),
  image_url: z.string(),
  // numeric : un nombre, ou un texte selon le pilote de la base.
  price_min: z.union([z.string(), z.number()]).nullable(),
  currency: z.string().nullable(),
  merchant_name: z.string().nullable(),
  merchant_url: z.string(),
});
/** Un résultat tel que la recherche l'a rangé (venu du fournisseur). */
export type OwnMatchRow = z.infer<typeof MATCH_CARD_ROW>;
const SEARCH_ROWS = z.array(z.object({ id: z.string().uuid() }));

/** Le résultat `matchId`, avec ce qu'une carte de message en reprend, s'il
 * vient d'une recherche de `userId` ; null sinon (inexistant ou recherche
 * d'une autre personne : même réponse). Deux lectures simples plutôt qu'une
 * jointure. Lecture impossible : DatabaseReadError. */
export async function findOwnMatchRow(fastify: FastifyInstance, userId: string, matchId: string): Promise<OwnMatchRow | null> {
  const { data, error } = await fastify.supabaseAdmin.from("product_matches").select(MATCH_CARD_COLUMNS).eq("id", matchId).maybeSingle();
  if (error) throw new DatabaseReadError("Lecture d'un résultat de recherche impossible");
  if (data === null) return null;
  const row = MATCH_CARD_ROW.safeParse(data);
  if (!row.success) throw new DatabaseReadError("Résultat de recherche illisible");
  const searches = parseDbRows(
    SEARCH_ROWS,
    await fastify.supabaseAdmin.from("product_searches").select("id").eq("id", row.data.search_id).eq("user_id", userId).limit(1),
    "Recherche d'un résultat"
  );
  return searches.length > 0 ? row.data : null;
}
