import { t } from "../i18n";
import { parseMemberListKind } from "./follow-state";

// Listes des abonnés et des abonnements (lot « vie sociale ») : ce que
// l'écran « membres » affiche selon son adresse, et quand il charge la suite
// tout seul. Fonctions pures, sans écran.

export type FollowListKind = "followers" | "following";

/** Ce que l'écran « membres » doit montrer. `userId` nul : la liste du membre connecté. */
export type MemberListTarget = { kind: "requests" } | { kind: FollowListKind; userId: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lit l'adresse « /membres?kind=…&id=… ». Rend null pour toute liste que
 * cette version ne sait pas afficher (« likes », « viewers », valeur
 * inconnue) et pour un identifiant qui n'en est pas un : l'écran renvoie
 * alors ailleurs, sans rien demander au serveur. */
export function parseMemberListParams(params: { kind?: unknown; id?: unknown }): MemberListTarget | null {
  const kind = parseMemberListKind(params.kind);
  if (kind === "requests") return { kind };
  if (kind !== "followers" && kind !== "following") return null;
  if (params.id === undefined || params.id === null || params.id === "") return { kind, userId: null };
  return typeof params.id === "string" && UUID.test(params.id) ? { kind, userId: params.id.toLowerCase() } : null;
}

/** La liste est-elle celle du membre connecté ? */
export function isOwnMemberList(target: MemberListTarget, myId: string | null | undefined): boolean {
  if (target.kind === "requests" || target.userId === null) return true;
  return typeof myId === "string" && target.userId === myId.toLowerCase();
}

export function memberListTitle(kind: MemberListTarget["kind"]): string {
  if (kind === "followers") return t.memberLists.followersTitle;
  if (kind === "following") return t.memberLists.followingTitle;
  return t.privateAccount.requestsTitle;
}

/** La phrase d'une liste vide : « vous » pour la sienne, « ce compte » pour celle d'un autre. */
export function memberListEmptyText(kind: FollowListKind, own: boolean): string {
  if (kind === "followers") return own ? t.memberLists.followersEmpty : t.memberLists.followersEmptyOther;
  return own ? t.memberLists.followingEmpty : t.memberLists.followingEmptyOther;
}

/** « Trouver des profils » : seulement sous ses propres abonnements, vides. */
export function showsFindPeople(kind: FollowListKind, own: boolean): boolean {
  return own && kind === "following";
}

/** « Retirer » : seulement sur ses propres abonnés, jamais sur sa propre ligne. */
export function showsRemoveFollower(kind: FollowListKind, own: boolean, member: { isMe: boolean }): boolean {
  return own && kind === "followers" && !member.isMe;
}

/** Le serveur filtre après avoir lu une page : elle peut arriver vide alors
 * qu'il en reste. L'app charge alors la suite d'elle-même, mais pas plus de
 * trois pages vides de rang : au-delà, il faut toucher « Voir la suite ». */
export const MAX_EMPTY_PAGES_IN_A_ROW = 3;

/** Le nombre de pages vides de rang après cette page. Une page qui apporte
 * quelqu'un remet le compte à zéro ; une page vide demandée en touchant
 * « Voir la suite » repart à un. */
export function nextEmptyStreak(previous: number, shownOnPage: number, hasMore: boolean, byTap: boolean): number {
  if (shownOnPage > 0 || !hasMore) return 0;
  return byTap ? 1 : previous + 1;
}

/** L'app peut-elle charger la suite sans que la personne le demande ? */
export function loadsWithoutTap(emptyPagesInARow: number): boolean {
  return emptyPagesInARow < MAX_EMPTY_PAGES_IN_A_ROW;
}

/** Les deux actions du compteur d'un profil : où mène chacune. */
export function memberListRoute(kind: FollowListKind, userId: string): { pathname: "/membres"; params: { kind: FollowListKind; id: string } } {
  return { pathname: "/membres", params: { kind, id: userId } };
}
