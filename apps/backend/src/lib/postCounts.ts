import type { FastifyInstance } from "fastify";
import { chunks } from "./pagedReads.js";

// Compteurs d'une page de publications (lot « corrections en ligne ») :
// nombre de « j'aime », nombre de commentaires (masqués exclus) et
// publications aimées par la personne qui regarde.
//
// Avant : toutes les lignes de post_reactions et de comments de la page
// étaient lues d'un coup, puis comptées. Or Supabase renvoie au plus
// « Max rows » lignes par requête (1 000 par défaut), SANS erreur : au-delà
// de 1 000 « j'aime » sur une page, les nombres étaient trop bas, et
// « vous avez aimé » pouvait manquer.
//
// Maintenant : une lecture par table, avec le nombre total de lignes
// (`count: "exact"`), triée par publication. Cas courant, rien n'est coupé :
// une seule requête, comme avant. Page coupée : les publications lues en
// entier sont justes ; la dernière, peut-être coupée, est comptée par la base
// (`head: true`, aucune ligne transportée) ; les suivantes sont relues. Pas
// de lecture en plusieurs pages (readAll) : elle s'arrête en erreur si un
// « j'aime » arrive pendant la lecture, ce qui arrive justement sur une
// publication très aimée. Pas non plus un comptage par publication : 40
// requêtes pour une page de 20, à chaque fois.
//
// Lecture impossible : comme avant, les nombres de cette table valent 0 (et
// « vous avez aimé » non), la page s'affiche quand même.

type CountedTable = "post_reactions" | "comments";
type Db = Pick<FastifyInstance, "supabaseAdmin" | "log">;

export interface PostCounts {
  reactionCount: ReadonlyMap<string, number>;
  commentCount: ReadonlyMap<string, number>;
  viewerReacted: ReadonlySet<string>;
}

export async function fetchPostCounts(fastify: Db, postIds: readonly string[], viewerId: string): Promise<PostCounts> {
  const [reactionCount, commentCount, viewerReacted] = await Promise.all([
    countPerPost(fastify, "post_reactions", postIds),
    countPerPost(fastify, "comments", postIds),
    reactedBy(fastify, viewerId, postIds),
  ]);
  return { reactionCount, commentCount, viewerReacted };
}

/** Les lignes qui comptent : tous les « j'aime » ; les commentaires non
 * masqués par la modération. */
function countedRows(fastify: Db, table: CountedTable, options: { count: "exact"; head?: true }) {
  const query = fastify.supabaseAdmin.from(table).select("post_id", options);
  return table === "comments" ? query.is("hidden_at", null) : query;
}

/** Nombre de lignes par publication, exact quel que soit « Max rows ».
 * Lecture impossible : une table vide (comportement d'avant). */
async function countPerPost(fastify: Db, table: CountedTable, postIds: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const failed = () => {
    fastify.log.warn({ table }, "Compteurs des publications : lecture impossible, affichés à zéro");
    return new Map<string, number>();
  };
  for (const part of chunks(postIds)) {
    let remaining = part;
    while (remaining.length > 0) {
      const { data, error, count } = await countedRows(fastify, table, { count: "exact" })
        .in("post_id", remaining)
        .order("post_id", { ascending: true });
      if (error || typeof count !== "number") return failed();
      const rows = (data ?? []) as { post_id: string }[];
      const tally = new Map<string, number>();
      for (const row of rows) tally.set(row.post_id, (tally.get(row.post_id) ?? 0) + 1);
      if (rows.length >= count) {
        for (const id of remaining) counts.set(id, tally.get(id) ?? 0);
        break;
      }
      // Coupée : lignes triées par publication, seule la dernière lue peut
      // être incomplète ; celles qui n'ont pas été lues le seront au tour suivant.
      const last = rows.at(-1)?.post_id;
      if (last === undefined) return failed();
      const { count: lastCount, error: lastError } = await countedRows(fastify, table, { count: "exact", head: true }).eq("post_id", last);
      if (lastError || typeof lastCount !== "number") return failed();
      for (const [id, n] of tally) counts.set(id, id === last ? lastCount : n);
      remaining = remaining.filter((id) => !tally.has(id));
    }
  }
  return counts;
}

/** Publications de la liste aimées par `viewerId` : au plus une ligne par
 * publication (clé de post_reactions), jamais coupée. Lecture impossible :
 * aucune (comportement d'avant). */
async function reactedBy(fastify: Db, viewerId: string, postIds: readonly string[]): Promise<Set<string>> {
  const reacted = new Set<string>();
  for (const part of chunks(postIds)) {
    const { data, error } = await fastify.supabaseAdmin.from("post_reactions").select("post_id").eq("user_id", viewerId).in("post_id", part);
    if (error) {
      fastify.log.warn({ table: "post_reactions" }, "« Vous avez aimé » : lecture impossible");
      return new Set();
    }
    for (const row of (data ?? []) as { post_id: string }[]) reacted.add(row.post_id);
  }
  return reacted;
}
