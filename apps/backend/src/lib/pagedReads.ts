// Lectures complètes dans la base, sans troncature silencieuse (export RGPD,
// purge de l'historique des recherches). Deux limites de Supabase à contourner :
// - une requête renvoie au plus « Max rows » lignes (1 000 par défaut, réglable
//   dans le tableau de bord) : au-delà, la liste est coupée SANS erreur ;
// - une longue liste d'identifiants dans un filtre .in() allonge l'adresse de
//   la requête jusqu'à la faire refuser : on la découpe en paquets.

/** Taille des listes d'identifiants envoyées à la base (filtres .in()). */
export const ID_CHUNK_SIZE = 100;
/** Lignes demandées par page (la base peut en renvoyer moins : « Max rows »). */
export const PAGE_SIZE = 1000;

export function chunks<T>(items: readonly T[], size = ID_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Lecture impossible, ou incomplète : jamais une liste partielle présentée
 * comme complète. */
export class IncompleteReadError extends Error {}

export interface PageResult {
  data: unknown[] | null;
  error: unknown;
  count?: number | null;
}

/** Ce dont readAll a besoin d'une requête Supabase (ou d'une fausse requête
 * dans les tests) : un tri, puis une plage de lignes. */
export interface PagedQuery {
  order(column: string, options: { ascending: boolean }): PagedQuery;
  range(from: number, to: number): PromiseLike<PageResult>;
}

/** Lit TOUTES les lignes d'une requête, page après page.
 * - `makeQuery` fabrique une requête neuve à chaque page, demandée avec
 *   `{ count: "exact" }` : la base renvoie alors le nombre total de lignes.
 * - `orderBy` doit donner un ordre total et stable (finir par la clé
 *   primaire) : sans lui, une ligne pourrait être lue deux fois ou sautée
 *   d'une page à l'autre.
 * Une page plus courte que demandé n'est PAS la fin (« Max rows » peut être
 * plus petit que PAGE_SIZE) : on continue tant qu'il manque des lignes, et on
 * s'arrête sur une page vide. Total différent à l'arrivée, ou modifié pendant
 * la lecture : erreur (l'appelant réessaiera), jamais une liste tronquée. */
export async function readAll<T = Record<string, unknown>>(
  what: string,
  makeQuery: () => PagedQuery,
  orderBy: readonly string[],
  pageSize = PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];
  let expected: number | null = null;
  for (;;) {
    let query = makeQuery();
    for (const column of orderBy) query = query.order(column, { ascending: true });
    const { data, error, count } = await query.range(rows.length, rows.length + pageSize - 1);
    if (error) throw new IncompleteReadError(`${what} : lecture impossible`);
    if (typeof count !== "number") throw new IncompleteReadError(`${what} : nombre total de lignes inconnu`);
    if (expected === null) expected = count;
    else if (count !== expected) throw new IncompleteReadError(`${what} : données modifiées pendant la lecture`);
    const page = data ?? [];
    if (page.length === 0) break;
    rows.push(...(page as T[]));
    if (rows.length >= expected) break;
  }
  if (rows.length !== expected) throw new IncompleteReadError(`${what} : ${rows.length} lignes lues sur ${expected}`);
  return rows;
}
