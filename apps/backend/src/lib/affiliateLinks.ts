import type { FastifyInstance } from "fastify";

/** Un lien affilié par product_match. Renvoie une table de correspondance
 * plutôt qu'un tableau pour un accès direct par id lors de la construction
 * d'une réponse (recherches, publications...). */
export async function fetchAffiliateUrls(fastify: FastifyInstance, matchIds: string[]): Promise<Map<string, string>> {
  if (matchIds.length === 0) return new Map();

  const { data, error } = await fastify.supabaseAdmin
    .from("affiliate_links")
    .select("product_match_id, affiliate_url")
    .in("product_match_id", matchIds);

  if (error || !data) {
    fastify.log.error({ error }, "Échec de lecture des liens affiliés");
    return new Map();
  }

  return new Map(
    (data as { product_match_id: string; affiliate_url: string }[]).map((l) => [l.product_match_id, l.affiliate_url])
  );
}

/** « Lien affilié » : une seule règle côté serveur, la même que dans l'app
 * (apps/mobile/src/lib/affiliate-link.ts). Un lien n'est affilié que s'il
 * diffère du lien du marchand : la mention accompagne alors la pièce
 * (`isAffiliate`) partout où le serveur ne renvoie que le lien à ouvrir. */
export function isAffiliateLink(affiliateUrl: string | null | undefined, merchantUrl: string | null): boolean {
  return affiliateUrl != null && affiliateUrl !== merchantUrl;
}
