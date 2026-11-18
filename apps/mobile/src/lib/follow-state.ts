import { CLIENT_LEVEL, CLIENT_LEVEL_PARAM, NOTIFICATION_TYPES, type AppNotification, type FollowState, type NotificationType } from "@monapp/shared-types";
import { t } from "../i18n";

// Compte privé et demandes d'abonnement (lot « vie sociale ») : ce que le
// bouton d'abonnement montre et fait, ce qu'un profil privé laisse voir, et
// le texte des lignes de l'onglet Activité. Fonctions pures, sans écran.

/** « v=2 » : ajouté aux routes dont la réponse a gagné du vocabulaire. */
export const CLIENT_LEVEL_QUERY = `${CLIENT_LEVEL_PARAM}=${CLIENT_LEVEL}`;

interface Followable {
  isFollowing: boolean;
  /** Absent d'un serveur d'avant le lot : on s'en tient à `isFollowing`. */
  followState?: FollowState;
}

/** Suivre, Demandé ou Abonné(e). */
export function followStateOf(person: Followable): FollowState {
  if (person.followState === "following" || person.followState === "requested" || person.followState === "none") return person.followState;
  return person.isFollowing ? "following" : "none";
}

/** Réponse de POST /api/follows : tout ce qui n'est pas « requested » vaut abonné(e). */
export function parseFollowResponse(body: unknown): "following" | "requested" {
  return typeof body === "object" && body !== null && (body as { state?: unknown }).state === "requested" ? "requested" : "following";
}

export type FollowAction = "follow" | "unfollow" | "cancel";

/** Ce que fait le bouton quand on le touche. */
export function followActionFor(state: FollowState): FollowAction {
  return state === "following" ? "unfollow" : state === "requested" ? "cancel" : "follow";
}

export interface FollowButton {
  label: string;
  /** Lu par les lecteurs d'écran après le libellé (« Touchez pour annuler »). */
  hint: string | undefined;
  /** Bouton plein (action principale : « Suivre ») ou discret. */
  primary: boolean;
}

/** Le bouton d'abonnement. `followingLabel` : le libellé de l'état « abonné(e) »
 * de l'écran (« Ne plus suivre » sur un profil, « Suivi(e) » dans la recherche). */
export function followButton(state: FollowState, followingLabel: string): FollowButton {
  if (state === "requested") return { label: t.privateAccount.requested, hint: t.privateAccount.requestedHint, primary: false };
  if (state === "following") return { label: followingLabel, hint: undefined, primary: false };
  return { label: t.userProfile.follow, hint: undefined, primary: true };
}

interface ProfileShell {
  isMe: boolean;
  isFollowing: boolean;
  followState?: FollowState;
  isPrivate?: boolean;
}

/** Profil d'un compte privé vu par quelqu'un qui n'est pas un abonné accepté :
 * nom, photo, bio et compteurs seulement, avec un cadenas ; aucune grille. */
export function showsPrivateShell(profile: ProfileShell): boolean {
  return profile.isPrivate === true && !profile.isMe && followStateOf(profile) !== "following";
}

/** Le nombre de demandes à annoncer dans l'onglet Activité (0 : pas d'entrée). */
export function pendingRequestsCount(profile: { isPrivate?: boolean; followRequestsCount?: number } | null): number {
  const count = profile?.followRequestsCount;
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

// ---- Onglet Activité ----

const KNOWN_TYPES = new Set<string>(NOTIFICATION_TYPES);

/** Les notifications que cette version de l'app sait afficher. Un type
 * ajouté plus tard par le serveur est laissé de côté : jamais montré sous le
 * texte d'un autre. */
export function knownNotifications(list: readonly AppNotification[]): AppNotification[] {
  return list.filter((notification) => KNOWN_TYPES.has(notification.type));
}

/** La phrase qui suit le nom de l'auteur. */
export function notificationActionText(type: NotificationType): string {
  switch (type) {
    case "follow":
      return t.notifications.follow;
    case "comment":
      return t.notifications.comment;
    case "piece_received":
      return t.notifications.pieceReceived;
    case "follow_request":
      return t.privateAccount.notifRequest;
    case "follow_accepted":
      return t.privateAccount.notifAccepted;
    default:
      return t.notifications.like;
  }
}

export type NotificationTarget = { screen: "pieces" } | { screen: "requests" } | { screen: "post"; id: string } | { screen: "profile"; id: string };

/** Où mène une ligne : la liste des demandes, les pièces reçues, la
 * publication, sinon le profil de l'auteur. */
export function notificationTarget(notification: Pick<AppNotification, "type" | "postId">, actorId: string): NotificationTarget {
  if (notification.type === "follow_request") return { screen: "requests" };
  if (notification.type === "piece_received") return { screen: "pieces" };
  if (notification.type === "follow_accepted" || notification.type === "follow") return { screen: "profile", id: actorId };
  return notification.postId ? { screen: "post", id: notification.postId } : { screen: "profile", id: actorId };
}

// ---- Listes de membres ----

/** Les listes de l'écran « membres ». Seule « requests » existe dans ce lot ;
 * les autres arrivent avec les listes d'abonnés, « Aimé par » et les stories. */
export const MEMBER_LIST_KINDS = ["followers", "following", "likes", "requests", "viewers"] as const;
export type MemberListKind = (typeof MEMBER_LIST_KINDS)[number];

export function parseMemberListKind(value: unknown): MemberListKind | null {
  return typeof value === "string" && (MEMBER_LIST_KINDS as readonly string[]).includes(value) ? (value as MemberListKind) : null;
}
