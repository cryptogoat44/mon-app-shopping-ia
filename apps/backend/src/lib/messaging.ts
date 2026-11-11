// Messages privés (lot messages, migration 0032). Règles, sans réseau :
// - deux amis (chacun suit l'autre) s'écrivent directement ;
// - sinon, UNE invitation, selon le réglage « Qui peut m'écrire » de la
//   personne invitée ; tant qu'elle n'a pas répondu, rien d'autre ne part ;
// - elle accepte (la conversation s'ouvre pour les deux), refuse (la
//   conversation disparaît pour elle ; pas de nouvelle invitation pendant
//   30 jours, et la personne qui invite n'en sait rien : elle voit toujours
//   « en attente ») ou bloque ;
// - une conversation ouverte le reste (même sans abonnement) ; seul un
//   blocage, dans un sens ou dans l'autre, la cache et empêche d'écrire.
// Ici aussi : la sonde du schéma (le serveur fonctionne sans 0032 : routes
// « indisponibles », app sans entrée Messages) et les lectures communes.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  DEFAULT_MESSAGES_FROM,
  INVITATION_DECLINE_COOLDOWN_DAYS,
  MESSAGE_MAX_LENGTH,
  MESSAGES_FROM,
  type ChatMessage,
  type ConversationSendMode,
  type ConversationState,
  type MessagesFrom,
} from "@monapp/shared-types";
import { fetchAffiliateUrls } from "./affiliateLinks.js";
import type { OwnMatchRow } from "./ownMatches.js";
import { chunks, readAll } from "./pagedReads.js";
import { isFollowing } from "./visibility.js";
import { WEB_URL_MAX_LENGTH, parseDbRows, webUrlOrNull } from "./validation.js";
import type { ImageCopySource, WishRow } from "./wishShare.js";

// ---- Réponses ----

export const MESSAGES_UNAVAILABLE = { error: "messages_unavailable", message: "La messagerie n'est pas encore disponible." } as const;
/** Même réponse pour une conversation inexistante, d'un autre, refusée ou
 * en blocage : rien ne dit pourquoi. */
export const CONVERSATION_NOT_FOUND = { error: "conversation_not_found", message: "Conversation introuvable." } as const;
export const RECIPIENT_NOT_FOUND = { error: "recipient_not_found", message: "Personne introuvable." } as const;
export const RECIPIENT_NOT_ACCEPTING = { error: "recipient_not_accepting", message: "Cette personne ne reçoit pas de messages de votre part." } as const;
export const INVITATION_PENDING = {
  error: "invitation_pending",
  message: "Votre invitation attend une réponse : vous pourrez écrire de nouveau quand elle sera acceptée.",
} as const;
export const NOT_AN_INVITATION = { error: "not_an_invitation", message: "Cette conversation n'est pas une invitation." } as const;
export const MESSAGE_EMPTY = { error: "invalid_body", message: "Le message est vide." } as const;
export const MESSAGE_TOO_LONG = { error: "invalid_body", message: `Le message est trop long (${MESSAGE_MAX_LENGTH} caractères maximum).` } as const;
export const INVALID_MESSAGE = { error: "invalid_body", message: "Message invalide." } as const;
export const SELF_MESSAGE = { error: "invalid_body", message: "Vous ne pouvez pas vous écrire." } as const;

// ---- États (conversation_participants.invitation) ----

export const INVITATION_COLUMNS = ["none", "sent", "received", "declined"] as const;
export type InvitationColumn = (typeof INVITATION_COLUMNS)[number];

const ID = z.guid();
const TIMESTAMP = z.string().min(1);

export const SIDE_COLUMNS = "conversation_id, user_id, other_user_id, invitation, invitation_at, unread, last_read_at, cleared_at, last_message_at";
export const SIDE_ROWS = z.array(
  z.object({
    conversation_id: ID,
    user_id: ID,
    other_user_id: ID,
    invitation: z.enum(INVITATION_COLUMNS),
    invitation_at: TIMESTAMP.nullable(),
    unread: z.boolean(),
    last_read_at: TIMESTAMP.nullable(),
    cleared_at: TIMESTAMP.nullable(),
    last_message_at: TIMESTAMP,
  })
);
/** Le côté d'un membre dans une conversation. */
export type Side = z.infer<typeof SIDE_ROWS>[number];

export const MESSAGE_COLUMNS =
  "id, conversation_id, sender_id, body, wish_title, wish_image_url, wish_image_thumb_url, wish_merchant_name, wish_merchant_url, wish_product_match_id, wish_price_min, wish_currency, hidden_at, created_at";
export const MESSAGE_ROWS = z.array(
  z.object({
    id: ID,
    conversation_id: ID,
    sender_id: ID,
    body: z.string().nullable(),
    wish_title: z.string().nullable(),
    wish_image_url: z.string().nullable(),
    wish_image_thumb_url: z.string().nullable(),
    wish_merchant_name: z.string().nullable(),
    wish_merchant_url: z.string().nullable(),
    wish_product_match_id: ID.nullable(),
    wish_price_min: z.union([z.string(), z.number()]).nullable(),
    wish_currency: z.string().nullable(),
    hidden_at: TIMESTAMP.nullable(),
    created_at: TIMESTAMP,
  })
);
export type MessageRow = z.infer<typeof MESSAGE_ROWS>[number];

/** Les deux membres d'une conversation, dans l'ordre de la base (user_low < user_high). */
export function orderedPair(a: string, b: string): { user_low: string; user_high: string } {
  return a < b ? { user_low: a, user_high: b } : { user_low: b, user_high: a };
}

/** La personne invitée accepte-t-elle une invitation de l'expéditeur ? */
export function acceptsInvitation(setting: MessagesFrom, recipientFollowsSender: boolean): boolean {
  if (setting === "everyone") return true;
  if (setting === "following") return recipientFollowsSender;
  return false;
}

const COOLDOWN_MS = INVITATION_DECLINE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

/** 30 jours écoulés depuis le refus (date absente ou illisible : pas encore). */
export function cooldownOver(declinedAt: string | null, now: number): boolean {
  const at = Date.parse(declinedAt ?? "");
  return Number.isFinite(at) && now - at >= COOLDOWN_MS;
}

/** Ce qui lie l'expéditeur à la personne qui reçoit. */
export interface Relation {
  /** Chacun suit l'autre. */
  mutual: boolean;
  /** Son réglage « Qui peut m'écrire » permet une invitation de l'expéditeur. */
  recipientAccepts: boolean;
}

/** Issue d'un envoi : les états à écrire (s'ils changent), ou un refus.
 * `invitation` : cet envoi crée une invitation (limite par heure). */
export type SendPlan =
  | { ok: true; create: boolean; invitation: boolean; mine: InvitationColumn; theirs: InvitationColumn; clearMine: boolean }
  | { ok: false; refusal: "pending" | "not_accepting" };

const OPEN = { ok: true, invitation: false, mine: "none", theirs: "none", clearMine: false } as const;
const INVITE = { ok: true, invitation: true, mine: "sent", theirs: "received", clearMine: false } as const;

/** Règles d'envoi, sans réseau. `mine` / `theirs` : les côtés de
 * l'expéditeur et de la personne qui reçoit, null sans conversation. */
export function planSend(mine: Pick<Side, "invitation"> | null, theirs: Pick<Side, "invitation" | "invitation_at"> | null, relation: Relation, now: number): SendPlan {
  if (mine === null || theirs === null) {
    if (relation.mutual) return { ...OPEN, create: true };
    return relation.recipientAccepts ? { ...INVITE, create: true } : { ok: false, refusal: "not_accepting" };
  }
  switch (mine.invitation) {
    case "none":
      return { ...OPEN, create: false };
    // Répondre à une invitation reçue vaut acceptation.
    case "received":
      return { ...OPEN, create: false };
    // L'invitation reçue avait été refusée : écrire à cette personne, qui
    // avait invité la première, ouvre la conversation (l'historique revient).
    case "declined":
      return { ...OPEN, create: false, clearMine: true };
    case "sent":
      if (relation.mutual) return { ...OPEN, create: false };
      if (theirs.invitation === "declined" && cooldownOver(theirs.invitation_at, now)) {
        return relation.recipientAccepts ? { ...INVITE, create: false } : { ok: false, refusal: "not_accepting" };
      }
      return { ok: false, refusal: "pending" };
  }
}

/** État de la conversation pour la personne qui lit. */
export function viewerState(mine: Pick<Side, "invitation"> | null): ConversationState {
  if (mine === null || mine.invitation === "declined") return "new";
  if (mine.invitation === "sent") return "invitation_sent";
  if (mine.invitation === "received") return "invitation_received";
  return "open";
}

/** Ce que la personne qui lit peut écrire. */
export function sendModeFor(mine: Pick<Side, "invitation"> | null, theirs: Pick<Side, "invitation" | "invitation_at"> | null, relation: Relation, now: number): ConversationSendMode {
  if (mine?.invitation === "received") return "answer";
  const plan = planSend(mine, theirs, relation, now);
  if (!plan.ok) return plan.refusal === "pending" ? "waiting" : "not_allowed";
  return plan.invitation ? "invitation" : "direct";
}

/** Les relations ne sont relues que si elles peuvent changer la réponse. */
export function needsRelation(mine: Pick<Side, "invitation"> | null): boolean {
  return mine === null || mine.invitation === "sent" || mine.invitation === "declined";
}

const SETTING_ROWS = z.array(z.object({ id: ID, messages_from: z.enum(MESSAGES_FROM).default(DEFAULT_MESSAGES_FROM) }));

/** Abonnements dans les deux sens et réglage de la personne qui reçoit. */
export async function readRelation(fastify: FastifyInstance, senderId: string, recipientId: string, setting?: MessagesFrom): Promise<Relation> {
  const [senderFollows, recipientFollows, messagesFrom] = await Promise.all([
    isFollowing(fastify, senderId, recipientId),
    isFollowing(fastify, recipientId, senderId),
    setting !== undefined
      ? setting
      : fastify.supabaseAdmin
          .from("profiles")
          .select("id, messages_from")
          .eq("id", recipientId)
          .limit(1)
          .then((result) => parseDbRows(SETTING_ROWS, result, "Réglage « Qui peut m'écrire »")[0]?.messages_from ?? "nobody"),
  ]);
  return { mutual: senderFollows && recipientFollows, recipientAccepts: acceptsInvitation(messagesFrom, recipientFollows) };
}

// ---- Lectures communes ----

/** Le côté de `userId` dans la conversation, ou null. */
export async function readSide(fastify: FastifyInstance, conversationId: string, userId: string): Promise<Side | null> {
  const rows = parseDbRows(
    SIDE_ROWS,
    await fastify.supabaseAdmin.from("conversation_participants").select(SIDE_COLUMNS).eq("conversation_id", conversationId).eq("user_id", userId).limit(1),
    "Côté d'une conversation"
  );
  return rows[0] ?? null;
}

const CONVERSATION_ROWS = z.array(z.object({ id: ID }));

/** La conversation entre ces deux membres (au plus une), ou null. */
export async function findConversationId(fastify: FastifyInstance, a: string, b: string): Promise<string | null> {
  const pair = orderedPair(a, b);
  const rows = parseDbRows(
    CONVERSATION_ROWS,
    await fastify.supabaseAdmin.from("conversations").select("id").eq("user_low", pair.user_low).eq("user_high", pair.user_high).limit(1),
    "Conversation d'une paire"
  );
  return rows[0]?.id ?? null;
}

// ---- Carte jointe (colonnes wish_* de messages, migration 0032) ----

/** Titre et nom de la boutique d'une carte : 120 caractères au plus (base). */
const CARD_TEXT_MAX = 120;

/** Les colonnes wish_* d'un message, sans l'image (copiée à part). */
export interface CardColumns {
  wish_title: string;
  wish_merchant_name: string | null;
  wish_merchant_url: string | null;
  wish_product_match_id: string | null;
  wish_price_min: string | number | null;
  wish_currency: string | null;
}

/** Une carte jointe à un message : ses colonnes, et d'où copier son image
 * (lib/wishShare.ts, copyWishImage : même choix de la plus grande image). */
export interface AttachedCard {
  columns: CardColumns;
  imageSource: ImageCopySource;
}

/** Coupe sans laisser une moitié d'émoji à la fin. */
function clip(text: string, max: number): string {
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** Une envie jointe (la sienne, ou celle d'une collection de la personne). */
export function wishCard(wish: WishRow): AttachedCard {
  return {
    columns: {
      wish_title: wish.title.trim().slice(0, CARD_TEXT_MAX),
      wish_merchant_name: wish.merchant_name?.slice(0, CARD_TEXT_MAX) ?? null,
      // Recopié seulement si c'est un lien web ordinaire (envie rangée plus tôt).
      wish_merchant_url: webUrlOrNull(wish.merchant_url),
      wish_product_match_id: wish.product_match_id,
      wish_price_min: wish.price_min,
      wish_currency: wish.currency,
    },
    imageSource: wish,
  };
}

/** Un résultat d'une recherche de l'expéditeur, envoyé à un ami sans être
 * gardé dans ses Envies. Titre : le nom du produit (sinon la marque, puis la
 * boutique) ; null s'il n'y a rien à montrer. Lien : seulement un lien web
 * ordinaire que la base peut garder (2 048 caractères au plus). Sans lui, la
 * carte ne garde pas le résultat d'origine : son lien affilié (« direct »,
 * le même lien) ne passerait pas à sa place. L'image haute définition du
 * résultat sert quand même à la copie. */
export function matchCard(match: OwnMatchRow): AttachedCard | null {
  const title = [match.product_name, match.brand, match.merchant_name]
    .map((text) => clip(text?.trim() ?? "", CARD_TEXT_MAX).trim())
    .find((text) => text !== "");
  if (!title) return null;
  const merchantUrl = match.merchant_url.length <= WEB_URL_MAX_LENGTH ? webUrlOrNull(match.merchant_url) : null;
  return {
    columns: {
      wish_title: title,
      wish_merchant_name: match.merchant_name ? clip(match.merchant_name, CARD_TEXT_MAX) : null,
      wish_merchant_url: merchantUrl,
      wish_product_match_id: merchantUrl ? match.id : null,
      wish_price_min: match.price_min,
      wish_currency: match.currency,
    },
    imageSource: { image_url: match.image_url, product_match_id: match.id },
  };
}

function priceOf(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

/** Messages renvoyés à l'app, avec le lien de l'envie jointe (affilié s'il
 * existe, toujours un lien web ordinaire). */
export async function toChatMessages(fastify: FastifyInstance, rows: MessageRow[], viewerId: string): Promise<ChatMessage[]> {
  const matchIds = [...new Set(rows.map((row) => row.wish_product_match_id).filter((id): id is string => id !== null))];
  const affiliateUrls = await fetchAffiliateUrls(fastify, matchIds);
  return rows.map((row) => {
    const affiliateUrl = row.wish_product_match_id ? (affiliateUrls.get(row.wish_product_match_id) ?? null) : null;
    const wish =
      row.wish_title !== null && row.wish_image_url !== null && row.wish_image_thumb_url !== null
        ? {
            title: row.wish_title,
            imageUrl: row.wish_image_url,
            imageThumbUrl: row.wish_image_thumb_url,
            merchantName: row.wish_merchant_name,
            merchantUrl: webUrlOrNull(affiliateUrl ?? row.wish_merchant_url),
            isAffiliate: affiliateUrl !== null && affiliateUrl !== row.wish_merchant_url,
            productMatchId: row.wish_product_match_id,
            priceMin: priceOf(row.wish_price_min),
            currency: row.wish_currency,
          }
        : null;
    return { id: row.id, mine: row.sender_id === viewerId, text: row.body, wish, createdAt: row.created_at };
  });
}

// ---- Suppression du compte ----

const COPY_ROWS = z.array(z.object({ id: ID, sender_id: ID, wish_image_url: z.string().nullable(), wish_image_thumb_url: z.string().nullable() }));

/** Copies d'images des envies jointes par les AUTRES membres dans les
 * conversations de `userId` : rangées chez eux, elles ne partent pas avec le
 * dossier de `userId`, alors que ces conversations disparaissent avec son
 * compte (cascade). Ses propres copies sont dans son dossier. Lecture
 * impossible : erreur (la suppression du compte s'arrête, comme pour les
 * pièces reçues). */
export async function otherMembersMessageCopies(fastify: FastifyInstance, userId: string): Promise<{ ownerId: string; url: string }[]> {
  const db = fastify.supabaseAdmin;
  const sides = await readAll<{ conversation_id: string }>(
    "Conversations du compte (suppression)",
    () => db.from("conversation_participants").select("conversation_id", { count: "exact" }).eq("user_id", userId),
    ["conversation_id"]
  );
  const copies: { ownerId: string; url: string }[] = [];
  for (const part of chunks(sides.map((side) => side.conversation_id))) {
    const rows = await readAll<unknown>(
      "Envies jointes reçues (suppression)",
      () => db.from("messages").select("id, sender_id, wish_image_url, wish_image_thumb_url", { count: "exact" }).in("conversation_id", part).neq("sender_id", userId).not("wish_image_url", "is", null),
      ["id"]
    );
    for (const row of parseDbRows(COPY_ROWS, { data: rows, error: null }, "Envies jointes reçues")) {
      for (const url of [row.wish_image_url, row.wish_image_thumb_url]) if (url) copies.push({ ownerId: row.sender_id, url });
    }
  }
  return copies;
}

// ---- Schéma de la base (migration 0032) ----

/** Sonde refaite au plus toutes les 5 minutes tant que 0032 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

async function probeSchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  try {
    const db = fastify.supabaseAdmin;
    const checks = await Promise.all([
      db.from("conversations").select("id, last_message_id").limit(0),
      db.from("conversation_participants").select("conversation_id, invitation, unread").limit(0),
      db.from("messages").select("id, wish_title").limit(0),
      db.from("profiles").select("messages_from").limit(0),
    ]);
    const failed = checks.find((check) => check.error);
    if (!failed) return true;
    fastify.log.warn({ code: failed.error?.code ?? null }, "Messages coupés : migration 0032 absente");
  } catch {
    fastify.log.warn({ code: null }, "Messages coupés : schéma illisible");
  }
  return false;
}

/** La base a-t-elle la migration 0032 ? Mémorisé une fois vu ; absente, un
 * avertissement, puis la sonde n'est refaite qu'au bout de 5 minutes. Sans
 * elle : routes des messages « indisponibles », export et suppression de
 * compte sans messages. */
export async function messagesReady(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<boolean> {
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

/** Tests seulement : oublie la sonde. */
export function resetMessagesProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}
