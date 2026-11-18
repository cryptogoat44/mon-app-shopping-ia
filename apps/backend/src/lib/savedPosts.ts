import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SAVED_POSTS_MAX } from "@monapp/shared-types";
import { collectionsReady } from "./collections.js";
import { chunks } from "./pagedReads.js";
import { DatabaseReadError, parseDbRows } from "./validation.js";

// Publications enregistrées (lot « vie sociale », migration 0048). Un membre
// enregistre une publication qu'il voit, pour la retrouver dans sa liste
// « Publications enregistrées », rangée ou non dans une de SES collections.
// Règles, en un seul endroit :
// - on n'enregistre qu'une publication qu'on voit maintenant (findViewablePost) ;
// - la liste ne rend une publication que si son propriétaire peut ENCORE la
//   voir au moment de la lecture (masquage, blocage, visibilité, compte privé,
//   signalée par lui) : rien n'est recopié dans saved_posts, tout est relu ;
// - la réponse ne dit jamais combien de publications ont été laissées de côté ;
// - visibles de leur propriétaire seul : jamais dans ce que ses amis voient
//   d'une collection, jamais un compteur, jamais une notification. Rien ne dit
//   à un auteur qui a enregistré sa publication, ni combien l'ont fait ;
// - la collection est toujours une des siennes (vérifié ici, et par la base
//   avec PostgreSQL 15 et plus) ;
// - retirer une publication de ses enregistrées marche toujours, même quand
//   on ne la voit plus.
// Sans la migration 0048 (sonde ci-dessous), ni 0033 dont elle dépend : les
// routes répondent « indisponible », les publications n'ont pas
// `viewerHasSaved`, et l'app cache le signet.

export const SAVED_POSTS_UNAVAILABLE = {
  error: "saved_posts_unavailable",
  message: "Les publications enregistrées ne sont pas encore disponibles.",
} as const;
export const SAVED_POSTS_FULL = {
  error: "saved_posts_full",
  message: "Vous avez atteint la limite de publications enregistrées.",
} as const;

/** Sonde refaite au plus toutes les 5 minutes tant que 0048 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

type Db = Pick<FastifyInstance, "supabaseAdmin" | "log">;

/** Réponses de la base qui veulent dire « la colonne ou la table n'existe
 * pas » (Postgres : 42703, 42P01 ; PostgREST : PGRST204, PGRST205). */
const ABSENT_CODES = new Set(["42703", "42P01", "PGRST204", "PGRST205"]);

/** La table de 0048 répond-elle ? Une lecture sans ligne. Vrai : elle est
 * là. Faux : la base dit qu'elle n'existe pas. Toute autre réponse (base
 * injoignable, délai dépassé…) relève DatabaseReadError : on ne sait pas, et
 * rien n'est mémorisé. */
async function probeSchema(fastify: Db): Promise<boolean> {
  let failed: { code?: string } | null;
  try {
    const answer = await fastify.supabaseAdmin.from("saved_posts").select("user_id, post_id, collection_id").limit(0);
    if (!answer.error) return true;
    failed = answer.error as { code?: string };
  } catch {
    failed = null;
  }
  const code = failed?.code ?? null;
  if (code !== null && ABSENT_CODES.has(code)) {
    fastify.log.warn({ code }, "Publications enregistrées coupées : migration 0048 absente");
    return false;
  }
  fastify.log.warn({ code }, "Publications enregistrées : schéma illisible");
  throw new DatabaseReadError("Schéma des publications enregistrées illisible");
}

/** La base a-t-elle la migration 0048 (et donc 0033, les collections) ?
 * Mémorisé une fois vu ; absente, un avertissement, puis la sonde n'est
 * refaite qu'au bout de 5 minutes (comme postExtrasReady). Base illisible :
 * DatabaseReadError, rien n'est mémorisé, et la sonde est refaite à la
 * requête suivante. */
export async function savedPostsReady(fastify: Db, now: () => number = Date.now): Promise<boolean> {
  if (schemaReadyAt !== null) return true;
  if (schemaMissingAt !== null && now() - schemaMissingAt < SCHEMA_RETRY_MS) return false;
  // 0048 demande 0033 : sans les collections, rien à sonder.
  if (!(await collectionsReady(fastify, now))) return false;
  schemaProbe ??= probeSchema(fastify)
    .then((ready) => {
      if (ready) schemaReadyAt = now();
      else schemaMissingAt = now();
      return ready;
    })
    .finally(() => {
      schemaProbe = null;
    });
  return schemaProbe;
}

/** Tests seulement : oublie la sonde. */
export function resetSavedPostsProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}

const ID = z.guid();
export const SAVED_ROWS = z.array(z.object({ post_id: ID, collection_id: ID.nullable(), created_at: z.string().min(1) }));
export type SavedRow = z.infer<typeof SAVED_ROWS>[number];

/** Pour chacune de ces publications que `viewerId` a enregistrées : la
 * collection où il l'a rangée, ou null. Une lecture par tranche
 * d'identifiants, jamais une par publication. Relève une erreur si une
 * lecture échoue. */
export async function readSavedState(fastify: FastifyInstance, viewerId: string, postIds: readonly string[]): Promise<Map<string, string | null>> {
  const saved = new Map<string, string | null>();
  for (const part of chunks([...new Set(postIds)])) {
    const rows = parseDbRows(
      SAVED_ROWS,
      await fastify.supabaseAdmin.from("saved_posts").select("post_id, collection_id, created_at").eq("user_id", viewerId).in("post_id", part),
      "Publications enregistrées"
    );
    for (const row of rows) saved.set(row.post_id, row.collection_id);
  }
  return saved;
}

/** `userId` a-t-il déjà SAVED_POSTS_MAX publications enregistrées ? */
export async function savedPostsFull(fastify: FastifyInstance, userId: string): Promise<boolean> {
  const { count, error } = await fastify.supabaseAdmin.from("saved_posts").select("post_id", { count: "exact", head: true }).eq("user_id", userId);
  if (error || typeof count !== "number") throw new DatabaseReadError("Nombre de publications enregistrées illisible");
  return count >= SAVED_POSTS_MAX;
}
