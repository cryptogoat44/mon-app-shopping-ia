import type { FastifyInstance } from "fastify";
import { chunks, readAll } from "./pagedReads.js";

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
// Lot « vie sociale » (règles `CountRules`) : les nombres suivent ce que les
// listes montrent. Les « j'aime » et les commentaires des comptes en blocage
// avec le lecteur, dans un sens ou dans l'autre, sont écartés par la base
// elle-même (filtre sur user_id, comme le nombre rendu par « j'aime » dans
// routes/posts.ts) : le nombre reste exact au-delà de 1 000 lignes. Avec les
// réponses (migration 0046), une réponse dont le commentaire d'origine n'est
// pas montré (masqué par la modération, ou écrit par un compte en blocage)
// ne compte pas : ces commentaires d'origine, rares, sont lus en entier, puis
// leurs réponses sont comptées par la base et retirées du nombre.
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

/** Ce qui ne compte pas pour ce lecteur (lot « vie sociale »). */
export interface CountRules {
  /** Comptes en blocage avec le lecteur, dans un sens ou dans l'autre : ni
   * leurs « j'aime » ni leurs commentaires ne comptent. */
  blocked: ReadonlySet<string>;
  /** Base avec les réponses (migration 0046) : une réponse dont le
   * commentaire d'origine n'est pas montré ne compte pas. */
  threads: boolean;
}

const NO_RULES: CountRules = { blocked: new Set(), threads: false };

export async function fetchPostCounts(fastify: Db, postIds: readonly string[], viewerId: string, rules: CountRules = NO_RULES): Promise<PostCounts> {
  const [reactionCount, commentCount, viewerReacted] = await Promise.all([
    countReactions(fastify, postIds, rules),
    countComments(fastify, postIds, rules),
    reactedBy(fastify, viewerId, postIds),
  ]);
  return { reactionCount, commentCount, viewerReacted };
}

/** Restrictions d'un comptage : les comptes écartés et, pour retirer des
 * réponses, les commentaires d'origine dont on compte les réponses. */
interface RowFilter {
  blocked: ReadonlySet<string>;
  parentIds?: readonly string[];
}

/** Les lignes qui comptent : tous les « j'aime » ; les commentaires non
 * masqués par la modération ; jamais ceux d'un compte écarté. */
function countedRows(fastify: Db, table: CountedTable, options: { count: "exact"; head?: true }, filter: RowFilter) {
  let query = fastify.supabaseAdmin.from(table).select("post_id", options);
  if (table === "comments") query = query.is("hidden_at", null);
  if (filter.blocked.size > 0) query = query.not("user_id", "in", `(${[...filter.blocked].join(",")})`);
  if (filter.parentIds !== undefined) query = query.in("parent_id", [...filter.parentIds]);
  return query;
}

function unreadable(fastify: Db, table: CountedTable): Map<string, number> {
  fastify.log.warn({ table }, "Compteurs des publications : lecture impossible, affichés à zéro");
  return new Map<string, number>();
}

/** « J'aime » par publication. Lecture impossible : une table vide
 * (comportement d'avant). */
async function countReactions(fastify: Db, postIds: readonly string[], rules: CountRules): Promise<Map<string, number>> {
  return (await countPerPost(fastify, "post_reactions", postIds, { blocked: rules.blocked })) ?? unreadable(fastify, "post_reactions");
}

/** Commentaires montrés par publication : non masqués, sans ceux des comptes
 * en blocage avec le lecteur ; avec les réponses (0046), sans celles dont le
 * commentaire d'origine n'est pas montré. Lecture impossible : une table vide
 * (comportement d'avant). */
async function countComments(fastify: Db, postIds: readonly string[], rules: CountRules): Promise<Map<string, number>> {
  const counts = await countPerPost(fastify, "comments", postIds, { blocked: rules.blocked });
  if (!counts) return unreadable(fastify, "comments");
  if (!rules.threads) return counts;
  const roots = await unshownRoots(fastify, postIds, rules.blocked);
  if (!roots) return unreadable(fastify, "comments");
  if (roots.size === 0) return counts;
  // Leurs réponses, comptées par la base sur les seules publications
  // concernées. Une réponse n'a qu'un commentaire d'origine : les paquets ne
  // se recouvrent pas, leurs nombres s'additionnent.
  const concerned = [...new Set(roots.values())];
  for (const part of chunks([...roots.keys()])) {
    const replies = await countPerPost(fastify, "comments", concerned, { blocked: rules.blocked, parentIds: part });
    if (!replies) return unreadable(fastify, "comments");
    for (const [postId, n] of replies) counts.set(postId, Math.max(0, (counts.get(postId) ?? 0) - n));
  }
  return counts;
}

/** Commentaires d'origine (sans parent) des publications de la page qui ne
 * sont pas montrés : masqués par la modération, ou écrits par un compte en
 * blocage avec le lecteur. Rares : lus en entier (readAll, jamais coupés).
 * Identifiant → publication ; null : lecture impossible. */
async function unshownRoots(fastify: Db, postIds: readonly string[], blocked: ReadonlySet<string>): Promise<Map<string, string> | null> {
  const db = fastify.supabaseAdmin;
  const roots = new Map<string, string>();
  try {
    for (const part of chunks(postIds)) {
      const reads = [
        readAll<{ id: string; post_id: string }>(
          "Commentaires masqués de la page",
          () => db.from("comments").select("id, post_id", { count: "exact" }).in("post_id", part).is("parent_id", null).not("hidden_at", "is", null),
          ["id"]
        ),
      ];
      if (blocked.size > 0) {
        reads.push(
          readAll<{ id: string; post_id: string }>(
            "Commentaires des comptes en blocage sur la page",
            () =>
              db
                .from("comments")
                .select("id, post_id", { count: "exact" })
                .in("post_id", part)
                .is("parent_id", null)
                .in("user_id", [...blocked]),
            ["id"]
          )
        );
      }
      for (const rows of await Promise.all(reads)) for (const row of rows) roots.set(row.id, row.post_id);
    }
  } catch {
    return null;
  }
  return roots;
}

/** Nombre de lignes par publication, exact quel que soit « Max rows ».
 * null : lecture impossible. */
async function countPerPost(fastify: Db, table: CountedTable, postIds: readonly string[], filter: RowFilter): Promise<Map<string, number> | null> {
  const counts = new Map<string, number>();
  for (const part of chunks(postIds)) {
    let remaining = part;
    while (remaining.length > 0) {
      const { data, error, count } = await countedRows(fastify, table, { count: "exact" }, filter)
        .in("post_id", remaining)
        .order("post_id", { ascending: true });
      if (error || typeof count !== "number") return null;
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
      if (last === undefined) return null;
      const { count: lastCount, error: lastError } = await countedRows(fastify, table, { count: "exact", head: true }, filter).eq("post_id", last);
      if (lastError || typeof lastCount !== "number") return null;
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
