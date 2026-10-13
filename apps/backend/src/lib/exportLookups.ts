import type { FastifyInstance } from "fastify";
import { listIn, type ExportData } from "./exportData.js";
import { readAll } from "./pagedReads.js";

// Fichier lisible de l'export : ce qu'il faut relire en plus pour qu'une
// personne comprenne ses données (qui est derrière un identifiant, quelle
// pièce un clic a ouverte). Toute lecture en échec fait échouer l'export
// (tout ou rien, audit Lot Q, SEC-01).
//
// Règles (lot 5) :
// - un compte en relation de blocage avec la personne, dans un sens comme
//   dans l'autre, n'est JAMAIS nommé (règle 8, lib/blocks.ts : comme dans
//   l'app, qui retire ses pièces, ses publications et son profil) ; le
//   fichier écrit « un compte Spotto ». Seule exception, comme dans l'app
//   (GET /api/blocks) : les comptes qu'elle a bloqués gardent leur nom dans
//   « Comptes bloqués », et seulement là ;
// - jamais moderation_actions : l'auteur d'un signalement apprend seulement
//   que son signalement a été traité, jamais la décision ; et l'administrateur
//   n'est jamais nommé ;
// - des autres comptes, seulement le nom d'utilisateur et le nom affiché
//   (jamais leur photo, leurs légendes ou leurs images).

export interface ExportPerson {
  username: string | null;
  displayName: string;
}

export interface ExportClickedPiece {
  productName: string;
  merchantName: string | null;
}

export interface ExportLookups {
  /** Comptes qui ont bloqué la personne : jamais nommés. */
  blockedMe: ReadonlySet<string>;
  /** Autres comptes cités dans l'export : jamais un compte en relation de
   * blocage avec la personne (ni `blockedMe`, ni `blockedByMe`). */
  people: ReadonlyMap<string, ExportPerson>;
  /** Comptes bloqués par la personne, pour « Comptes bloqués » seulement :
   * nommés là même s'ils l'ont bloquée aussi, comme dans l'app. */
  blockedByMe: ReadonlyMap<string, ExportPerson>;
  /** Auteur des publications d'autres comptes aimées ou commentées (identifiant). */
  postAuthors: ReadonlyMap<string, string>;
  /** Pièce ouverte, par lien marchand (affiliate_link_id des clics). */
  clickedPieces: ReadonlyMap<string, ExportClickedPiece>;
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const ids = (rows: readonly Record<string, unknown>[], column: string): string[] =>
  rows.map((row) => text(row[column])).filter((id): id is string => id !== null);

/** Relève une erreur si une lecture échoue (l'export répond alors 500). */
export async function collectLookups(fastify: FastifyInstance, userId: string, data: ExportData): Promise<ExportLookups> {
  const db = fastify.supabaseAdmin;

  // Publications d'autres comptes aimées ou commentées : leur auteur
  // seulement (jamais la légende ni l'image).
  const ownPosts = new Set(ids(data.posts, "id"));
  const otherPostIds = [...ids(data.reactionsGiven, "post_id"), ...ids(data.comments, "post_id")].filter((id) => !ownPosts.has(id));

  const [blockers, postRows, linkRows] = await Promise.all([
    readAll(
      "blocks (comptes qui vous ont bloqué)",
      () => db.from("blocks").select("blocker_id", { count: "exact" }).eq("blocked_id", userId),
      ["blocker_id"]
    ),
    listIn(db, "posts", "id, user_id", "id", otherPostIds, ["id"]),
    listIn(db, "affiliate_links", "id, product_match_id", "id", ids(data.affiliateClicks, "affiliate_link_id"), ["id"]),
  ]);
  const blockedMe = new Set(ids(blockers, "blocker_id"));
  const postAuthors = new Map(postRows.flatMap((row) => (text(row.id) && text(row.user_id) ? [[row.id as string, row.user_id as string] as const] : [])));

  // Personnes citées : abonnés, abonnements, auteurs des notifications,
  // destinataires et expéditeurs des pièces, auteurs des publications aimées
  // ou commentées, comptes signalés. Un compte en relation de blocage avec la
  // personne (dans un sens ou dans l'autre) n'en fait jamais partie : ailleurs
  // que dans « Comptes bloqués », il reste « un compte Spotto ».
  const blockedByMeIds = ids(data.blockedAccounts, "blocked_id");
  const blockedIds = new Set(blockedByMeIds);
  const cited = [
    ...ids(data.followers, "follower_id"),
    ...ids(data.following, "followee_id"),
    ...ids(data.notifications, "actor_id"),
    ...ids(data.piecesSent, "recipient_id"),
    ...ids(data.piecesReceived, "sender_id"),
    ...postAuthors.values(),
    ...ids(data.reportsSubmitted.filter((report) => report.target_type === "user"), "target_id"),
  ].filter((id) => id !== userId && !blockedMe.has(id) && !blockedIds.has(id));

  // Pièces ouvertes par les clics : celles des recherches de la personne sont
  // déjà dans l'export ; les autres (pièce d'une publication, pièce reçue)
  // sont relues, nom et marchand seulement.
  const matchByLink = new Map(linkRows.flatMap((row) => (text(row.id) && text(row.product_match_id) ? [[row.id as string, row.product_match_id as string] as const] : [])));
  const ownMatches = new Map(data.productMatches.map((match) => [match.id as string, match]));
  const missingMatches = [...matchByLink.values()].filter((id) => !ownMatches.has(id));

  const [profiles, otherMatches] = await Promise.all([
    listIn(db, "profiles", "id, username, display_name", "id", [...cited, ...blockedByMeIds], ["id"]),
    listIn(db, "product_matches", "id, product_name, merchant_name", "id", missingMatches, ["id"]),
  ]);

  const toPerson = (row: Record<string, unknown>): ExportPerson => ({ username: text(row.username), displayName: text(row.display_name) ?? "" });
  const profileById = new Map(profiles.map((row) => [row.id as string, toPerson(row)]));
  const citedIds = new Set(cited);
  const people = new Map([...profileById].filter(([id]) => citedIds.has(id)));
  const blockedByMe = new Map([...profileById].filter(([id]) => blockedIds.has(id)));

  const pieceById = new Map<string, Record<string, unknown>>([...ownMatches, ...otherMatches.map((row) => [row.id as string, row] as const)]);
  const clickedPieces = new Map<string, ExportClickedPiece>();
  for (const [linkId, matchId] of matchByLink) {
    const piece = pieceById.get(matchId);
    const productName = piece ? text(piece.product_name) : null;
    if (productName) clickedPieces.set(linkId, { productName, merchantName: text(piece?.merchant_name) });
  }

  return { blockedMe, people, blockedByMe, postAuthors, clickedPieces };
}
