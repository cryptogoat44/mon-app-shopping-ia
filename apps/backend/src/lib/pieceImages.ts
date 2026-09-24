import type { FastifyInstance } from "fastify";

// Image haute définition des pièces gardées (Vault, Envies) — Lot S2.
// Rien n'est copié : on retrouve l'image HD du marchand enregistrée avec la
// pièce identifiée d'origine (product_matches.image_hd_url). Seulement si la
// pièce affiche toujours l'image de ce résultat : une photo personnelle
// (« Changer la photo », ajout à la main) n'est jamais remplacée.
export async function fetchHdImageUrls(
  fastify: FastifyInstance,
  rows: { product_match_id: string | null; image_url: string }[]
): Promise<(string | null)[]> {
  const matchIds = [...new Set(rows.map((row) => row.product_match_id).filter((id): id is string => id !== null))];
  if (matchIds.length === 0) return rows.map(() => null);

  const { data, error } = await fastify.supabaseAdmin
    .from("product_matches")
    .select("id, image_url, image_hd_url")
    .in("id", matchIds);
  if (error || !data) {
    fastify.log.error({ error }, "Échec de lecture des images HD des pièces gardées");
    return rows.map(() => null);
  }

  const byId = new Map((data as { id: string; image_url: string; image_hd_url: string | null }[]).map((m) => [m.id, m]));
  return rows.map((row) => {
    const match = row.product_match_id ? byId.get(row.product_match_id) : undefined;
    return match && match.image_url === row.image_url ? match.image_hd_url : null;
  });
}
