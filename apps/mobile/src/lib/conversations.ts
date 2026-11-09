// Messages privés (lot messages) : la logique sans écran, testée à part
// (tests/messages.test.ts). Pas de temps réel : l'app relit pendant qu'un
// écran des messages est ouvert, toutes les 5 s, puis plus lentement quand
// rien ne bouge ou que le réseau échoue.
import type { ChatMessage, ConversationSendMode, ConversationSummary, MessagesStatus, MessageWishCard } from "@monapp/shared-types";
import { t } from "../i18n";
import { formatPrice } from "./format";
import type { Locale } from "./preferences";

/** Relecture rapide, tant qu'il se passe quelque chose. */
export const POLL_BASE_MS = 5_000;
/** Rien de nouveau depuis un moment : au plus toutes les 30 s. */
export const POLL_IDLE_MAX_MS = 30_000;
/** Le réseau échoue : au plus toutes les 60 s. */
export const POLL_ERROR_MAX_MS = 60_000;
/** Relectures sans nouveauté avant de ralentir. */
const CALM_POLLS = 3;

export interface PollState {
  delay: number;
  /** Relectures de suite sans nouveauté. */
  calm: number;
}

export const INITIAL_POLL: PollState = { delay: POLL_BASE_MS, calm: 0 };

/** Délai avant la relecture suivante : 5 s quand il y a du nouveau (ou après
 * un envoi), puis ×1,5 après trois relectures calmes (30 s au plus) ;
 * doublé à chaque échec du réseau (60 s au plus). */
export function nextPoll(state: PollState, outcome: "new" | "same" | "error"): PollState {
  if (outcome === "new") return INITIAL_POLL;
  if (outcome === "error") return { delay: Math.min(state.delay * 2, POLL_ERROR_MAX_MS), calm: state.calm };
  const calm = state.calm + 1;
  if (calm < CALM_POLLS) return { delay: Math.min(state.delay, POLL_IDLE_MAX_MS), calm };
  return { delay: Math.min(Math.round(state.delay * 1.5), POLL_IDLE_MAX_MS), calm };
}

/** Messages réunis sans doublon (une relecture peut renvoyer un message déjà
 * affiché), du plus ancien au plus récent. */
export function mergeMessages(current: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** Date du dernier message reçu (curseur `after` de la relecture), ou null. */
export function newestCreatedAt(messages: readonly ChatMessage[]): string | null {
  return messages.reduce<string | null>((newest, message) => (newest === null || message.createdAt > newest ? message.createdAt : newest), null);
}

/** Un message de l'autre membre est arrivé : à marquer comme lu. */
export function hasNewFromOther(before: readonly ChatMessage[], after: readonly ChatMessage[]): boolean {
  const known = new Set(before.map((message) => message.id));
  return after.some((message) => !message.mine && !known.has(message.id));
}

/** Réponse de GET /api/messages/status : un serveur plus ancien, ou une
 * réponse illisible, valent « messagerie indisponible » (l'entrée est cachée). */
export function readMessagesStatus(body: unknown): MessagesStatus {
  if (typeof body !== "object" || body === null) return { enabled: false, unreadCount: 0 };
  const { enabled, unreadCount } = body as Record<string, unknown>;
  const count = typeof unreadCount === "number" && Number.isInteger(unreadCount) && unreadCount > 0 ? unreadCount : 0;
  return enabled === true ? { enabled: true, unreadCount: count } : { enabled: false, unreadCount: 0 };
}

/** Pastille de l'onglet Activité : notifications ou messages non lus. */
export function activityUnread(notifications: number, status: MessagesStatus): number {
  return notifications + (status.enabled ? status.unreadCount : 0);
}

/** Libellé du compteur de l'entrée Messages (« 3 », « 99+ »), ou null. */
export function unreadBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

/** L'entrée « Messages » de l'Activité : son libellé (lu par VoiceOver) et
 * son compteur ; null quand la messagerie n'est pas disponible (entrée cachée). */
export function messagesEntry(status: MessagesStatus): { label: string; badge: string | null } | null {
  if (!status.enabled) return null;
  return { label: t.messages.entryLabel(status.unreadCount), badge: unreadBadge(status.unreadCount) };
}

/** Aperçu d'une conversation dans la liste. */
export function conversationPreview(summary: ConversationSummary): string {
  const last = summary.lastMessage;
  if (summary.state === "invitation_sent" && (!last || last.mine)) return t.messages.previewInvitationSent;
  if (!last) return "";
  if (last.hidden) return t.messages.hiddenMessage;
  const text = last.text ?? (last.hasWish ? t.messages.previewWish : "");
  return last.mine ? t.messages.previewMine(text) : text;
}

/** Ce que la personne peut faire sous la conversation : écrire, ou une explication. */
export function canWrite(mode: ConversationSendMode): boolean {
  return mode === "direct" || mode === "invitation";
}

/** Phrase sous la conversation quand il n'est pas (ou plus) possible d'écrire,
 * ou qu'il faut prévenir (invitation). null : rien à dire. */
export function composerNotice(mode: ConversationSendMode, otherName: string): string | null {
  switch (mode) {
    case "invitation":
      return t.messages.invitationNotice(otherName);
    case "waiting":
      return t.messages.waitingNotice(otherName);
    case "not_allowed":
      return t.messages.notAllowedNotice(otherName);
    case "answer":
      return t.messages.answerNotice(otherName);
    default:
      return null;
  }
}

/** Un message peut partir : un texte non vide, ou une envie jointe. */
export function canSend(text: string, wishId: string | null, maxLength: number): boolean {
  const trimmed = text.trim();
  return (trimmed.length > 0 || wishId !== null) && trimmed.length <= maxLength;
}

/** Prix de la carte d'une envie, ou null. */
export function wishCardPrice(card: Pick<MessageWishCard, "priceMin" | "currency">, locale: Locale): string | null {
  return card.priceMin === null ? null : formatPrice(card.priceMin, card.currency, locale);
}

// ---- Disponibilité et non-lus, partagés entre les écrans ----

let current: MessagesStatus = { enabled: false, unreadCount: 0 };
const listeners = new Set<(status: MessagesStatus) => void>();

export function messagesStatus(): MessagesStatus {
  return current;
}

/** Nouvel état lu sur le serveur : les écrans abonnés sont prévenus s'il change. */
export function setMessagesStatus(next: MessagesStatus): void {
  if (next.enabled === current.enabled && next.unreadCount === current.unreadCount) return;
  current = next;
  for (const listener of listeners) listener(current);
}

export function onMessagesStatus(listener: (status: MessagesStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
