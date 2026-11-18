import type { FollowState } from "@monapp/shared-types";
import { t } from "../i18n";
import { parseMemberListKind } from "./follow-state";

// Listes des abonnés et des abonnements (lot « vie sociale ») : ce que
// l'écran « membres » affiche selon son adresse, et quand il charge la suite
// tout seul. Fonctions pures, sans écran.

export type FollowListKind = "followers" | "following";

/** Ce que l'écran « membres » doit montrer. `userId` nul : la liste du membre
 * connecté. « likes » : les membres qui ont aimé la publication `postId`. */
export type MemberListTarget = { kind: "requests" } | { kind: FollowListKind; userId: string | null } | { kind: "likes"; postId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lit l'adresse « /membres?kind=…&id=… ». Rend null pour toute liste que
 * cette version ne sait pas afficher (« viewers », valeur inconnue) et pour
 * un identifiant qui n'en est pas un : l'écran renvoie alors ailleurs, sans
 * rien demander au serveur. « Aimé par » exige l'identifiant de la publication. */
export function parseMemberListParams(params: { kind?: unknown; id?: unknown }): MemberListTarget | null {
  const kind = parseMemberListKind(params.kind);
  if (kind === "requests") return { kind };
  if (kind === "likes") return typeof params.id === "string" && UUID.test(params.id) ? { kind, postId: params.id.toLowerCase() } : null;
  if (kind !== "followers" && kind !== "following") return null;
  if (params.id === undefined || params.id === null || params.id === "") return { kind, userId: null };
  return typeof params.id === "string" && UUID.test(params.id) ? { kind, userId: params.id.toLowerCase() } : null;
}

/** La liste est-elle celle du membre connecté ? */
export function isOwnMemberList(target: MemberListTarget, myId: string | null | undefined): boolean {
  // « Aimé par » n'est la liste de personne, même sous sa propre publication.
  if (target.kind === "likes") return false;
  if (target.kind === "requests" || target.userId === null) return true;
  return typeof myId === "string" && target.userId === myId.toLowerCase();
}

export function memberListTitle(kind: MemberListTarget["kind"]): string {
  if (kind === "followers") return t.memberLists.followersTitle;
  if (kind === "following") return t.memberLists.followingTitle;
  if (kind === "likes") return t.memberLists.likesTitle;
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

/** Après « Suivre », « Ne plus suivre » ou une demande annulée : la ligne du
 * membre porte le nouvel état. Le bouton se dessine toujours d'après la
 * liste : il reste juste après un rafraîchissement ou un long défilement.
 * Les autres lignes ne sont pas recopiées. */
export function withFollowState<Row extends { id: string; isFollowing: boolean; followState?: FollowState }>(members: readonly Row[], id: string, followState: FollowState): Row[] {
  return members.map((member) => (member.id === id ? { ...member, followState, isFollowing: followState === "following" } : member));
}

/** Largeur gardée au nom dans une ligne de membre. Quand les boutons ne
 * tiennent plus à côté (écran étroit, texte agrandi), ils passent dessous. */
export const MEMBER_NAME_MIN_WIDTH = 140;
/** L'écart entre le nom et les boutons (space.sm). */
export const MEMBER_ROW_GAP = 8;

/** Les boutons d'une ligne passent-ils sous le nom ? */
export function actionsWrapUnderName(rowWidth: number, actionsWidth: number): boolean {
  return MEMBER_NAME_MIN_WIDTH + MEMBER_ROW_GAP + actionsWidth > rowWidth;
}

// ---- Liste « Aimé par » ----

/** Où mène le nombre de « j'aime » d'une publication. `count` : le nombre
 * affiché sous la publication au moment du toucher (voir likesListTexts). */
export function likesListRoute(postId: string, count: number): { pathname: "/membres"; params: { kind: "likes"; id: string; count: string } } {
  return { pathname: "/membres", params: { kind: "likes", id: postId, count: String(count) } };
}

/** Le nombre de « j'aime » est-il un lien vers la liste ? Jamais à zéro. */
export function likeCountOpensList(count: number): boolean {
  return count > 0;
}

/** Le nombre de « j'aime » lu dans l'adresse de l'écran. Absent ou illisible :
 * null (l'écran ne dit alors rien sur les comptes qui n'apparaissent pas). */
export function parseLikeCount(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,9}$/.test(value)) return null;
  return Number(value);
}

/** Les deux phrases de la liste « Aimé par ».
 *   - `emptyText` : personne à montrer. « Personne n'a encore aimé » serait
 *     faux si la publication a des « j'aime » de comptes que le lecteur ne
 *     peut pas voir : on dit alors que certains comptes n'apparaissent pas.
 *   - `note` : sous une liste ENTIÈREMENT chargée et plus courte que le
 *     nombre de « j'aime » de la publication. Jamais pendant le chargement
 *     (la liste est forcément plus courte), jamais de nombre : le serveur ne
 *     dit pas combien de comptes sont laissés de côté. */
export function likesListTexts(shown: number, hasMore: boolean, reactionCount: number | null): { emptyText: string; note: string | null } {
  const partial = !hasMore && reactionCount !== null && shown < reactionCount;
  return {
    emptyText: partial ? t.memberLists.likesPartial : t.memberLists.likesEmpty,
    note: partial && shown > 0 ? t.memberLists.likesPartial : null,
  };
}

/** Publication supprimée, masquée ou plus visible pour ce lecteur (404
 * « post_not_found ») : la même réponse du serveur dans tous les cas. */
export function isPostGone(status: number, errorCode: unknown): boolean {
  return status === 404 && errorCode === "post_not_found";
}
