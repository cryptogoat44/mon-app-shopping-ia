import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrivacyLevel } from "@monapp/shared-types";
import { DatabaseReadError, parseDbRows } from "./validation.js";

// Qui peut voir le contenu de qui (lot « vie sociale », compte privé,
// migration 0045). UNE seule règle pour le fil, le détail d'une publication,
// les commentaires, les « j'aime », le profil d'un autre membre, les listes
// de membres et les notifications : tout passe par readAudience, puis par
// canSeeAuthorContent ou postVisibleTo. lib/visibility.ts s'appuie dessus.
//
// Compte privé : seuls ses abonnés ACCEPTÉS voient ses publications, quelle
// que soit la visibilité de chacune. Une demande d'abonnement en attente ne
// donne aucun accès.
//
// Sans la migration 0045, tous les comptes sont publics (sonde ci-dessous) :
// le serveur se comporte exactement comme avant.

export const PRIVATE_ACCOUNTS_UNAVAILABLE = {
  error: "private_accounts_unavailable",
  message: "Le compte privé n'est pas encore disponible.",
} as const;

/** Sonde refaite au plus toutes les 5 minutes tant que 0045 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

type Db = Pick<FastifyInstance, "supabaseAdmin" | "log">;

/** La colonne et la table de 0045 répondent-elles ? Deux lectures sans ligne. */
async function probeSchema(fastify: Db): Promise<boolean> {
  try {
    const [column, table] = await Promise.all([
      fastify.supabaseAdmin.from("profiles").select("is_private").limit(0),
      fastify.supabaseAdmin.from("follow_requests").select("requester_id").limit(0),
    ]);
    if (!column.error && !table.error) return true;
    const code = ((column.error ?? table.error) as { code?: string } | null)?.code ?? null;
    fastify.log.warn({ code }, "Compte privé coupé : migration 0045 absente");
  } catch {
    fastify.log.warn({ code: null }, "Compte privé coupé : base illisible");
  }
  return false;
}

/** La base a-t-elle la migration 0045 ? Mémorisé une fois vu ; absente, un
 * avertissement, puis la sonde n'est refaite qu'au bout de 5 minutes (comme
 * profileModerationReady). */
export async function privateAccountsReady(fastify: Db, now: () => number = Date.now): Promise<boolean> {
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
export function resetPrivateAccountsProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}

/** Ce qui lie un visiteur à un auteur, au moment de la lecture. */
export interface Audience {
  /** Le visiteur est l'auteur. */
  self: boolean;
  /** Blocage dans un sens ou dans l'autre. */
  blocked: boolean;
  /** Compte suspendu par la modération. */
  suspended: boolean;
  /** Compte privé (toujours faux sans la migration 0045). */
  isPrivate: boolean;
  /** Le visiteur est abonné à l'auteur (pour un compte privé : accepté). */
  follows: boolean;
  /** Le visiteur a une demande d'abonnement en attente auprès de l'auteur. */
  requested: boolean;
}

/** Le visiteur peut-il voir ce que l'auteur montre à ses abonnés ou à tous
 * (publications, listes, « j'aime ») ? Lui-même toujours ; jamais en cas de
 * blocage ; un compte privé, seulement ses abonnés acceptés. */
export function canSeeAuthorContent(audience: Audience): boolean {
  return audience.self || (!audience.blocked && (!audience.isPrivate || audience.follows));
}

/** Le visiteur peut-il voir une publication de cette visibilité ? Une
 * publication « publique » d'un compte privé n'est vue que de ses abonnés. */
export function postVisibleTo(audience: Audience, privacy: PrivacyLevel): boolean {
  if (audience.self) return true;
  if (audience.blocked) return false;
  if (privacy === "public") return !audience.isPrivate || audience.follows;
  if (privacy === "followers") return audience.follows;
  return false;
}

const ID = z.guid();
const BLOCKED_ROWS = z.array(z.object({ blocked_id: ID }));
const BLOCKER_ROWS = z.array(z.object({ blocker_id: ID }));
const FOLLOWEE_ROWS = z.array(z.object({ followee_id: ID }));
// La colonne est obligatoire dans la base ; « absente » se lit comme « public ».
const PRIVATE_ROWS = z.array(z.object({ id: ID, is_private: z.boolean().nullable().optional() }));
const SUSPENDED_ROWS = z.array(z.object({ user_id: ID }));
const TARGET_ROWS = z.array(z.object({ target_id: ID }));

/** Ce dont l'appelant a besoin en plus des blocages, des abonnements et du
 * compte privé (tout, par défaut). */
export interface AudienceParts {
  suspended?: boolean;
  requested?: boolean;
}

const nothing = Promise.resolve({ data: [], error: null });

/** Le lien du visiteur avec chacun de ces auteurs, en un nombre fixe de
 * lectures groupées (blocages dans les deux sens, abonnements, comptes
 * privés, suspensions, demandes en attente), quel que soit le nombre
 * d'auteurs — jamais une lecture par ligne. Une lecture impossible relève
 * DatabaseReadError : jamais « visible » par défaut. */
export async function readAudience(
  fastify: FastifyInstance,
  viewerId: string,
  authorIds: readonly string[],
  parts: AudienceParts = {}
): Promise<Map<string, Audience>> {
  const ids = [...new Set(authorIds)];
  const result = new Map<string, Audience>();
  if (ids.length === 0) return result;
  const others = ids.filter((id) => id !== viewerId);

  const db = fastify.supabaseAdmin;
  const withPrivate = await privateAccountsReady(fastify);
  const wantSuspended = parts.suspended !== false;
  const wantRequested = parts.requested !== false && withPrivate;
  // Son propre compte : privé ou non, suspendu ou non, lus comme pour les autres.
  const [blockedByMe, blockingMe, follows, privates, suspensions, requests] = await Promise.all([
    others.length > 0 ? db.from("blocks").select("blocked_id").eq("blocker_id", viewerId).in("blocked_id", others) : nothing,
    others.length > 0 ? db.from("blocks").select("blocker_id").eq("blocked_id", viewerId).in("blocker_id", others) : nothing,
    others.length > 0 ? db.from("follows").select("followee_id").eq("follower_id", viewerId).in("followee_id", others) : nothing,
    withPrivate ? db.from("profiles").select("id, is_private").in("id", ids) : nothing,
    wantSuspended ? db.from("suspensions").select("user_id").in("user_id", ids) : nothing,
    wantRequested && others.length > 0 ? db.from("follow_requests").select("target_id").eq("requester_id", viewerId).in("target_id", others) : nothing,
  ]);

  const blocked = new Set([
    ...parseDbRows(BLOCKED_ROWS, blockedByMe, "Blocages").map((row) => row.blocked_id),
    ...parseDbRows(BLOCKER_ROWS, blockingMe, "Blocages").map((row) => row.blocker_id),
  ]);
  const followed = new Set(parseDbRows(FOLLOWEE_ROWS, follows, "Abonnements").map((row) => row.followee_id));
  const privateIds = new Set(
    parseDbRows(PRIVATE_ROWS, privates, "Comptes privés")
      .filter((row) => row.is_private === true)
      .map((row) => row.id)
  );
  const suspended = new Set(parseDbRows(SUSPENDED_ROWS, suspensions, "Suspensions").map((row) => row.user_id));
  const requested = new Set(parseDbRows(TARGET_ROWS, requests, "Demandes d'abonnement").map((row) => row.target_id));

  for (const id of ids) {
    const self = id === viewerId;
    result.set(id, {
      self,
      blocked: !self && blocked.has(id),
      suspended: suspended.has(id),
      isPrivate: privateIds.has(id),
      follows: !self && followed.has(id),
      // Une demande restée auprès d'un compte redevenu public ne compte pas.
      requested: !self && requested.has(id) && privateIds.has(id),
    });
  }
  return result;
}

/** Le lien du visiteur avec UN auteur. */
export async function readAudienceOf(fastify: FastifyInstance, viewerId: string, authorId: string, parts: AudienceParts = {}): Promise<Audience> {
  const audience = (await readAudience(fastify, viewerId, [authorId], parts)).get(authorId);
  if (!audience) throw new DatabaseReadError("Lien entre deux comptes illisible");
  return audience;
}

/** Ce compte est-il privé ? Toujours faux sans la migration 0045. Lecture
 * impossible : DatabaseReadError. */
export async function isPrivateAccount(fastify: FastifyInstance, userId: string): Promise<boolean> {
  if (!(await privateAccountsReady(fastify))) return false;
  const rows = parseDbRows(PRIVATE_ROWS, await fastify.supabaseAdmin.from("profiles").select("id, is_private").eq("id", userId), "Compte privé");
  return rows[0]?.is_private === true;
}
