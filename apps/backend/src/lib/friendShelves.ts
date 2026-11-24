// Étagères des amis (lot « étagères des amis », migration 0058) : montrer ses
// Envies et son Vault à ses amis, si on le décide. Règles, en un seul endroit :
// - deux réglages séparés, éteints au départ, que chaque membre allume
//   lui-même (profiles.wishes_shown_to_friends, profiles.vault_shown_to_friends) ;
// - amis = deux membres qui se suivent l'un l'autre (les mêmes amis que pour
//   les messages et les collections), jamais un simple abonné ni une demande
//   en attente ; aucun blocage, dans un sens ou dans l'autre ; propriétaire
//   non suspendu ;
// - chaque lecture repasse par cette règle (rien n'est gardé en mémoire) : se
//   désabonner, bloquer ou être suspendu coupe l'accès aussitôt ;
// - une lecture impossible (blocages, abonnements, suspension, réglage,
//   schéma) relève DatabaseReadError : jamais « visible » par défaut ;
// - tout refus a la même forme (aucune étagère annoncée, page vide) : rien ne
//   dit si le réglage existe ni pourquoi ;
// - lecture seule : jamais une note, une alerte, un prix payé, les pièces
//   reçues, le nom d'une collection, la date d'ajout d'une pièce du Vault ni
//   la mention « achat vérifié » ; aucune notification, et le propriétaire ne
//   sait pas qui a regardé.
// Sans la migration 0058 (sonde ci-dessous) : aucun réglage, aucune étagère.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readAudienceOf, type Audience } from "./audience.js";
import { readAll } from "./pagedReads.js";
import { DatabaseReadError, parseDbRows } from "./validation.js";
import { isFollowing } from "./visibility.js";

export const FRIEND_SHELVES_UNAVAILABLE = {
  error: "friend_shelves_unavailable",
  message: "Montrer ses Envies ou son Vault à ses amis n'est pas encore disponible.",
} as const;

/** Les deux étagères qu'un membre peut montrer à ses amis. */
export type FriendShelf = "wishes" | "vault";

export interface FriendShelves {
  wishes: boolean;
  vault: boolean;
}

export const NO_SHELVES: FriendShelves = { wishes: false, vault: false };

/** Colonne de `profiles` qui porte chaque réglage. */
export const SHELF_COLUMNS = { wishes: "wishes_shown_to_friends", vault: "vault_shown_to_friends" } as const satisfies Record<FriendShelf, string>;

// ---- Schéma de la base (migration 0058) ----

/** Sonde refaite au plus toutes les 5 minutes tant que 0058 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

type Db = Pick<FastifyInstance, "supabaseAdmin" | "log">;

/** Réponses de la base qui veulent dire « la colonne ou la table n'existe
 * pas » (Postgres : 42703, 42P01 ; PostgREST : PGRST204, PGRST205). */
const ABSENT_CODES = new Set(["42703", "42P01", "PGRST204", "PGRST205"]);

/** Les deux colonnes de 0058 répondent-elles ? Une lecture sans ligne. Vrai :
 * elles sont là. Faux : la base dit qu'elles n'existent pas. Toute autre
 * réponse (base injoignable, délai dépassé…) relève DatabaseReadError : on ne
 * sait pas, et rien n'est montré. */
async function probeSchema(fastify: Db): Promise<boolean> {
  let failed: { code?: string } | null;
  try {
    const answer = await fastify.supabaseAdmin.from("profiles").select(`id, ${SHELF_COLUMNS.wishes}, ${SHELF_COLUMNS.vault}`).limit(0);
    if (!answer.error) return true;
    failed = answer.error as { code?: string };
  } catch {
    failed = null;
  }
  const code = failed?.code ?? null;
  if (code !== null && ABSENT_CODES.has(code)) {
    fastify.log.warn({ code }, "Étagères des amis coupées : migration 0058 absente");
    return false;
  }
  fastify.log.warn({ code }, "Étagères des amis : schéma illisible, rien n'est montré");
  throw new DatabaseReadError("Schéma des étagères des amis illisible");
}

/** La base a-t-elle la migration 0058 ? Mémorisé une fois vu ; absente, un
 * avertissement, puis la sonde n'est refaite qu'au bout de 5 minutes. Base
 * illisible : DatabaseReadError, rien n'est mémorisé, et la sonde est refaite
 * à la requête suivante. */
export async function friendShelvesReady(fastify: Db, now: () => number = Date.now): Promise<boolean> {
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

/** Comme friendShelvesReady, pour une lecture qui peut se passer des réglages
 * (son propre profil) : base illisible → « absente » (les réglages sont
 * cachés). Jamais pour décider de montrer quoi que ce soit à un autre. */
export async function friendShelvesShown(fastify: Db): Promise<boolean> {
  try {
    return await friendShelvesReady(fastify);
  } catch {
    return false;
  }
}

/** Tests seulement : oublie la sonde. */
export function resetFriendShelvesProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}

// ---- La règle ----

/** Une étagère est-elle ouverte à ce visiteur ? Pur : seulement entre amis
 * (le visiteur suit le propriétaire — pour un compte privé, abonné accepté —
 * ET le propriétaire suit le visiteur), sans blocage, propriétaire non
 * suspendu, et réglage exactement vrai. Jamais à soi-même (le propriétaire a
 * ses propres écrans). Tout autre cas, y compris un réglage absent : non. */
export function friendShelfAllowed(audience: Audience, ownerFollowsViewer: boolean, setting: unknown): boolean {
  return !audience.self && !audience.blocked && !audience.suspended && audience.follows && ownerFollowsViewer === true && setting === true;
}

const SETTING_ROW = z.object({ wishes_shown_to_friends: z.boolean().nullable().optional(), vault_shown_to_friends: z.boolean().nullable().optional() }).nullable();

/** Les deux réglages de `userId`, tels qu'enregistrés (faux s'il n'a pas de
 * profil). Lecture impossible : DatabaseReadError. À n'appeler qu'avec 0058. */
export async function readShelfSettings(fastify: FastifyInstance, userId: string): Promise<FriendShelves> {
  const { data, error } = await fastify.supabaseAdmin.from("profiles").select(`${SHELF_COLUMNS.wishes}, ${SHELF_COLUMNS.vault}`).eq("id", userId).maybeSingle();
  if (error) throw new DatabaseReadError("Réglages des étagères illisibles");
  const row = SETTING_ROW.safeParse(data);
  if (!row.success) throw new DatabaseReadError("Réglages des étagères illisibles");
  return { wishes: row.data?.wishes_shown_to_friends === true, vault: row.data?.vault_shown_to_friends === true };
}

/** Les étagères de `ownerId` ouvertes à `viewerId`, relues à chaque appel.
 * Sans 0058, à soi-même, ou si une seule condition manque : aucune. Toute
 * lecture impossible : DatabaseReadError (l'appelant ne montre rien). */
export async function friendShelvesFor(fastify: FastifyInstance, viewerId: string, ownerId: string): Promise<FriendShelves> {
  if (viewerId === ownerId) return NO_SHELVES;
  if (!(await friendShelvesReady(fastify))) return NO_SHELVES;
  const [audience, ownerFollowsViewer, settings] = await Promise.all([
    readAudienceOf(fastify, viewerId, ownerId, { suspended: true, requested: false }),
    isFollowing(fastify, ownerId, viewerId),
    readShelfSettings(fastify, ownerId),
  ]);
  return {
    wishes: friendShelfAllowed(audience, ownerFollowsViewer, settings.wishes),
    vault: friendShelfAllowed(audience, ownerFollowsViewer, settings.vault),
  };
}

/** `userId` montre-t-il ses Envies à ses amis ? Pour la remise en ordre des
 * copies d'images (lib/collections.ts). Sans 0058 : non. Lecture impossible :
 * DatabaseReadError (la remise en ordre s'arrête sans rien effacer). */
export async function showsWishesToFriends(fastify: FastifyInstance, userId: string): Promise<boolean> {
  if (!(await friendShelvesReady(fastify))) return false;
  return (await readShelfSettings(fastify, userId)).wishes;
}

/** Les pièces du Vault de `ownerId` qu'une de SES publications masquée par la
 * modération montre (posts.vault_item_id : la publication « achat » de cette
 * pièce, dont la photo est celle de la pièce). Elles ne sont pas montrées sur
 * l'étagère de ses amis tant que la publication reste masquée ; elles
 * reviennent quand la modération la rend. Lecture complète (jamais tronquée) ;
 * lecture impossible : DatabaseReadError, jamais « aucune ». */
export async function vaultPiecesInHiddenPosts(fastify: FastifyInstance, ownerId: string): Promise<string[]> {
  let rows: unknown[];
  try {
    rows = await readAll<unknown>(
      "Publications masquées d'un Vault",
      () =>
        fastify.supabaseAdmin
          .from("posts")
          .select("id, vault_item_id", { count: "exact" })
          .eq("user_id", ownerId)
          .not("vault_item_id", "is", null)
          .not("hidden_at", "is", null),
      ["id"]
    );
  } catch {
    throw new DatabaseReadError("Publications masquées d'un Vault illisibles");
  }
  const parsed = parseDbRows(z.array(z.object({ id: z.guid(), vault_item_id: z.guid() })), { data: rows, error: null }, "Publications masquées d'un Vault");
  return [...new Set(parsed.map((row) => row.vault_item_id))];
}
