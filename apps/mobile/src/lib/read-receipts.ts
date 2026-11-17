// Confirmations de lecture (lot « messages vus ») : la logique sans écran,
// testée à part (tests/read-receipts.test.ts). Dans une conversation
// ouverte, sous votre DERNIER message : « Vu » quand l'autre membre a ouvert
// la conversation après ce message, « Envoyé » sinon. Le serveur décide de
// ce qu'il montre (`readReceipts`, renvoyé à chaque lecture, relecture et
// envoi) ; null : rien à afficher (invitation, réglage « Confirmations de
// lecture » éteint chez l'un des deux, serveur qui ne les connaît pas).
import type { ChatMessage, ConversationReadReceipts, ConversationThread, SendMessageResponse } from "@monapp/shared-types";
import { t } from "../i18n";

/** Une date du serveur en millisecondes (NaN : illisible). La base écrit
 * jusqu'à six chiffres après la seconde : ramenés à trois, la seule forme que
 * tous les moteurs JavaScript lisent de la même façon. */
function toMs(iso: string): number {
  return Date.parse(iso.replace(/\.(\d+)/, (_, digits: string) => `.${digits.slice(0, 3).padEnd(3, "0")}`));
}

/** `readReceipts` tel que le serveur l'a renvoyé, relu sans lui faire
 * confiance. Absent (serveur plus ancien), null ou illisible : rien à
 * afficher, jamais « Envoyé » par défaut. */
export function readReadReceipts(value: unknown): ConversationReadReceipts | null {
  if (typeof value !== "object" || value === null) return null;
  const { seenAt } = value as Record<string, unknown>;
  if (seenAt === null) return { seenAt: null };
  return typeof seenAt === "string" && Number.isFinite(toMs(seenAt)) ? { seenAt } : null;
}

export type ReceiptStatus = "seen" | "sent";

/** Ce message est-il vu ? « seen » : l'autre membre a ouvert la conversation
 * au moment de ce message ou après ; « sent » : pas encore ; null : rien à
 * afficher (pas de confirmations, ou date illisible). */
export function receiptStatus(receipts: ConversationReadReceipts | null | undefined, messageCreatedAt: string): ReceiptStatus | null {
  if (!receipts) return null;
  if (receipts.seenAt === null) return "sent";
  const seenAt = toMs(receipts.seenAt);
  const sentAt = toMs(messageCreatedAt);
  if (!Number.isFinite(seenAt) || !Number.isFinite(sentAt)) return null;
  return seenAt >= sentAt ? "seen" : "sent";
}

/** Votre dernier message de la conversation (le plus récent affiché), ou null. */
export function lastOwnMessage(messages: readonly ChatMessage[]): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.mine) return message;
  }
  return null;
}

/** La mention sous un message : son texte, et ce que lit VoiceOver. */
export interface ReceiptMention {
  messageId: string;
  status: ReceiptStatus;
  text: string;
  label: string;
}

/** La mention à afficher, et sous quel message : seulement sous votre dernier
 * message. null : rien (aucun message de vous, ou pas de confirmations). */
export function receiptMention(messages: readonly ChatMessage[], receipts: ConversationReadReceipts | null | undefined, otherName: string): ReceiptMention | null {
  const last = lastOwnMessage(messages);
  if (!last) return null;
  const status = receiptStatus(receipts, last.createdAt);
  if (!status) return null;
  return status === "seen"
    ? { messageId: last.id, status, text: t.messages.receiptSeen, label: t.messages.receiptSeenLabel(otherName) }
    : { messageId: last.id, status, text: t.messages.receiptSent, label: t.messages.receiptSentLabel };
}

/** Deux réponses du serveur disent-elles la même chose ? */
export function sameReceipts(a: ConversationReadReceipts | null | undefined, b: ConversationReadReceipts | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.seenAt === b.seenAt;
}

/** Une conversation reçue du serveur, confirmations relues. */
export function withReadReceipts(thread: ConversationThread): ConversationThread {
  return { ...thread, readReceipts: readReadReceipts(thread.readReceipts) };
}

/** La conversation à l'écran après une relecture : l'autre membre, l'état,
 * ce qu'on peut écrire et les confirmations de lecture suivent le serveur ;
 * le reste (identifiant, « messages précédents ») ne bouge pas. */
export function threadAfterPoll(current: ConversationThread | null, polled: ConversationThread): ConversationThread {
  if (!current) return withReadReceipts(polled);
  return { ...current, other: polled.other, state: polled.state, sendMode: polled.sendMode, readReceipts: readReadReceipts(polled.readReceipts) };
}

/** La conversation à l'écran après un envoi : son identifiant (premier
 * message), son état et les confirmations de lecture, tels que le serveur
 * les renvoie avec le message. */
export function threadAfterSend(current: ConversationThread, sent: SendMessageResponse): ConversationThread {
  return { ...current, id: sent.conversationId, state: sent.state, sendMode: sent.sendMode, readReceipts: readReadReceipts(sent.readReceipts) };
}
