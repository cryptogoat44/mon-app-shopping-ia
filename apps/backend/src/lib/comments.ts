import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { fetchBlockedUserIds } from "./blocks.js";
import { reportedIdsFor } from "./reportedByViewer.js";
import { DatabaseReadError } from "./validation.js";
import { findViewablePost, type PostRef } from "./visibility.js";

// Commentaires, suite (lot « vie sociale », migration 0046) : réponses à un
// commentaire (un seul niveau), « j'aime » d'un commentaire, mentions
// « @pseudo » et réglage « Qui peut me mentionner ».
//
// Sans la migration 0046 (sonde ci-dessous), les commentaires restent à plat
// comme avant ; les réponses, les « j'aime » et le réglage répondent
// « indisponible », et un « @pseudo » reste un simple texte.
//
// UNE règle pour « ce commentaire est-il montré à ce lecteur ? »
// (findShownComment) : la publication est visible pour lui, le commentaire
// n'est ni masqué par la modération ni signalé par lui, son auteur n'est pas
// en blocage avec lui — et, pour une réponse, tout cela vaut aussi pour le
// commentaire auquel elle répond.

export const COMMENT_THREADS_UNAVAILABLE = {
  error: "comment_threads_unavailable",
  message: "Les réponses et les mentions ne sont pas encore disponibles.",
} as const;

export const COMMENT_NOT_FOUND = { error: "comment_not_found", message: "Commentaire introuvable." } as const;

/** Sonde refaite au plus toutes les 5 minutes tant que 0046 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

type Db = Pick<FastifyInstance, "supabaseAdmin" | "log">;

/** Réponses de la base qui veulent dire « la colonne ou la table n'existe
 * pas » (Postgres : 42703, 42P01 ; PostgREST : PGRST204, PGRST205). */
const ABSENT_CODES = new Set(["42703", "42P01", "PGRST204", "PGRST205"]);

/** Les colonnes et les tables de 0046 répondent-elles ? Quatre lectures sans
 * ligne. Vrai : elles sont là. Faux : la base dit qu'elles n'existent pas.
 * Toute autre réponse (base injoignable, délai dépassé…) relève
 * DatabaseReadError : on ne sait pas, et « à plat par défaut » montrerait une
 * réponse dont le commentaire d'origine est masqué. */
async function probeSchema(fastify: Db): Promise<boolean> {
  let failed: { code?: string } | null;
  try {
    const answers = await Promise.all([
      fastify.supabaseAdmin.from("comments").select("parent_id").limit(0),
      fastify.supabaseAdmin.from("comment_reactions").select("comment_id").limit(0),
      fastify.supabaseAdmin.from("comment_mentions").select("comment_id, author_id").limit(0),
      fastify.supabaseAdmin.from("profiles").select("mentions_from").limit(0),
    ]);
    const firstError = answers.find((answer) => answer.error)?.error ?? null;
    if (!firstError) return true;
    failed = firstError as { code?: string };
  } catch {
    failed = null;
  }
  const code = failed?.code ?? null;
  if (code !== null && ABSENT_CODES.has(code)) {
    fastify.log.warn({ code }, "Réponses et mentions coupées : migration 0046 absente");
    return false;
  }
  fastify.log.warn({ code }, "Réponses et mentions : schéma illisible, aucune réponse par défaut");
  throw new DatabaseReadError("Schéma des réponses aux commentaires illisible");
}

/** La base a-t-elle la migration 0046 ? Mémorisé une fois vu ; absente, un
 * avertissement, puis la sonde n'est refaite qu'au bout de 5 minutes (comme
 * privateAccountsReady). Base illisible : DatabaseReadError, rien n'est
 * mémorisé, et la sonde est refaite à la requête suivante. */
export async function commentThreadsReady(fastify: Db, now: () => number = Date.now): Promise<boolean> {
  if (schemaReadyAt !== null) return true;
  if (schemaMissingAt !== null && now() - schemaMissingAt < SCHEMA_RETRY_MS) return false;
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
export function resetCommentThreadsProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}

const ID = z.guid();
const THREAD_COMMENT = z.object({
  id: ID,
  post_id: ID,
  user_id: ID,
  parent_id: ID.nullable(),
  hidden_at: z.string().nullable(),
});
export type ThreadComment = z.infer<typeof THREAD_COMMENT>;

async function readThreadComment(fastify: FastifyInstance, commentId: string): Promise<ThreadComment | null> {
  const { data, error } = await fastify.supabaseAdmin.from("comments").select("id, post_id, user_id, parent_id, hidden_at").eq("id", commentId).maybeSingle();
  if (error) throw new DatabaseReadError("Lecture d'un commentaire impossible");
  if (data === null) return null;
  const parsed = THREAD_COMMENT.safeParse(data);
  if (!parsed.success) throw new DatabaseReadError("Commentaire illisible");
  return parsed.data;
}

export interface ShownComment {
  comment: ThreadComment;
  /** Le commentaire d'origine : `comment` lui-même, ou celui auquel il répond. */
  rootId: string;
  /** L'auteur du commentaire d'origine. Qui est en blocage avec lui ne voit pas le fil. */
  rootAuthorId: string;
  post: PostRef;
  /** Comptes en blocage avec le lecteur, dans un sens ou dans l'autre. */
  blocked: Set<string>;
  /** Commentaires signalés par le lecteur. */
  reported: Set<string>;
}

/** Le commentaire `commentId` s'il est montré à ce lecteur, sinon null — sans
 * distinguer « n'existe pas » de « pas pour vous ». À n'appeler qu'avec la
 * migration 0046. Lecture impossible : une erreur, jamais « montré ». */
export async function findShownComment(fastify: FastifyInstance, log: FastifyBaseLogger, viewerId: string, commentId: string): Promise<ShownComment | null> {
  const comment = await readThreadComment(fastify, commentId);
  if (comment === null || comment.hidden_at !== null) return null;
  const post = await findViewablePost(fastify, viewerId, comment.post_id);
  if (post === null) return null;
  const [blocked, reportedIds] = await Promise.all([fetchBlockedUserIds(fastify, viewerId), reportedIdsFor(fastify, log, viewerId, "comment")]);
  const reported = new Set(reportedIds);
  const shown = (row: ThreadComment) => row.hidden_at === null && !blocked.has(row.user_id) && !reported.has(row.id);
  if (!shown(comment)) return null;
  let root = comment;
  if (comment.parent_id !== null) {
    const parent = await readThreadComment(fastify, comment.parent_id);
    if (parent === null || parent.post_id !== comment.post_id || !shown(parent)) return null;
    root = parent;
  }
  return { comment, rootId: root.id, rootAuthorId: root.user_id, post, blocked, reported };
}

/** Signaler une réponse (routes/reports.ts) : son commentaire d'origine
 * est-il montré à ce lecteur ? La règle de findShownComment pour le
 * commentaire d'origine : il existe, sous la même publication, n'est pas
 * masqué, et son auteur n'est pas en blocage avec le lecteur. Sans la partie
 * « signalé par lui » : signaler deux fois, ou signaler une réponse après son
 * commentaire d'origine, reste permis comme avant. Vrai pour tout ce qui n'est
 * pas une réponse (commentaire d'origine, identifiant inconnu, base sans 0046
 * où tout est à plat) : le commentaire lui-même se vérifie à part. Lecture
 * impossible : une erreur, jamais « montré ». */
export async function replyRootShownTo(fastify: FastifyInstance, viewerId: string, commentId: string): Promise<boolean> {
  if (!(await commentThreadsReady(fastify))) return true;
  const comment = await readThreadComment(fastify, commentId);
  if (comment === null || comment.parent_id === null) return true;
  const root = await readThreadComment(fastify, comment.parent_id);
  if (root === null || root.post_id !== comment.post_id || root.hidden_at !== null) return false;
  return !(await fetchBlockedUserIds(fastify, viewerId)).has(root.user_id);
}
