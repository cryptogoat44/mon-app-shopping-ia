import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  FOR_YOU_CACHE_MS,
  FOR_YOU_CANDIDATES,
  FOR_YOU_DAYS,
  FOR_YOU_MAX,
  FOR_YOU_MIN_ACCOUNT_AGE_HOURS,
  FOR_YOU_PAGE_SIZE,
  FOR_YOU_PER_AUTHOR,
} from "@monapp/shared-types";
import { privateAccountsReady, readAudience, type Audience } from "./audience.js";
import { chunks, readAll, type PagedQuery } from "./pagedReads.js";
import { singleFlight } from "./singleFlight.js";
import { shownPosts } from "./visibility.js";
import { DatabaseReadError, parseDbRows } from "./validation.js";

// Fil « Pour vous » et suggestions de comptes (lot « découverte », migration
// 0050). Des publications publiques récentes de comptes que le membre ne suit
// pas, classées selon leur date et leur nombre de « j'aime » et de
// commentaires, LE MÊME classement pour tous. Rien n'est enregistré : ni ce
// qui a été vu, ni un profil des centres d'intérêt.
//
// 1. Le classement, commun (buildForYouSet) : les FOR_YOU_CANDIDATES
//    publications publiques les plus récentes des FOR_YOU_DAYS derniers jours,
//    avec une image (ni absente, ni retirée par la modération), non masquées.
//    Retirés : auteurs sans nom d'utilisateur, suspendus, privés, qui ont
//    éteint « Proposer mon compte aux autres membres », ou inscrits depuis
//    moins de FOR_YOU_MIN_ACCOUNT_AGE_HOURS heures ; publications signalées
//    dont le signalement n'est pas encore traité. Score : forYouScore.
//    Toute liste d'identifiants part par paquets de 100 (chunks), toute
//    lecture de lignes passe par readAll : jamais un compte tronqué en silence.
// 2. Gardé FOR_YOU_CACHE_MS en mémoire (forYouSet, singleFlight pendant la
//    construction) : il ne contient rien de personnel.
// 3. Pour chaque membre, des exclusions seulement (personalize) : ses propres
//    publications, les comptes qu'il suit ou à qui il a demandé à s'abonner,
//    ceux en blocage avec lui dans un sens ou dans l'autre, les publications
//    qu'il a signalées. FOR_YOU_PER_AUTHOR publications par auteur au plus ;
//    FOR_YOU_MAX en tout.
// 4. Le classement n'est jamais le dernier contrôle : la page est relue juste
//    avant d'être envoyée (routes/forYou.ts).
//
// Sans la migration 0050 (sonde ci-dessous), « Pour vous » et les suggestions
// sont cachés : leurs routes, comme celle du réglage, répondent
// « indisponible » (404), et l'app cache le fil, la rangée de suggestions et
// le réglage. Personne n'est proposé sans pouvoir refuser. Sans 0045, tous
// les comptes sont publics (lib/audience.ts) ; le fil fonctionne.

export const DISCOVERY_SETTING_UNAVAILABLE = {
  error: "discovery_setting_unavailable",
  message: "Le réglage « Proposer mon compte aux autres membres » n'est pas encore disponible.",
} as const;

/** Sonde refaite au plus toutes les 5 minutes tant que 0050 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

type Db = Pick<FastifyInstance, "supabaseAdmin" | "log">;

/** Réponses de la base qui veulent dire « la colonne ou la table n'existe
 * pas » (Postgres : 42703, 42P01 ; PostgREST : PGRST204, PGRST205). */
const ABSENT_CODES = new Set(["42703", "42P01", "PGRST204", "PGRST205"]);

/** La colonne de 0050 répond-elle ? Une lecture sans ligne. Vrai : elle est
 * là. Faux : la base dit qu'elle n'existe pas. Toute autre réponse (base
 * injoignable, délai dépassé…) relève DatabaseReadError : on ne sait pas, et
 * « tout le monde est proposé » montrerait ceux qui ont refusé. */
async function probeSchema(fastify: Db): Promise<boolean> {
  let failed: { code?: string } | null;
  try {
    const answer = await fastify.supabaseAdmin.from("profiles").select("id, discoverable").limit(0);
    if (!answer.error) return true;
    failed = answer.error as { code?: string };
  } catch {
    failed = null;
  }
  const code = failed?.code ?? null;
  if (code !== null && ABSENT_CODES.has(code)) {
    fastify.log.warn({ code }, "Réglage « Proposer mon compte » coupé : migration 0050 absente");
    return false;
  }
  fastify.log.warn({ code }, "Réglage « Proposer mon compte » : schéma illisible");
  throw new DatabaseReadError("Schéma du réglage « Proposer mon compte » illisible");
}

/** La base a-t-elle la migration 0050 ? Mémorisé une fois vu ; absente, un
 * avertissement, puis la sonde n'est refaite qu'au bout de 5 minutes (comme
 * profileExtrasReady). Base illisible : DatabaseReadError, rien n'est
 * mémorisé, et la sonde est refaite à la requête suivante. */
export async function discoveryReady(fastify: Db, now: () => number = Date.now): Promise<boolean> {
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

/** Comme discoveryReady, pour une lecture qui peut se passer du réglage (le
 * profil) : base illisible → « absente » (le réglage est caché). Jamais pour
 * choisir qui proposer. */
export async function discoveryShown(fastify: Db): Promise<boolean> {
  try {
    return await discoveryReady(fastify);
  } catch {
    return false;
  }
}

/** Tests seulement : oublie la sonde. */
export function resetDiscoveryProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}

// ---- Le classement, le même pour tous ----

/** Score d'une publication : (1 + j'aime + 2 × commentaires) / (âge en heures + 2)^1,2.
 * Une publication plus récente, ou plus aimée et commentée, passe devant. */
export function forYouScore(likes: number, comments: number, ageHours: number): number {
  return (1 + likes + 2 * comments) / Math.pow(Math.max(0, ageHours) + 2, 1.2);
}

/** Une publication classée : rien de personnel (son identifiant, son auteur, sa date, son score). */
export interface RankedPost {
  id: string;
  authorId: string;
  createdAt: string;
  score: number;
}

export interface ForYouSet {
  /** Heure de construction (horloge du serveur, en millisecondes). */
  builtAt: number;
  /** Du meilleur score au moins bon ; à score égal, la plus récente d'abord. */
  posts: RankedPost[];
}

/** Ordre du classement : score décroissant, puis date, puis identifiant (un ordre total, stable). */
export function compareRanked(a: RankedPost, b: RankedPost): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

const ID = z.guid();
const CANDIDATE_ROWS = z.array(z.object({ id: ID, user_id: ID, created_at: z.string() }));
const AUTHOR_ROWS = z.array(
  z.object({
    id: ID,
    username: z.string().nullable(),
    created_at: z.string(),
    // Absentes tant que 0045 (compte privé) ou 0050 (réglage) manquent : public, proposé.
    is_private: z.boolean().nullable().optional(),
    discoverable: z.boolean().nullable().optional(),
  })
);
const USER_ID_ROWS = z.array(z.object({ user_id: ID }));
const TARGET_ROWS = z.array(z.object({ target_id: ID }));
const POST_ID_ROWS = z.array(z.object({ post_id: ID }));

/** Toutes les lignes d'une lecture faite par paquets de 100 identifiants,
 * chaque paquet lu en entier (readAll), puis relues avec `schema`. Lecture
 * impossible ou incomplète : une erreur, jamais une liste partielle. */
async function readChunked<T>(what: string, ids: readonly string[], makeQuery: (part: string[]) => PagedQuery, orderBy: readonly string[], schema: z.ZodType<T[]>): Promise<T[]> {
  const rows: unknown[] = [];
  for (const part of chunks([...new Set(ids)])) rows.push(...(await readAll(what, () => makeQuery(part), orderBy)));
  return parseDbRows(schema, { data: rows, error: null }, what);
}

/** Ce qu'on sait d'un auteur pour décider s'il peut être proposé à des inconnus. */
export interface AuthorFacts {
  username: string | null;
  createdAt: string;
  isPrivate: boolean;
  discoverable: boolean;
}

/** Les profils de ces auteurs : nom d'utilisateur, date d'inscription, compte
 * privé (faux sans 0045), réglage « Proposer mon compte » (faux sans 0050 :
 * personne n'est proposé sans avoir pu refuser ; les routes répondent déjà
 * 404 dans ce cas). */
export async function readAuthorFacts(fastify: FastifyInstance, ids: readonly string[]): Promise<Map<string, AuthorFacts>> {
  const [withPrivate, withDiscovery] = await Promise.all([privateAccountsReady(fastify), discoveryReady(fastify)]);
  const columns = ["id", "username", "created_at", ...(withPrivate ? ["is_private"] : []), ...(withDiscovery ? ["discoverable"] : [])].join(", ");
  const rows = await readChunked("Profils des auteurs de « Pour vous »", ids, (part) => fastify.supabaseAdmin.from("profiles").select(columns, { count: "exact" }).in("id", part), ["id"], AUTHOR_ROWS);
  return new Map(
    rows.map((row) => [
      row.id,
      { username: row.username, createdAt: row.created_at, isPrivate: row.is_private === true, discoverable: withDiscovery && row.discoverable !== false },
    ])
  );
}

/** Un auteur qu'on peut proposer à qui ne le suit pas : un nom d'utilisateur,
 * un compte public, le réglage allumé, inscrit depuis assez longtemps. */
export function authorProposable(facts: AuthorFacts | undefined, now: number): facts is AuthorFacts {
  if (!facts || !facts.username || facts.isPrivate || !facts.discoverable) return false;
  const created = Date.parse(facts.createdAt);
  return Number.isFinite(created) && now - created >= FOR_YOU_MIN_ACCOUNT_AGE_HOURS * 3_600_000;
}

/** Comptes suspendus parmi ces comptes (par paquets, lecture complète). */
export async function suspendedAmongAll(fastify: FastifyInstance, ids: readonly string[]): Promise<Set<string>> {
  const rows = await readChunked("Suspensions des auteurs de « Pour vous »", ids, (part) => fastify.supabaseAdmin.from("suspensions").select("user_id", { count: "exact" }).in("user_id", part), ["user_id"], USER_ID_ROWS);
  return new Set(rows.map((row) => row.user_id));
}

/** Publications de cette liste qui ont un signalement pas encore traité par la
 * modération (par précaution, jusqu'à ce qu'elle ait regardé). */
export async function openlyReported(fastify: FastifyInstance, postIds: readonly string[]): Promise<Set<string>> {
  const rows = await readChunked(
    "Signalements en attente des publications de « Pour vous »",
    postIds,
    (part) => fastify.supabaseAdmin.from("reports").select("id, target_id", { count: "exact" }).eq("target_type", "post").is("handled_at", null).in("target_id", part),
    ["id"],
    TARGET_ROWS
  );
  return new Set(rows.map((row) => row.target_id));
}

/** Construit le classement commun à l'heure `now` (voir l'en-tête). Environ
 * dix lectures ; une lecture impossible : une erreur, rien n'est gardé. */
export async function buildForYouSet(fastify: FastifyInstance, now: number): Promise<ForYouSet> {
  const since = new Date(now - FOR_YOU_DAYS * 24 * 3_600_000).toISOString();
  const candidates = parseDbRows(
    CANDIDATE_ROWS,
    await shownPosts(fastify, "id, user_id, created_at")
      .eq("privacy", "public")
      .not("media_url", "is", null)
      .is("media_removed_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(FOR_YOU_CANDIDATES),
    "Publications candidates de « Pour vous »"
  );
  if (candidates.length === 0) return { builtAt: now, posts: [] };

  const authorIds = [...new Set(candidates.map((row) => row.user_id))];
  const [facts, suspended, reported] = await Promise.all([
    readAuthorFacts(fastify, authorIds),
    suspendedAmongAll(fastify, authorIds),
    openlyReported(
      fastify,
      candidates.map((row) => row.id)
    ),
  ]);
  const eligible = candidates.filter((row) => authorProposable(facts.get(row.user_id), now) && !suspended.has(row.user_id) && !reported.has(row.id));
  if (eligible.length === 0) return { builtAt: now, posts: [] };

  // Les « j'aime » et les commentaires non masqués, comptés ici sur les seules
  // publications retenues, sans troncature (readAll, paquets de 100).
  const ids = eligible.map((row) => row.id);
  const [likes, comments] = await Promise.all([
    readChunked("J'aime des publications de « Pour vous »", ids, (part) => fastify.supabaseAdmin.from("post_reactions").select("post_id, user_id", { count: "exact" }).in("post_id", part), ["post_id", "user_id"], POST_ID_ROWS),
    readChunked("Commentaires des publications de « Pour vous »", ids, (part) => fastify.supabaseAdmin.from("comments").select("id, post_id", { count: "exact" }).in("post_id", part).is("hidden_at", null), ["id"], POST_ID_ROWS),
  ]);
  const likeCount = countBy(likes);
  const commentCount = countBy(comments);

  const posts = eligible
    .map((row) => {
      const ageHours = (now - Date.parse(row.created_at)) / 3_600_000;
      return { id: row.id, authorId: row.user_id, createdAt: row.created_at, score: forYouScore(likeCount.get(row.id) ?? 0, commentCount.get(row.id) ?? 0, ageHours) };
    })
    .sort(compareRanked);
  return { builtAt: now, posts };
}

function countBy(rows: readonly { post_id: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.post_id, (counts.get(row.post_id) ?? 0) + 1);
  return counts;
}

let cached: ForYouSet | null = null;

/** Le classement commun, refait au plus toutes les FOR_YOU_CACHE_MS (une seule
 * construction à la fois : les requêtes qui arrivent pendant ce temps
 * l'attendent). Aucune lecture tant que personne n'ouvre « Pour vous ». */
export async function forYouSet(fastify: FastifyInstance, now: () => number = Date.now): Promise<ForYouSet> {
  const at = now();
  if (cached && at >= cached.builtAt && at - cached.builtAt < FOR_YOU_CACHE_MS) return cached;
  return singleFlight("for-you-set", async () => {
    const built = await buildForYouSet(fastify, now());
    cached = built;
    return built;
  });
}

/** Tests seulement : oublie le classement gardé en mémoire. */
export function resetForYouCache(): void {
  cached = null;
}

// ---- Pour un membre : des exclusions seulement ----

/** Un compte qu'on peut proposer à ce membre : ni lui-même, ni un compte
 * qu'il suit ou à qui il a demandé à s'abonner, ni en blocage avec lui, ni
 * suspendu, ni privé. */
export function proposableTo(audience: Audience | undefined): boolean {
  return audience !== undefined && !audience.self && !audience.follows && !audience.requested && !audience.blocked && !audience.suspended && !audience.isPrivate;
}

/** La liste de ce membre, dans l'ordre du classement : rien que des
 * exclusions, FOR_YOU_PER_AUTHOR publications par auteur et FOR_YOU_MAX en
 * tout au plus. Deux membres avec les mêmes exclusions ont la même liste. */
export function personalize(set: readonly RankedPost[], audiences: ReadonlyMap<string, Audience>, reportedByViewer: ReadonlySet<string>): string[] {
  const perAuthor = new Map<string, number>();
  const list: string[] = [];
  for (const post of set) {
    if (list.length >= FOR_YOU_MAX) break;
    if (reportedByViewer.has(post.id) || !proposableTo(audiences.get(post.authorId))) continue;
    const count = perAuthor.get(post.authorId) ?? 0;
    if (count >= FOR_YOU_PER_AUTHOR) continue;
    perAuthor.set(post.authorId, count + 1);
    list.push(post.id);
  }
  return list;
}

/** Le lien de ce membre avec chacun de ces auteurs (lib/audience.ts, par
 * paquets de 100 auteurs : un nombre fixe de lectures par paquet). */
export async function readAudiences(fastify: FastifyInstance, viewerId: string, authorIds: readonly string[]): Promise<Map<string, Audience>> {
  const audiences = new Map<string, Audience>();
  for (const part of chunks([...new Set(authorIds)])) {
    for (const [id, audience] of await readAudience(fastify, viewerId, part)) audiences.set(id, audience);
  }
  return audiences;
}

/** Les publications de cette liste que ce membre a signalées, quelle que soit
 * la suite donnée (lecture complète, par paquets : pas seulement ses 100
 * derniers signalements). Lecture impossible : une erreur, jamais « rien de
 * signalé » par défaut. */
export async function reportedBy(fastify: FastifyInstance, viewerId: string, postIds: readonly string[]): Promise<Set<string>> {
  const rows = await readChunked(
    "Publications signalées par le membre",
    postIds,
    (part) => fastify.supabaseAdmin.from("reports").select("id, target_id", { count: "exact" }).eq("reporter_id", viewerId).eq("target_type", "post").in("target_id", part),
    ["id"],
    TARGET_ROWS
  );
  return new Set(rows.map((row) => row.target_id));
}

/** La page à `offset` d'une liste, et la position de la suivante (null : fin). */
export function pageAt<T>(list: readonly T[], offset: number): { items: T[]; nextOffset: number | null } {
  const items = list.slice(offset, offset + FOR_YOU_PAGE_SIZE);
  const next = offset + FOR_YOU_PAGE_SIZE;
  return { items, nextOffset: next < list.length ? next : null };
}

// ---- Suggestions de comptes ----

/** Abonnements du membre lus pour les suggestions : les plus récents. */
export const SUGGESTION_FOLLOWS_READ = 500;
/** Lignes d'abonnements de ses abonnements lues, au plus, en tout. */
export const SUGGESTION_SECOND_ROWS_MAX = 2000;
/** Comptes candidats examinés avant les filtres (assez pour en garder SUGGESTIONS_MAX). */
export const SUGGESTION_POOL = 50;
/** Au plus 1 000 lignes par requête (« Max rows » de Supabase). */
const ROWS_PER_REQUEST = 1000;

const FOLLOWEE_ROWS = z.array(z.object({ followee_id: ID }));
const SECOND_DEGREE_ROWS = z.array(z.object({ follower_id: ID, followee_id: ID }));

/** Les comptes à examiner pour les suggestions, dans l'ordre : (a) les comptes
 * suivis par les comptes que le membre suit, du plus suivi au moins suivi
 * (ses SUGGESTION_FOLLOWS_READ abonnements les plus récents ;
 * SUGGESTION_SECOND_ROWS_MAX lignes lues au plus) ; (b) puis les auteurs du
 * classement commun, par score cumulé. Seules les listes d'abonnements des
 * comptes que le membre suit sont lues : des listes qu'il peut déjà ouvrir.
 * Ni le membre lui-même, ni ses abonnements lus ; SUGGESTION_POOL au plus.
 * Les filtres (blocage, suspension, compte privé, réglage, nom
 * d'utilisateur, déjà suivi ou demandé) viennent ensuite (routes/forYou.ts). */
export async function suggestionCandidates(fastify: FastifyInstance, viewerId: string, set: readonly RankedPost[]): Promise<string[]> {
  const db = fastify.supabaseAdmin;
  const followees = parseDbRows(
    FOLLOWEE_ROWS,
    await db.from("follows").select("followee_id").eq("follower_id", viewerId).order("created_at", { ascending: false }).limit(SUGGESTION_FOLLOWS_READ),
    "Abonnements du membre"
  ).map((row) => row.followee_id);
  const followed = new Set(followees);

  const parts = chunks(followees);
  const perPart = parts.length > 0 ? Math.min(ROWS_PER_REQUEST, Math.floor(SUGGESTION_SECOND_ROWS_MAX / parts.length)) : 0;
  const second = (
    await Promise.all(
      parts.map(async (part) =>
        parseDbRows(
          SECOND_DEGREE_ROWS,
          await db.from("follows").select("follower_id, followee_id").in("follower_id", part).order("created_at", { ascending: false }).limit(perPart),
          "Abonnements des abonnements du membre"
        )
      )
    )
  ).flat();
  const byFollowers = new Map<string, number>();
  for (const row of second) {
    if (row.followee_id === viewerId || followed.has(row.followee_id)) continue;
    byFollowers.set(row.followee_id, (byFollowers.get(row.followee_id) ?? 0) + 1);
  }
  const friendsOfFriends = [...byFollowers.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);

  const byScore = new Map<string, number>();
  for (const post of set) byScore.set(post.authorId, (byScore.get(post.authorId) ?? 0) + post.score);
  const active = [...byScore.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);

  const pool: string[] = [];
  for (const id of [...friendsOfFriends, ...active]) {
    if (pool.length >= SUGGESTION_POOL) break;
    if (id === viewerId || followed.has(id) || pool.includes(id)) continue;
    pool.push(id);
  }
  return pool;
}
