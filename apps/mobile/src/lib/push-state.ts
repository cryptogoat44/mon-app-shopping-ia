// Notifications des nouveaux messages sur le téléphone (lot notifications) :
// la logique sans écran ni module natif, testée à part (tests/push.test.ts).
//
// Règles :
// - seulement sur l'app iPhone, quand le serveur les a allumées (`push` de
//   GET /api/messages/status) et que la messagerie est là ; jamais sur le site ;
// - l'autorisation d'iOS n'est JAMAIS demandée au lancement : seulement après
//   une explication (feuille « Être prévenu de vos messages ? »), proposée
//   une seule fois après un premier message envoyé ou reçu, ou depuis
//   l'interrupteur des Réglages ;
// - toucher une notification ouvre la conversation.
// Lot alertes prix (migration 0036) : deux sortes de notifications, chacune
// avec la réponse de la personne sur cet appareil — les messages et les
// alertes prix et stock. L'appareil reste enregistré sur le serveur tant que
// l'une des deux est allumée (messages, ou alertes avec l'interrupteur des
// Réglages) ; `messages` et `alerts` disent au serveur ce qu'il lui envoie.
// Avoir accepté les messages ne vaut JAMAIS accord pour les alertes : la
// première cloche montre leur explication, même quand iOS les permet déjà.
// Toucher une alerte ouvre l'envie (ou vos Envies pour une alerte groupée).
// Module natif et appels au serveur : push.ts (site : push.web.ts).
import { parseWishAlertPushData, type MessagesStatus, type WishAlertsStatus } from "@monapp/shared-types";
import { WISHLIST_SEGMENT } from "./wishlist-link";

/** Réponse de la personne, gardée sur l'appareil, par compte. */
export type PushDecision = "on" | "off";
/** Autorisation d'iOS. */
export type PushPermission = "granted" | "denied" | "undetermined";

/** Les deux sortes de notifications (lot alertes prix). */
export type PushKind = "messages" | "alerts";

/** Réponse gardée par compte et par sorte. Les messages gardent la clé
 * d'avant le lot alertes (rien ne change pour un appareil déjà réglé). */
export function pushDecisionKey(userId: string, kind: PushKind = "messages"): string {
  return kind === "alerts" ? `spotto.alerts-push-decision.${userId}` : `spotto.push-decision.${userId}`;
}

/** Dernier jeton enregistré par cet appareil (à oublier à la déconnexion). */
export const PUSH_TOKEN_KEY = "spotto.push-token";

export function parsePushDecision(value: string | null): PushDecision | null {
  return value === "on" || value === "off" ? value : null;
}

/** Ce dont dépend la proposition des notifications. */
export interface PushContext {
  /** Platform.OS */
  platform: string;
  status: MessagesStatus;
  /** Ce build a le module natif et l'identifiant du projet chez Expo. */
  supported: boolean;
}

/** Notifications possibles : iPhone, build prêt, messagerie et notifications allumées sur le serveur. */
export function pushPossible({ platform, status, supported }: PushContext): boolean {
  return platform === "ios" && supported && status.enabled && status.push === true;
}

/** L'interrupteur « Notifications de messages » des Réglages : caché sur le
 * site, et tant que le serveur ne les propose pas. */
export const pushSwitchVisible = pushPossible;

/** Proposer la feuille d'explication : jamais encore répondu, et iOS ne les
 * a pas déjà refusées (la feuille ne servirait à rien). */
export function shouldOfferPush(context: PushContext, decision: PushDecision | null, permission: PushPermission): boolean {
  return pushPossible(context) && decision === null && permission !== "denied";
}

/** L'interrupteur est allumé : la personne a dit oui, et iOS le permet. */
export function pushSwitchValue(decision: PushDecision | null, permission: PushPermission): boolean {
  return decision === "on" && permission === "granted";
}

/** À l'ouverture : rafraîchir le jeton seulement si la personne a dit oui et
 * que iOS le permet déjà — sans jamais rien demander. */
export function shouldRefreshToken(context: PushContext, decision: PushDecision | null, permission: PushPermission): boolean {
  return pushPossible(context) && pushSwitchValue(decision, permission);
}

// ---- Alertes prix et stock (lot 2, migration 0036) ----

/** Ce dont dépendent les notifications des alertes sur cet appareil. */
export interface AlertsPushContext {
  /** Platform.OS */
  platform: string;
  status: Pick<WishAlertsStatus, "available" | "push">;
  /** Ce build a le module natif et l'identifiant du projet chez Expo. */
  supported: boolean;
}

/** Notifications d'alertes possibles : iPhone, build prêt, alertes
 * disponibles et notifications allumées sur le serveur (jamais sur le site). */
export function alertsPushPossible({ platform, status, supported }: AlertsPushContext): boolean {
  return platform === "ios" && supported && status.available && status.push;
}

/** Les réponses de cet appareil, par sorte. */
export interface PushDecisions {
  messages: PushDecision | null;
  alerts: PushDecision | null;
}

/** Allumer les alertes (première cloche, ou interrupteur des Réglages), sur
 * cet appareil :
 * - « offer » : la feuille d'explication des ALERTES d'abord (jamais encore
 *   répondu pour elles, et iOS ne les a pas refusées) — même si les messages
 *   sont acceptés : leur accord ne vaut pas pour les alertes (« Activer »
 *   ne redemande alors rien à iOS) ;
 * - « adopt » : sans rien demander, l'appareil les reçoit déjà (alertes déjà
 *   acceptées sur cet appareil) ;
 * - « none » : rien à faire ici (site, notifications coupées sur le serveur,
 *   « Plus tard » déjà répondu, iOS les refuse). */
export function alertsPushStep(context: AlertsPushContext, decisions: PushDecisions, permission: PushPermission): "offer" | "adopt" | "none" {
  if (!alertsPushPossible(context)) return "none";
  if (decisions.alerts === "on") return "adopt";
  if (decisions.alerts === "off" || permission === "denied") return "none";
  return "offer";
}

/** Cet appareil reçoit les notifications des alertes : la personne a dit oui
 * POUR ELLES sur cet appareil, et iOS le permet. */
export function alertsPushOn(decisions: PushDecisions, permission: PushPermission): boolean {
  return permission === "granted" && decisions.alerts === "on";
}

/** Ce que le serveur garde de l'appareil : gardé tant que les messages OU les
 * alertes sont allumés (`alertsActive` : alertes disponibles et interrupteur
 * des Réglages allumé) ; `messages` et `alerts` : ce que le serveur lui
 * envoie (les alertes seulement après l'« Activer » donné pour elles). */
export function deviceRegistration(decisions: PushDecisions, alertsActive: boolean): { keep: boolean; messages: boolean; alerts: boolean } {
  const messages = decisions.messages === "on";
  const alerts = decisions.alerts === "on";
  return { keep: messages || (alerts && alertsActive), messages, alerts };
}

/** Réponse d'iOS → autorisation. « Provisoire » (3) et « éphémère » (4)
 * permettent de recevoir : comptées comme accordées. */
export function permissionFrom(response: { granted: boolean; status: string; ios?: { status?: number } | null }): PushPermission {
  if (response.granted) return "granted";
  const ios = response.ios?.status;
  if (ios === 3 || ios === 4) return "granted";
  return response.status === "undetermined" ? "undetermined" : "denied";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identifiant du projet chez Expo (écrit dans app.json par `eas init`),
 * nécessaire pour obtenir un jeton ; null tant qu'il manque. */
export function readProjectId(constants: {
  easConfig?: { projectId?: unknown } | null;
  expoConfig?: { extra?: { eas?: { projectId?: unknown } } } | null;
}): string | null {
  const id = constants.easConfig?.projectId ?? constants.expoConfig?.extra?.eas?.projectId;
  return typeof id === "string" && UUID.test(id) ? id : null;
}

/** La conversation d'une notification (données envoyées par le serveur :
 * `{ conversationId }`, rien d'autre), ou null si elle est illisible. */
export function conversationIdFromNotification(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const id = (data as Record<string, unknown>).conversationId;
  return typeof id === "string" && UUID.test(id) ? id : null;
}

/** L'écran de la conversation, comme depuis la liste des messages. */
export function conversationHref(id: string) {
  return { pathname: "/conversation" as const, params: { id } };
}

/** Ce qu'ouvre une notification touchée : la conversation d'un message
 * (`{ conversationId }`), l'envie d'une alerte (`{ wishlistItemId }` seul :
 * sa fiche charge tout depuis le serveur), ou vos Envies (alerte groupée,
 * sans aucune donnée) ; null si les données sont illisibles (rien ne
 * s'ouvre). Une notification de message porte toujours `conversationId` :
 * elle est lue en premier, jamais prise pour une alerte. */
export type NotificationTarget = { kind: "conversation"; id: string } | { kind: "wish"; id: string } | { kind: "wishes" };

export function notificationTarget(data: unknown): NotificationTarget | null {
  if (typeof data === "object" && data !== null && "conversationId" in data) {
    const conversation = conversationIdFromNotification(data);
    return conversation ? { kind: "conversation", id: conversation } : null;
  }
  const alert = parseWishAlertPushData(data);
  if (!alert) return null;
  return alert.wishlistItemId ? { kind: "wish", id: alert.wishlistItemId } : { kind: "wishes" };
}

/** Paramètre `from` de la fiche d'une envie ouverte par une alerte : le clic
 * vers la boutique est alors compté « price_alert » (MERCHANT_LINK_CONTEXTS). */
export const FROM_ALERT = "alerte";

/** L'écran à ouvrir pour une notification touchée. Vos Envies : l'onglet
 * Envies du Profil (lib/wishlist-link.ts, `segment`). */
export function notificationHref(target: NotificationTarget) {
  switch (target.kind) {
    case "conversation":
      return conversationHref(target.id);
    case "wish":
      return { pathname: "/envie" as const, params: { id: target.id, from: FROM_ALERT } };
    case "wishes":
      return { pathname: "/profile" as const, params: { segment: WISHLIST_SEGMENT } };
  }
}

// ---- Conversation affichée (pas de bannière pour elle : l'écran se relit déjà) ----

let openConversation: string | null = null;

export function setOpenConversation(id: string | null): void {
  openConversation = id;
}

/** Bannière d'une notification reçue app ouverte : oui, sauf pour la conversation à l'écran. */
export function shouldShowBanner(data: unknown): boolean {
  const id = conversationIdFromNotification(data);
  return id === null || id !== openConversation;
}

// ---- Notification touchée : ouverte une seule fois ----

const handled = new Set<string>();

/** Vrai la première fois seulement (au démarrage, la même notification peut
 * arriver deux fois : la dernière touchée, et l'écouteur). */
export function firstTimeHandled(identifier: string): boolean {
  if (handled.has(identifier)) return false;
  handled.add(identifier);
  return true;
}
