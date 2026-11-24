// « Récemment spottées » en entier (retours du build 2, lot « historique ») :
// GET /api/searches reçoit deux paramètres FACULTATIFS, `before` (la suite de
// l'historique, plus ancienne que cette date) et `q` (une recherche dans
// l'historique, 2 à 60 caractères). Une app qui n'envoie que `limit` passe
// par l'ancien chemin, inchangé (routes/searches.ts).
//
// Vie privée : les mots de `q` servent seulement à filtrer l'historique de la
// personne qui les tape (ses propres recherches, filtre user_id). Ils ne sont
// ni enregistrés ni écrits dans les journaux : le journal ne note que la route
// déclarée (lib/logPrivacy.ts), une erreur n'y laisse que son code, et rien
// ici ne les passe au journal. Les anciens textes tapés (colonne `query`,
// avant le 27 octobre 2026) ne sont PAS fouillés : seuls le nom de la pièce,
// sa marque et sa boutique le sont.
//
// Une recherche n'apparaît qu'avec une proposition encore montrée (boutiques
// douteuses : keptMatchRows juge toutes les propositions de la recherche
// ensemble). Avec `q`, c'est la PREMIÈRE proposition gardée qui correspond aux
// mots, pas forcément la meilleure : l'app la met en grand à la réouverture.
//
// Lectures complètes (lib/pagedReads.ts) : listes d'identifiants par paquets,
// chaque lecture de propositions lue en entier (« Max rows » de Supabase).
// Les mots tapés ne quittent JAMAIS notre serveur : aucune lecture de la base
// ne les porte (pas de filtre `ilike`, qui les mettrait dans l'adresse de la
// demande et donc dans les journaux de Supabase). Les propositions sont lues
// par identifiant de recherche, et le tri se fait ici (matchesHistoryQuery),
// sur les propositions gardées seulement.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { chunks, readAll } from "./pagedReads.js";
import { keptMatchRows, parseMatchRows, parseSearchRows, type MatchRow, type SearchRow } from "./searchRows.js";
import { DatabaseReadError } from "./validation.js";

export const HISTORY_QUERY_MIN = 2;
export const HISTORY_QUERY_MAX = 60;

/** Paramètres de GET /api/searches. `before` : date ISO avec fuseau (celle
 * que la réponse donne dans `createdAt`). `q` : les blancs autour retirés,
 * 2 à 60 caractères, sans caractère de contrôle. */
export const recentSearchesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
  before: z.iso.datetime({ offset: true }).optional(),
  q: z
    .string()
    .trim()
    .min(HISTORY_QUERY_MIN)
    .max(HISTORY_QUERY_MAX)
    .regex(/^[^\u0000-\u001f\u007f]+$/)
    .optional(),
});

/** Recherches lues à la fois pour chercher dans l'historique (identifiants seulement). */
export const HISTORY_SCAN_BATCH = 100;
/** Au plus tant de recherches parcourues par demande (12 mois d'historique
 * dépassent rarement quelques centaines) : au-delà, la page s'arrête là. */
export const HISTORY_SCAN_MAX = 5000;
/** Suite de l'historique sans `q` : au plus tant de lectures de `limit`
 * recherches pour remplir une page (des recherches sans proposition montrée). */
const PAGE_SCAN_ROUNDS = 5;
/** Recherches dont on relit toutes les propositions d'un coup. */
const MATCH_READ_CHUNK = 20;

/** La recherche exacte : les mots se trouvent, sans tenir compte de la
 * casse, dans le nom de la pièce, sa marque ou sa boutique. */
export function matchesHistoryQuery(match: Pick<MatchRow, "product_name" | "brand" | "merchant_name">, q: string): boolean {
  const needle = q.toLowerCase();
  return [match.product_name, match.brand, match.merchant_name].some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
}

/** Une ligne de l'historique : la recherche et la proposition à montrer. */
export interface HistoryEntry {
  row: SearchRow;
  match: MatchRow;
}

const SEARCH_REFS = z.array(z.object({ id: z.string(), created_at: z.string() }));

/** Toutes les propositions de ces recherches, par rang (lecture complète). */
async function allMatches(fastify: FastifyInstance, searchIds: readonly string[]): Promise<Map<string, MatchRow[]>> {
  const bySearch = new Map<string, MatchRow[]>();
  for (const part of chunks(searchIds, MATCH_READ_CHUNK)) {
    const rows = await readAll(
      "Historique : propositions",
      () => fastify.supabaseAdmin.from("product_matches").select("*", { count: "exact" }).in("search_id", part),
      ["search_id", "rank", "id"]
    );
    const matches = parseMatchRows(rows);
    if (!matches) throw new DatabaseReadError("Historique : propositions illisibles");
    for (const match of matches) bySearch.set(match.search_id, [...(bySearch.get(match.search_id) ?? []), match]);
  }
  for (const list of bySearch.values()) list.sort((a, b) => a.rank - b.rank);
  return bySearch;
}

/** Recherches réussies de la personne, des plus récentes aux plus anciennes,
 * plus anciennes que `before` s'il est donné. */
function completedSearches(fastify: FastifyInstance, userId: string, columns: string, before: string | undefined, limit: number) {
  let query = fastify.supabaseAdmin.from("product_searches").select(columns).eq("user_id", userId).eq("status", "completed");
  if (before) query = query.lt("created_at", before);
  return query.order("created_at", { ascending: false }).limit(limit);
}

/** La suite de l'historique (`before`, sans `q`) : la meilleure proposition
 * gardée de chaque recherche, comme l'ancien chemin, `limit` lignes au plus. */
async function historyPage(fastify: FastifyInstance, userId: string, limit: number, before: string | undefined): Promise<HistoryEntry[]> {
  const entries: HistoryEntry[] = [];
  let cursor = before;
  for (let round = 0; round < PAGE_SCAN_ROUNDS && entries.length < limit; round += 1) {
    const { data, error } = await completedSearches(fastify, userId, "*", cursor, limit);
    if (error) throw new DatabaseReadError("Historique : recherches illisibles");
    const rows = parseSearchRows(data);
    if (!rows) throw new DatabaseReadError("Historique : recherches illisibles");
    const matches = await allMatches(
      fastify,
      rows.map((row) => row.id)
    );
    for (const row of rows) {
      const top = keptMatchRows(matches.get(row.id) ?? [])[0];
      if (top && entries.length < limit) entries.push({ row, match: top });
    }
    // Une lecture plus courte que demandé n'est pas la fin (« Max rows ») : seule une lecture vide l'est.
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.created_at;
  }
  return entries;
}

/** Une recherche dans l'historique (`q`, et `before` pour la suite). */
async function historySearch(fastify: FastifyInstance, userId: string, limit: number, before: string | undefined, q: string): Promise<HistoryEntry[]> {
  const entries: HistoryEntry[] = [];
  let cursor = before;
  for (let scanned = 0; scanned < HISTORY_SCAN_MAX && entries.length < limit; ) {
    const { data, error } = await completedSearches(fastify, userId, "id, created_at", cursor, HISTORY_SCAN_BATCH);
    if (error) throw new DatabaseReadError("Historique : recherches illisibles");
    const parsed = SEARCH_REFS.safeParse(data ?? []);
    if (!parsed.success) throw new DatabaseReadError("Historique : recherches illisibles");
    const batch = parsed.data;
    scanned += batch.length;
    // Une lecture plus courte que demandé n'est pas la fin (« Max rows ») : seule une lecture vide l'est.
    if (batch.length === 0) break;

    // Les propositions lues par identifiant (sans les mots) ; dans l'ordre de
    // l'historique, la première proposition GARDÉE qui correspond, ici.
    const ids = batch.map((ref) => ref.id);
    const matches = await allMatches(fastify, ids);
    const hits = new Map<string, MatchRow>();
    for (const id of ids) {
      const hit = keptMatchRows(matches.get(id) ?? []).find((match) => matchesHistoryQuery(match, q));
      if (hit) hits.set(id, hit);
    }
    const candidates = ids.filter((id) => hits.has(id));

    for (const part of chunks(candidates, MATCH_READ_CHUNK)) {
      if (entries.length >= limit) break;
      const { data: searchData, error: searchError } = await fastify.supabaseAdmin.from("product_searches").select("*").in("id", part).eq("user_id", userId);
      if (searchError) throw new DatabaseReadError("Historique : recherches illisibles");
      const rows = parseSearchRows(searchData);
      if (!rows) throw new DatabaseReadError("Historique : recherches illisibles");
      const rowById = new Map(rows.map((row) => [row.id, row]));
      for (const id of part) {
        const row = rowById.get(id);
        const hit = hits.get(id);
        if (row && hit && entries.length < limit) entries.push({ row, match: hit });
      }
    }
    cursor = batch[batch.length - 1]!.created_at;
  }
  return entries;
}

/** Une page de l'historique pour les nouveaux paramètres. Lecture impossible
 * ou incomplète : DatabaseReadError (jamais une page partielle présentée
 * comme complète). */
export function readHistory(fastify: FastifyInstance, userId: string, options: { limit: number; before?: string; q?: string }): Promise<HistoryEntry[]> {
  return options.q !== undefined ? historySearch(fastify, userId, options.limit, options.before, options.q) : historyPage(fastify, userId, options.limit, options.before);
}
