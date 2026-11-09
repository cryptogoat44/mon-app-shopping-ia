// Notifications des nouveaux messages sur le téléphone (lot notifications,
// migration 0035). COUPÉES par défaut (PUSH_ENABLED, src/env.ts) : coupées,
// aucun appareil n'est enregistré et rien ne part.
//
// Comment ça marche : l'app iPhone enregistre le jeton que lui donne Expo
// (PUT /api/me/push-token) ; quand un message est enregistré, le serveur
// demande au service d'Expo (gratuit, sans clé) de prévenir les appareils de
// la personne qui le reçoit, et Expo relaie à Apple.
//
// Confidentialité d'abord :
// - le titre est « Spotto », le texte dit seulement qui écrit (« Nouveau
//   message de @pseudo », « Invitation de @pseudo »), dans la langue de la
//   personne qui reçoit ; jamais le texte du message ni l'envie jointe ;
// - les données jointes : l'identifiant de la conversation, rien d'autre ;
// - le journal : des nombres et des codes, jamais un jeton ni un texte.
//
// Jamais pour ses propres messages, ni entre deux comptes en blocage, ni
// depuis un compte suspendu, ni vers une conversation refusée.
// Regroupement : au plus une notification par conversation et par personne
// toutes les 2 minutes, compté en mémoire (un redémarrage du serveur remet
// le compte à zéro : au pire, une notification de plus).
// Envoi « lancé puis oublié » : la réponse de l'envoi du message n'attend
// jamais Expo, et une panne d'Expo ne change rien à l'envoi.
//
// Lot alertes prix et stock (migration 0036) : l'envoi lui-même est commun
// (sendPush : un destinataire, une sorte, un texte, des données), et sert aussi
// aux alertes (lib/wishAlertsSend.ts). Un appareil peut rester enregistré pour
// les seules alertes (push_tokens.notify_messages = false) : il ne reçoit
// alors aucune notification de message. Sans 0036, tout est comme avant.
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { EXPO_PUSH_TOKEN_PATTERN, PUSH_PLATFORMS, type PushPlatform } from "@monapp/shared-types";
import { env } from "../env.js";
import { readSide } from "./messaging.js";
import { isSuspended } from "./moderation.js";
import { safeFetch } from "./safeFetch.js";
import { parseDbRows } from "./validation.js";
import { isBlockedEitherWay } from "./visibility.js";
import { wishAlertsReady } from "./wishAlertsSchema.js";

// ---- Réponses ----

export const PUSH_UNAVAILABLE = { error: "push_unavailable", message: "Les notifications ne sont pas disponibles." } as const;
export const INVALID_PUSH_TOKEN = { error: "invalid_push_token", message: "Jeton de notification invalide." } as const;

/** Corps de PUT /api/me/push-token : un jeton d'Expo, son système, et
 * (lot alertes prix) s'il reçoit les notifications des messages. */
export const registerPushTokenSchema = z.object({
  token: z.string().max(200).regex(EXPO_PUSH_TOKEN_PATTERN),
  platform: z.enum(PUSH_PLATFORMS),
  messages: z.boolean().optional(),
});
/** Corps de DELETE /api/me/push-token. */
export const deletePushTokenSchema = z.object({ token: z.string().max(200).regex(EXPO_PUSH_TOKEN_PATTERN) });

/** L'interrupteur : seule la valeur exacte "true" de PUSH_ENABLED l'allume. */
export function pushEnabled(): boolean {
  return env.PUSH_ENABLED;
}

// ---- Schéma de la base (migration 0035) ----

/** Sonde refaite au plus toutes les 5 minutes tant que 0035 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

async function probeSchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  try {
    const { error } = await fastify.supabaseAdmin.from("push_tokens").select("token, user_id, platform, created_at, updated_at, last_error").limit(0);
    if (!error) return true;
    fastify.log.warn({ code: error.code ?? null }, "Notifications coupées : migration 0035 absente");
  } catch {
    fastify.log.warn({ code: null }, "Notifications coupées : schéma illisible");
  }
  return false;
}

/** La base a-t-elle la migration 0035 ? Même sonde que pour les messages
 * (lib/messaging.ts) : mémorisée une fois vue ; absente, un avertissement,
 * puis la sonde n'est refaite qu'au bout de 5 minutes. Sans elle : rien
 * n'est enregistré ni envoyé, l'app n'en parle pas. */
export async function pushReady(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<boolean> {
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

/** Notifications réellement possibles : interrupteur allumé ET 0035 présente. */
export async function pushAvailable(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  return pushEnabled() && (await pushReady(fastify));
}

/** Tests seulement : oublie la sonde. */
export function resetPushProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}

// ---- Appareils enregistrés (push_tokens) ----

/** Appareils gardés au plus par compte : au-delà, le plus ancien est oublié. */
export const MAX_DEVICES_PER_ACCOUNT = 10;

/** Écriture impossible dans push_tokens (le message ne dit jamais le jeton). */
export class PushTokenStoreError extends Error {}

const TOKEN_ROWS = z.array(z.object({ token: z.string() }));

/** Enregistre l'appareil pour ce compte, ou le rafraîchit. Un jeton est à un
 * seul compte : le même téléphone connecté à un autre compte change de
 * propriétaire (l'ancien ne reçoit plus rien sur ce téléphone).
 * `messages` (lot alertes prix) : seulement avec 0036 ; absent, la valeur
 * enregistrée ne change pas (oui pour un nouvel appareil). */
export async function savePushToken(fastify: FastifyInstance, userId: string, token: string, platform: PushPlatform, messages?: boolean): Promise<void> {
  const db = fastify.supabaseAdmin;
  const now = new Date().toISOString();
  const kinds = messages !== undefined && (await wishAlertsReady(fastify)) ? { notify_messages: messages } : {};
  const values = { user_id: userId, platform, updated_at: now, last_error: null, ...kinds };
  const foreign = await db.from("push_tokens").delete().eq("token", token).neq("user_id", userId);
  if (foreign.error) throw new PushTokenStoreError("Appareil d'un autre compte : suppression impossible");
  const refresh = async (): Promise<boolean> => {
    const updated = await db.from("push_tokens").update(values).eq("token", token).eq("user_id", userId).select("token");
    if (updated.error) throw new PushTokenStoreError("Appareil : mise à jour impossible");
    return parseDbRows(TOKEN_ROWS, updated, "Appareil mis à jour").length > 0;
  };
  if (await refresh()) return;
  await makeRoom(fastify, userId);
  const inserted = await db.from("push_tokens").insert({ token, ...values, created_at: now });
  // Deux enregistrements simultanés du même appareil : la base n'en garde qu'un.
  if (inserted.error?.code === "23505" && (await refresh())) return;
  if (inserted.error) throw new PushTokenStoreError("Appareil : enregistrement impossible");
}

/** Place pour un nouvel appareil : les plus anciens au-delà de la limite sont oubliés. */
async function makeRoom(fastify: FastifyInstance, userId: string): Promise<void> {
  const db = fastify.supabaseAdmin;
  const rows = parseDbRows(
    TOKEN_ROWS,
    await db.from("push_tokens").select("token").eq("user_id", userId).order("updated_at", { ascending: false }).limit(MAX_DEVICES_PER_ACCOUNT + 50),
    "Appareils du compte"
  );
  const extra = rows.slice(MAX_DEVICES_PER_ACCOUNT - 1).map((row) => row.token);
  if (extra.length === 0) return;
  const { error } = await db.from("push_tokens").delete().eq("user_id", userId).in("token", extra);
  if (error) throw new PushTokenStoreError("Anciens appareils : suppression impossible");
}

/** Oublie cet appareil pour ce compte (sans effet s'il n'y est pas). */
export async function deletePushToken(fastify: FastifyInstance, userId: string, token: string): Promise<void> {
  const { error } = await fastify.supabaseAdmin.from("push_tokens").delete().eq("user_id", userId).eq("token", token);
  if (error) throw new PushTokenStoreError("Appareil : suppression impossible");
}

/** Suppression du compte : tous ses appareils (la base les efface aussi en cascade). */
export async function deleteAllPushTokens(fastify: FastifyInstance, userId: string): Promise<void> {
  const { error } = await fastify.supabaseAdmin.from("push_tokens").delete().eq("user_id", userId);
  if (error) throw new PushTokenStoreError("Appareils du compte : suppression impossible");
}

// ---- Contenu d'une notification ----

export const PUSH_TITLE = "Spotto";
/** Sortes de notifications : un message, une invitation, une alerte prix ou stock. */
export type PushKind = "direct" | "invitation" | "wish_alert";
type MessagePushKind = Exclude<PushKind, "wish_alert">;
type PushLocale = "fr" | "en";

const PUSH_BODIES: Record<MessagePushKind, Record<PushLocale, (username: string) => string>> = {
  direct: { fr: (username) => `Nouveau message de @${username}`, en: (username) => `New message from @${username}` },
  invitation: { fr: (username) => `Invitation de @${username}`, en: (username) => `Invitation from @${username}` },
};

/** Le texte d'une notification : qui écrit, jamais ce qui est écrit. */
export function pushBody(kind: MessagePushKind, username: string, locale: string | null | undefined): string {
  return PUSH_BODIES[kind][locale === "en" ? "en" : "fr"](username);
}

// ---- Regroupement (en mémoire) ----

export const COLLAPSE_WINDOW_MS = 2 * 60_000;
/** Au-delà, les entrées échues sont retirées (mémoire bornée). */
const COLLAPSE_PRUNE_AT = 10_000;
const lastPushAt = new Map<string, number>();

function collapseKey(recipientId: string, conversationId: string): string {
  return `${recipientId}:${conversationId}`;
}

function recentlyNotified(key: string, now: number): boolean {
  const at = lastPushAt.get(key);
  return at !== undefined && now - at < COLLAPSE_WINDOW_MS;
}

function rememberPush(key: string, now: number): void {
  if (lastPushAt.size >= COLLAPSE_PRUNE_AT) {
    for (const [other, at] of lastPushAt) if (now - at >= COLLAPSE_WINDOW_MS) lastPushAt.delete(other);
  }
  lastPushAt.set(key, now);
}

/** Tests seulement : oublie les notifications déjà envoyées. */
export function resetPushCollapse(): void {
  lastPushAt.clear();
}

// ---- Envoi par le service d'Expo ----

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_HOSTS = ["exp.host"];
/** Délai maximal d'une demande à Expo. */
export const PUSH_TIMEOUT_MS = 5_000;

/** Un nouveau message vient d'être enregistré. */
export interface NewMessagePush {
  senderId: string;
  recipientId: string;
  conversationId: string;
}

const PROFILE_ROWS = z.array(z.object({ id: z.string(), username: z.string().nullable(), locale: z.string().nullable().optional() }));
const CODE = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const TICKETS = z.object({
  data: z.array(
    z.object({
      status: z.string(),
      details: z.object({ error: z.string().optional() }).passthrough().nullable().optional(),
    }).passthrough()
  ),
});

/** Code d'erreur d'un reçu d'Expo (« DeviceNotRegistered »…), seulement s'il a la forme d'un code. */
function ticketCode(ticket: z.infer<typeof TICKETS>["data"][number]): string {
  const code = ticket.details?.error;
  return typeof code === "string" && CODE.test(code) ? code : "unknown";
}

const inFlight = new Set<Promise<void>>();

/** Prévient les appareils de la personne qui reçoit un message, sans jamais
 * faire attendre ni échouer l'envoi : à appeler juste après l'enregistrement
 * du message, sans `await`. Toute erreur finit au journal (son code seulement). */
export function notifyNewMessage(fastify: FastifyInstance, log: FastifyBaseLogger, push: NewMessagePush): void {
  if (!pushEnabled()) return;
  const task = sendNewMessagePush(fastify, log, push).catch((error: unknown) => {
    log.warn({ error }, "Notification de message non envoyée");
  });
  inFlight.add(task);
  void task.finally(() => inFlight.delete(task));
}

/** Tests seulement : attend la fin des notifications en cours. */
export async function flushPushes(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}

async function sendNewMessagePush(fastify: FastifyInstance, log: FastifyBaseLogger, push: NewMessagePush): Promise<void> {
  const { senderId, recipientId, conversationId } = push;
  if (senderId === recipientId) return;
  const key = collapseKey(recipientId, conversationId);
  if (recentlyNotified(key, Date.now())) {
    log.info({ outcome: "collapsed" }, "Notification de message regroupée");
    return;
  }
  if (!(await pushReady(fastify))) return;

  const db = fastify.supabaseAdmin;
  // Revérifié ici, quoi qu'ait décidé la route : jamais entre deux comptes en
  // blocage, jamais d'un compte suspendu, jamais vers une conversation refusée.
  const [blocked, suspended, side] = await Promise.all([
    isBlockedEitherWay(fastify, senderId, recipientId),
    isSuspended(fastify, senderId),
    readSide(fastify, conversationId, recipientId),
  ]);
  if (blocked || suspended || !side || side.other_user_id !== senderId || side.invitation === "declined") {
    log.info({ outcome: "skipped" }, "Notification de message non due");
    return;
  }
  const tokens = await readPushTokens(fastify, recipientId, "direct");
  if (tokens.length === 0) return;
  const profiles = parseDbRows(PROFILE_ROWS, await db.from("profiles").select("id, username, locale").in("id", [senderId, recipientId]), "Profils de la notification");
  const username = profiles.find((row) => row.id === senderId)?.username;
  if (!username) return;
  const locale = profiles.find((row) => row.id === recipientId)?.locale;

  // Revérifié juste avant l'envoi, sans attente entre la lecture et la
  // réservation : deux messages simultanés ne font qu'une notification.
  const now = Date.now();
  if (recentlyNotified(key, now)) {
    log.info({ outcome: "collapsed" }, "Notification de message regroupée");
    return;
  }
  rememberPush(key, now);

  const kind = side.invitation === "received" ? "invitation" : "direct";
  await deliverPush(fastify, log, tokens, { kind, body: pushBody(kind, username, locale), data: { conversationId } });
}

// ---- Envoi commun (messages et alertes) ----

/** Messages ou alertes : seulement pour le journal et le choix des appareils. */
type PushFamily = "messages" | "alerts";
const PUSH_FAMILY: Record<PushKind, PushFamily> = { direct: "messages", invitation: "messages", wish_alert: "alerts" };
const PUSH_LOG_MESSAGES: Record<PushFamily, { refused: string; unreadable: string; sent: string }> = {
  messages: {
    refused: "Notification de message refusée par Expo",
    unreadable: "Notification de message : réponse d'Expo illisible",
    sent: "Notification de message envoyée",
  },
  alerts: {
    refused: "Alerte prix refusée par Expo",
    unreadable: "Alerte prix : réponse d'Expo illisible",
    sent: "Alerte prix envoyée",
  },
};

/** Ce qu'une notification montre et transporte : jamais un jeton. */
export interface PushContent {
  kind: PushKind;
  /** Texte de la notification (le titre est toujours « Spotto »). */
  body: string;
  /** Données jointes, lues par l'app quand la notification est touchée. */
  data: Record<string, string>;
}

/** Issue d'un envoi : appareils visés, et appareils pour lesquels Expo a accepté. */
export interface PushOutcome {
  devices: number;
  delivered: number;
}

/** Les appareils d'une personne pour cette sorte de notification (10 au plus,
 * les plus récents). Avec 0036, une notification de message ne va qu'aux
 * appareils qui les reçoivent (notify_messages) ; une alerte, à tous. */
export async function readPushTokens(fastify: FastifyInstance, recipientId: string, kind: PushKind): Promise<string[]> {
  let query = fastify.supabaseAdmin.from("push_tokens").select("token").eq("user_id", recipientId);
  if (PUSH_FAMILY[kind] === "messages" && (await wishAlertsReady(fastify))) query = query.eq("notify_messages", true);
  return parseDbRows(TOKEN_ROWS, await query.order("updated_at", { ascending: false }).limit(MAX_DEVICES_PER_ACCOUNT), "Appareils de la personne qui reçoit").map(
    (row) => row.token
  );
}

/** Une notification à une personne : ses appareils, puis l'envoi par Expo.
 * Sans appareil : rien n'est envoyé (devices = 0). */
export async function sendPush(fastify: FastifyInstance, log: FastifyBaseLogger, recipientId: string, content: PushContent): Promise<PushOutcome> {
  const tokens = await readPushTokens(fastify, recipientId, content.kind);
  if (tokens.length === 0) return { devices: 0, delivered: 0 };
  return deliverPush(fastify, log, tokens, content);
}

/** Envoi par le service d'Expo, puis les reçus : un appareil désinscrit est
 * oublié, une autre erreur est notée (son code seulement). Journal : des
 * nombres et des codes, jamais un jeton ni un texte. */
async function deliverPush(fastify: FastifyInstance, log: FastifyBaseLogger, tokens: string[], content: PushContent): Promise<PushOutcome> {
  const db = fastify.supabaseAdmin;
  const logMessages = PUSH_LOG_MESSAGES[PUSH_FAMILY[content.kind]];
  const messages = tokens.map((to) => ({ to, title: PUSH_TITLE, body: content.body, data: content.data, sound: "default" }));
  const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
  if (env.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;

  const response = await safeFetch(EXPO_PUSH_URL, {
    allowedHosts: EXPO_HOSTS,
    method: "POST",
    headers,
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    log.warn({ status: response.status, devices: tokens.length }, logMessages.refused);
    return { devices: tokens.length, delivered: 0 };
  }
  const parsed = TICKETS.safeParse(await response.json().catch(() => null));
  if (!parsed.success || parsed.data.data.length !== tokens.length) {
    log.warn({ devices: tokens.length }, logMessages.unreadable);
    return { devices: tokens.length, delivered: 0 };
  }

  // Un reçu par appareil, dans l'ordre de l'envoi.
  const gone: string[] = [];
  const failed = new Map<string, string[]>();
  parsed.data.data.forEach((ticket, index) => {
    if (ticket.status === "ok") return;
    const code = ticketCode(ticket);
    if (code === "DeviceNotRegistered") gone.push(tokens[index]!);
    else failed.set(code, [...(failed.get(code) ?? []), tokens[index]!]);
  });
  // Appareil désinstallé ou notifications coupées dans iOS : oublié.
  if (gone.length > 0) {
    const { error } = await db.from("push_tokens").delete().in("token", gone);
    if (error) log.warn({ error }, "Appareils désinscrits : suppression impossible");
  }
  for (const [code, list] of failed) {
    const { error } = await db.from("push_tokens").update({ last_error: code }).in("token", list);
    if (error) log.warn({ error }, "Appareils en erreur : écriture impossible");
  }
  const failures = [...failed.values()].reduce((sum, list) => sum + list.length, 0) + gone.length;
  log.info(
    { devices: tokens.length, sent: tokens.length - failures, failed: failures, removed: gone.length, codes: [...new Set([...(gone.length ? ["DeviceNotRegistered"] : []), ...failed.keys()])] },
    logMessages.sent
  );
  return { devices: tokens.length, delivered: tokens.length - failures };
}
