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
// Module natif et appels au serveur : push.ts (site : push.web.ts).
import type { MessagesStatus } from "@monapp/shared-types";

/** Réponse de la personne, gardée sur l'appareil, par compte. */
export type PushDecision = "on" | "off";
/** Autorisation d'iOS. */
export type PushPermission = "granted" | "denied" | "undetermined";

export function pushDecisionKey(userId: string): string {
  return `spotto.push-decision.${userId}`;
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
