import type { FastifyInstance } from "fastify";

// Conservation de l'historique des recherches (décision du fondateur,
// 2026-09-25) : 12 mois, puis suppression. Pas de tâche programmée : à
// chaque nouvelle recherche d'un utilisateur, ses recherches de plus de
// 12 mois sont supprimées — avec, par cascade en base, leurs propositions
// (product_matches), les liens marchands et les clics qui en dépendent.
//
// Exception : une recherche dont une proposition est GARDÉE (Vault, Envies,
// pièce taguée dans une publication) n'est plus de l'historique ; elle est
// conservée tant que la pièce l'est. Sinon, la pièce taguée disparaîtrait
// de la publication et le Vault / les Envies perdraient l'image HD et le
// lien vers la pièce d'origine.

export const SEARCH_RETENTION_MONTHS = 12;
const CHUNK = 100; // taille des listes d'identifiants envoyées à la base

export function retentionCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - SEARCH_RETENTION_MONTHS);
  return cutoff;
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

async function idsWhere(
  fastify: FastifyInstance,
  table: "vault_items" | "wishlist_items" | "post_tagged_pieces",
  matchIds: string[]
): Promise<Set<string>> {
  const kept = new Set<string>();
  for (const part of chunks(matchIds)) {
    const { data, error } = await fastify.supabaseAdmin.from(table).select("product_match_id").in("product_match_id", part);
    if (error) throw new Error(`Lecture de ${table} impossible`);
    for (const row of data ?? []) if (row.product_match_id) kept.add(row.product_match_id as string);
  }
  return kept;
}

/** Supprime les recherches de l'utilisateur de plus de 12 mois (sauf celles
 * dont une pièce est gardée). Renvoie le nombre de recherches supprimées.
 * Lève une erreur si la base ne répond pas. Chaque recherche est supprimée
 * d'un bloc avec ce qui en dépend (cascade en base) : jamais à moitié. */
export async function purgeExpiredSearches(fastify: FastifyInstance, userId: string, now = new Date()): Promise<number> {
  const db = fastify.supabaseAdmin;
  const { data: expired, error } = await db
    .from("product_searches")
    .select("id")
    .eq("user_id", userId)
    .lt("created_at", retentionCutoff(now).toISOString());
  if (error) throw new Error("Lecture des recherches expirées impossible");
  const expiredIds = (expired ?? []).map((row) => row.id as string);
  if (expiredIds.length === 0) return 0;

  // Propositions de ces recherches, puis celles qui sont gardées quelque part.
  const matchesBySearch = new Map<string, string>();
  for (const part of chunks(expiredIds)) {
    const { data, error: matchesError } = await db.from("product_matches").select("id, search_id").in("search_id", part);
    if (matchesError) throw new Error("Lecture des propositions impossible");
    for (const row of data ?? []) matchesBySearch.set(row.id as string, row.search_id as string);
  }
  const matchIds = [...matchesBySearch.keys()];
  const keptMatches = new Set<string>();
  if (matchIds.length > 0) {
    for (const table of ["vault_items", "wishlist_items", "post_tagged_pieces"] as const) {
      for (const id of await idsWhere(fastify, table, matchIds)) keptMatches.add(id);
    }
  }
  const keptSearches = new Set([...keptMatches].map((matchId) => matchesBySearch.get(matchId)));
  const toDelete = expiredIds.filter((id) => !keptSearches.has(id));

  for (const part of chunks(toDelete)) {
    const { error: deleteError } = await db.from("product_searches").delete().eq("user_id", userId).in("id", part);
    if (deleteError) throw new Error("Suppression des recherches expirées impossible");
  }
  return toDelete.length;
}
