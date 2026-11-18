// Messages privés (lot messages) : la logique sans écran, testée à part
// (tests/messages.test.ts). Pas de temps réel : l'app relit pendant qu'un
// écran des messages est ouvert, toutes les 5 s, puis plus lentement quand
// rien ne bouge ou que le réseau échoue.
import type { ChatMessage, ConversationSendMode, ConversationSummary, ConversationThread, MessageQuote, MessagesStatus, MessageWishCard, SendMessageRequest } from "@monapp/shared-types";
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

// ---- Lot « messages, plus de confort » : aimer, répondre, supprimer, envoyer une publication ----

/** Après une relecture : les messages aimés ou supprimés depuis (`changed`)
 * remplacent ceux qui sont à l'écran, par leur identifiant. Un message changé
 * qui n'est pas à l'écran (plus ancien que la page chargée) n'est pas
 * ajouté : il arrivera à jour avec « messages précédents ». Rien n'a changé :
 * la même liste est rendue (l'écran ne se redessine pas). */
export function applyChanges(current: readonly ChatMessage[], changed: readonly ChatMessage[] | null | undefined): ChatMessage[] {
  if (!Array.isArray(changed) || changed.length === 0) return current as ChatMessage[];
  const byId = new Map(changed.map((message) => [message.id, message]));
  let touched = false;
  const next = current.map((message) => {
    const update = byId.get(message.id);
    if (!update || sameShown(message, update)) return message;
    touched = true;
    return update;
  });
  return touched ? next : (current as ChatMessage[]);
}

/** Deux versions d'un message montrent-elles la même chose ? */
function sameShown(a: ChatMessage, b: ChatMessage): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** La date à renvoyer au serveur à la relecture suivante (`changedSince`) :
 * celle de sa dernière réponse ; absente (serveur plus ancien, migration
 * absente) ou illisible, la précédente est gardée. */
export function nextSyncedAt(current: string | null, thread: Pick<ConversationThread, "syncedAt">): string | null {
  return typeof thread.syncedAt === "string" && thread.syncedAt !== "" ? thread.syncedAt : current;
}

/** Un message tel qu'il s'affiche une fois supprimé : plus de texte, de carte, de « j'aime » ni de citation. */
export function asDeleted(message: ChatMessage): ChatMessage {
  return { id: message.id, mine: message.mine, text: null, wish: null, post: null, deleted: true, createdAt: message.createdAt };
}

/** La liste après la disparition d'un message (supprimé par vous, ou signalé
 * par vous) : les réponses qui le citaient montrent « Message indisponible ».
 * `removed` : le message lui-même sort de la liste (signalement) ; sinon il
 * reste, vidé (« Message supprimé »). */
export function withoutContent(messages: readonly ChatMessage[], messageId: string, removed: boolean): ChatMessage[] {
  return messages
    .filter((message) => !(removed && message.id === messageId))
    .map((message) => {
      if (message.id === messageId) return asDeleted(message);
      if (message.replyTo?.id !== messageId) return message;
      return { ...message, replyTo: { id: messageId, mine: false, kind: "unavailable" as const, excerpt: null } };
    });
}

/** Un message avec votre « j'aime » posé ou retiré, en attendant la réponse du serveur. */
export function withLike(message: ChatMessage, liked: boolean): ChatMessage {
  return { ...message, liked: { mine: liked, theirs: message.liked?.theirs === true } };
}

/** Ce que VoiceOver lit pour le cœur sous un message ; null : personne ne l'aime. */
export function likeLabel(message: Pick<ChatMessage, "liked">, otherName: string): string | null {
  const mine = message.liked?.mine === true;
  const theirs = message.liked?.theirs === true;
  if (mine && theirs) return t.messageActions.likedByBoth(otherName);
  if (mine) return t.messageActions.likedByYou;
  return theirs ? t.messageActions.likedBy(otherName) : null;
}

/** Le texte d'un message cité : son extrait, ou ce qu'il était. */
export function quoteText(quote: MessageQuote): string {
  if (quote.kind === "unavailable") return t.messageActions.quoteUnavailable;
  if (quote.kind === "post") return t.messageActions.previewPost;
  return quote.excerpt ?? (quote.kind === "wish" ? t.messages.previewWish : t.messageActions.quoteUnavailable);
}

/** Le message auquel la personne s'apprête à répondre (barre au-dessus du champ). */
export interface ReplyTarget {
  id: string;
  /** « Réponse à Alice », « Réponse à vous-même ». */
  title: string;
  excerpt: string;
}

export function replyTargetOf(message: ChatMessage, otherName: string): ReplyTarget {
  const excerpt = message.text ?? message.wish?.title ?? (message.post ? t.messageActions.previewPost : "");
  return { id: message.id, title: message.mine ? t.messageActions.replyingToSelf : t.messageActions.replyingTo(otherName), excerpt };
}

/** Ce que la personne peut faire d'un message, dans l'ordre de la feuille :
 * - voir la publication envoyée, si elle est disponible (VoiceOver lit la
 *   bulle comme un seul élément : la carte ne peut pas y être touchée) ;
 * - aimer et répondre : seulement si le serveur a ces actions, pour un
 *   message qui n'est pas supprimé ; aimer demande une conversation ouverte,
 *   répondre de pouvoir écrire ;
 * - supprimer : ses propres messages ;
 * - signaler et bloquer : les messages reçus, toujours (règle 1.2 d'Apple),
 *   même supprimés, même sur un serveur plus ancien. */
export type MessageAction = "openPost" | "like" | "unlike" | "reply" | "delete" | "report" | "block";

export function messageActionsFor(
  message: Pick<ChatMessage, "mine" | "deleted" | "liked" | "post">,
  context: { actions: boolean; open: boolean; canWrite: boolean }
): MessageAction[] {
  const list: MessageAction[] = [];
  const live = context.actions && message.deleted !== true;
  if (message.deleted !== true && message.post?.available === true) list.push("openPost");
  if (live && context.open) list.push(message.liked?.mine === true ? "unlike" : "like");
  if (live && context.canWrite) list.push("reply");
  if (live && message.mine) list.push("delete");
  if (!message.mine) list.push("report", "block");
  return list;
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
 * réponse illisible, valent « messagerie indisponible » (l'entrée est cachée).
 * `push` (lot notifications) : vrai seulement si le serveur le dit
 * exactement ; absent (serveur plus ancien) ou illisible, les notifications
 * ne sont jamais proposées. */
export function readMessagesStatus(body: unknown): MessagesStatus {
  if (typeof body !== "object" || body === null) return { enabled: false, unreadCount: 0, push: false, actions: false };
  const { enabled, unreadCount, push, actions } = body as Record<string, unknown>;
  const count = typeof unreadCount === "number" && Number.isInteger(unreadCount) && unreadCount > 0 ? unreadCount : 0;
  // `actions` (lot « messages, plus de confort ») : comme `push`, vrai seulement si le serveur le dit exactement.
  return enabled === true ? { enabled: true, unreadCount: count, push: push === true, actions: actions === true } : { enabled: false, unreadCount: 0, push: false, actions: false };
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
  // Lot « messages, plus de confort » : jamais le contenu d'un message supprimé, ni rien d'une publication.
  if (last.deleted) return t.messageActions.deleted;
  const text = last.text ?? (last.hasWish ? t.messages.previewWish : last.hasPost ? t.messageActions.previewPost : "");
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

/** Nature de la carte jointe au message en cours : une de vos Envies (par
 * défaut), une envie d'une collection de la personne (« En parler »), ou une
 * proposition d'une de vos recherches (« Envoyer à un ami », écran Résultat). */
export type AttachedKind = "wish" | "collectionItem" | "match" | "post";

/** La carte telle que POST /api/messages l'attend (une seule à la fois).
 * `post` (lot « messages, plus de confort ») : une publication du fil. */
export function attachmentFor(card: { id: string; kind?: AttachedKind } | null): Pick<SendMessageRequest, "wishId" | "collectionItemId" | "matchId" | "postId"> {
  if (!card) return {};
  if (card.kind === "collectionItem") return { collectionItemId: card.id };
  if (card.kind === "match") return { matchId: card.id };
  if (card.kind === "post") return { postId: card.id };
  return { wishId: card.id };
}

/** Ce qui s'affiche au-dessus du champ pour la carte jointe, et son bouton « retirer ». */
export function attachedLabels(card: { title: string; kind?: AttachedKind }): { title: string; remove: string } {
  if (card.kind === "post") return { title: card.title, remove: t.messageActions.removePost };
  return card.kind === "match"
    ? { title: t.messages.attachedPiece(card.title), remove: t.messages.removePiece }
    : { title: t.messages.attachedWish(card.title), remove: t.messages.removeWish };
}

/** Prix de la carte d'une envie, ou null. */
export function wishCardPrice(card: Pick<MessageWishCard, "priceMin" | "currency">, locale: Locale): string | null {
  return card.priceMin === null ? null : formatPrice(card.priceMin, card.currency, locale);
}

// ---- Disponibilité et non-lus, partagés entre les écrans ----

let current: MessagesStatus = { enabled: false, unreadCount: 0, push: false, actions: false };
const listeners = new Set<(status: MessagesStatus) => void>();

export function messagesStatus(): MessagesStatus {
  return current;
}

/** Nouvel état lu sur le serveur : les écrans abonnés sont prévenus s'il change. */
export function setMessagesStatus(next: MessagesStatus): void {
  if (
    next.enabled === current.enabled &&
    next.unreadCount === current.unreadCount &&
    (next.push === true) === (current.push === true) &&
    (next.actions === true) === (current.actions === true)
  )
    return;
  current = next;
  for (const listener of listeners) listener(current);
}

export function onMessagesStatus(listener: (status: MessagesStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
