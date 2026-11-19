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
// aux alertes (lib/wishAlertsSend.ts). Chaque appareil dit ce qu'il reçoit :
// les messages (push_tokens.notify_messages) et les alertes
// (push_tokens.notify_alerts, seulement après l'« Activer » donné pour elles
// sur cet appareil). Un appareil des seules alertes ne reçoit aucune
// notification de message. Sans 0036, les messages sont comme avant.
// Quand la base ne dit pas si 0036 est là (sonde « inconnue »), aucun choix
// de la personne n'est trahi : « messages coupés » oublie l'appareil, et
// aucune notification de message ne part (elle pourrait aller vers un
// appareil des seules alertes).
//
// Lot « découverte » (migration 0051) : les notifications d'activité — un
// « j'aime », un commentaire ou une réponse, un abonné ou une demande
// d'abonnement, une mention ou une identification. Chaque appareil a une
// réponse par sorte (push_tokens.notify_likes, notify_comments,
// notify_follows, notify_mentions), éteinte au départ. UN seul appelant,
// lib/notify.ts, et seulement quand la notification de l'onglet Activité
// vient d'être écrite : toutes ses règles sont donc passées (jamais à
// soi-même, jamais entre deux comptes en blocage, jamais au sujet d'une
// publication que la personne ne voit pas). Ici, en plus : rien d'un compte
// suspendu ni vers lui ; une seule par personne, sorte et publication (ou
// auteur, pour un abonné) toutes les 10 minutes, et 30 au plus par personne
// sur 24 heures glissantes, comptées en mémoire (un redémarrage remet les
// comptes à zéro : au pire, quelques-unes de plus). Le texte dit qui a fait
// quoi, jamais le texte d'un commentaire, une légende ni une image. Sans 0051
// (ou sans 0036, qu'elle demande), rien ne part et les quatre réponses sont
// ignorées ; base illisible : rien ne part, et une réponse envoyée par l'app
// est refusée plutôt que perdue.
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { BRAND } from "./brand.js";
import { ACTIVITY_PUSH_KINDS, EXPO_PUSH_TOKEN_PATTERN, PUSH_PLATFORMS, type ActivityPushData, type ActivityPushKind, type PushPlatform } from "@monapp/shared-types";
import { env } from "../env.js";
import { readSide } from "./messaging.js";
import { isSuspended, suspendedAmong } from "./moderation.js";
import type { MemberNotificationType } from "./notify.js";
import { safeFetch } from "./safeFetch.js";
import { DatabaseReadError, parseDbRows } from "./validation.js";
import { isBlockedEitherWay } from "./visibility.js";
import { wishAlertsSchemaState } from "./wishAlertsSchema.js";

// ---- Réponses ----

export const PUSH_UNAVAILABLE = { error: "push_unavailable", message: "Les notifications ne sont pas disponibles." } as const;
export const INVALID_PUSH_TOKEN = { error: "invalid_push_token", message: "Jeton de notification invalide." } as const;

/** Corps de PUT /api/me/push-token : un jeton d'Expo, son système, et
 * (lot alertes prix) s'il reçoit les notifications des messages, des alertes ;
 * (migration 0051) celles de l'activité, une réponse par sorte. */
export const registerPushTokenSchema = z.object({
  token: z.string().max(200).regex(EXPO_PUSH_TOKEN_PATTERN),
  platform: z.enum(PUSH_PLATFORMS),
  messages: z.boolean().optional(),
  alerts: z.boolean().optional(),
  likes: z.boolean().optional(),
  comments: z.boolean().optional(),
  follows: z.boolean().optional(),
  mentions: z.boolean().optional(),
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

/** Tests seulement : oublie les sondes (0035, et 0051 pour l'activité). */
export function resetPushProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
  activityReadyAt = null;
  activityMissingAt = null;
  activityProbe = null;
}

// ---- Schéma de la base (migration 0051 : notifications d'activité) ----

/** Réponses de la base qui veulent dire « la colonne ou la table n'existe
 * pas » (Postgres : 42703, 42P01 ; PostgREST : PGRST204, PGRST205). */
const ABSENT_CODES = new Set(["42703", "42P01", "PGRST204", "PGRST205"]);

let activityReadyAt: number | null = null;
let activityMissingAt: number | null = null;
let activityProbe: Promise<boolean> | null = null;

/** Les quatre colonnes de 0051 répondent-elles ? Une lecture sans ligne.
 * Vrai : elles sont là. Faux : la base dit qu'elles n'existent pas. Toute
 * autre réponse (base injoignable, délai dépassé…) relève DatabaseReadError :
 * on ne sait pas, et ignorer la réponse d'un membre la perdrait en silence. */
async function probeActivitySchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  let failed: { code?: string } | null;
  try {
    const answer = await fastify.supabaseAdmin.from("push_tokens").select("notify_likes, notify_comments, notify_follows, notify_mentions").limit(0);
    if (!answer.error) return true;
    failed = answer.error as { code?: string };
  } catch {
    failed = null;
  }
  const code = failed?.code ?? null;
  if (code !== null && ABSENT_CODES.has(code)) {
    fastify.log.warn({ code }, "Notifications d'activité coupées : migration 0051 absente");
    return false;
  }
  fastify.log.warn({ code }, "Notifications d'activité : schéma illisible");
  throw new DatabaseReadError("Schéma des notifications d'activité illisible");
}

/** La base a-t-elle la migration 0051 ? Mémorisé une fois vu ; absente, un
 * avertissement, puis la sonde n'est refaite qu'au bout de 5 minutes (comme
 * pushReady). Base illisible : DatabaseReadError, rien n'est mémorisé, et la
 * sonde est refaite à la demande suivante. Ne dit rien de 0036 : voir
 * activityPushAvailable. */
export async function activityPushReady(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<boolean> {
  if (activityReadyAt !== null) return true;
  if (activityMissingAt !== null && now() - activityMissingAt < SCHEMA_RETRY_MS) return false;
  activityProbe ??= probeActivitySchema(fastify)
    .then((ready) => {
      if (ready) activityReadyAt = now();
      else activityMissingAt = now();
      return ready;
    })
    .finally(() => {
      activityProbe = null;
    });
  return activityProbe;
}

/** 0051 : présente, absente, ou inconnue (la base n'a pas répondu). */
async function activitySchemaState(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<"ready" | "absent" | "unknown"> {
  try {
    return (await activityPushReady(fastify)) ? "ready" : "absent";
  } catch {
    return "unknown";
  }
}

/** Notifications d'activité réellement possibles : interrupteur allumé, et
 * 0035, 0036 et 0051 présentes (0051 demande 0036). Base illisible : non —
 * rien n'est proposé ni envoyé. */
export async function activityPushAvailable(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  if (!pushEnabled()) return false;
  return (await pushReady(fastify)) && (await wishAlertsSchemaState(fastify)) === "ready" && (await activitySchemaState(fastify)) === "ready";
}

// ---- Appareils enregistrés (push_tokens) ----

/** Appareils gardés au plus par compte : au-delà, le plus ancien est oublié. */
export const MAX_DEVICES_PER_ACCOUNT = 10;

/** Écriture impossible dans push_tokens (le message ne dit jamais le jeton). */
export class PushTokenStoreError extends Error {}

const TOKEN_ROWS = z.array(z.object({ token: z.string() }));

/** Ce que reçoit un appareil (lot alertes prix ; migration 0051 : les
 * quatre sortes d'activité) ; absent : inchangé. */
export interface PushTokenKinds extends Partial<Record<ActivityPushKind, boolean>> {
  messages?: boolean;
  alerts?: boolean;
}

/** Enregistre l'appareil pour ce compte, ou le rafraîchit. Un jeton est à un
 * seul compte : le même téléphone connecté à un autre compte change de
 * propriétaire (l'ancien ne reçoit plus rien sur ce téléphone).
 * `kinds` (lot alertes prix) : ce que reçoit cet appareil, écrit seulement
 * avec 0036 ; absent, la valeur enregistrée ne change pas (messages : oui,
 * alertes : non, pour un nouvel appareil). Les deux à false : l'appareil est
 * oublié. Sans 0036 (ou sans savoir si elle est là), un appareil ne peut pas
 * être gardé pour les seules alertes : `messages: false` l'oublie, comme
 * avant 0036 ; un autre choix, quand la base ne répond pas, est refusé
 * (PushTokenStoreError) plutôt que d'être perdu en silence.
 * Migration 0051 : les quatre réponses de l'activité, écrites seulement avec
 * elle (et 0036) ; sans elle, ignorées. L'appareil n'est alors oublié que
 * quand ses six réponses sont à false. Une réponse de l'activité quand la
 * base ne dit pas si 0051 est là : refusée. Sans réponse de l'activité dans
 * la demande et sans savoir si 0051 est là, l'appareil est oublié dès que
 * messages et alertes sont coupés (au pire, il cesse de recevoir l'activité
 * jusqu'au prochain enregistrement : jamais une notification de trop). */
export async function savePushToken(fastify: FastifyInstance, userId: string, token: string, platform: PushPlatform, kinds: PushTokenKinds = {}): Promise<void> {
  const db = fastify.supabaseAdmin;
  const now = new Date().toISOString();
  const asked = ALL_FAMILIES.some((family) => kinds[family] !== undefined);
  const schema = asked ? await wishAlertsSchemaState(fastify) : "absent";
  const activity = schema === "ready" ? await activitySchemaState(fastify) : "absent";
  if (activity === "unknown" && ACTIVITY_PUSH_KINDS.some((family) => kinds[family] !== undefined)) {
    throw new PushTokenStoreError("Appareil : ce qu'il reçoit ne peut pas être enregistré (schéma de l'activité inconnu)");
  }
  // Les réponses que la base sait garder pour cet appareil.
  const families: readonly PushFamily[] = schema !== "ready" ? [] : activity === "ready" ? ALL_FAMILIES : LEGACY_FAMILIES;
  if (asked && kinds.messages === false && (schema !== "ready" || families.every((family) => kinds[family] === false))) return deletePushToken(fastify, userId, token);
  if (asked && schema === "unknown") throw new PushTokenStoreError("Appareil : ce qu'il reçoit ne peut pas être enregistré (schéma des alertes inconnu)");
  const flags = Object.fromEntries(families.filter((family) => kinds[family] !== undefined).map((family) => [FAMILY_COLUMN[family], kinds[family]]));
  const values = { user_id: userId, platform, updated_at: now, last_error: null, ...flags };
  const foreign = await db.from("push_tokens").delete().eq("token", token).neq("user_id", userId);
  if (foreign.error) throw new PushTokenStoreError("Appareil d'un autre compte : suppression impossible");
  const refresh = async (): Promise<boolean> => {
    const updated = await db.from("push_tokens").update(values).eq("token", token).eq("user_id", userId).select("token");
    if (updated.error) throw new PushTokenStoreError("Appareil : mise à jour impossible");
    return parseDbRows(TOKEN_ROWS, updated, "Appareil mis à jour").length > 0;
  };
  if (!(await refresh())) {
    await makeRoom(fastify, userId);
    const inserted = await db.from("push_tokens").insert({ token, ...values, created_at: now });
    // Deux enregistrements simultanés du même appareil : la base n'en garde qu'un.
    if (inserted.error && !(inserted.error.code === "23505" && (await refresh()))) throw new PushTokenStoreError("Appareil : enregistrement impossible");
  }
  // Une réponse coupée, les autres laissées telles quelles : s'il ne reçoit plus rien, l'appareil est oublié.
  if (families.some((family) => kinds[family] === false)) {
    let forget = db.from("push_tokens").delete().eq("token", token).eq("user_id", userId);
    for (const family of families) forget = forget.eq(FAMILY_COLUMN[family], false);
    const { error } = await forget;
    if (error) throw new PushTokenStoreError("Appareil sans aucune notification : suppression impossible");
  }
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

/** Oublie cet appareil, quel que soit son compte (POST
 * /api/push-token/forget, sans session : avoir le jeton, c'est être cet
 * appareil). Seulement les lignes de ce jeton ; sans effet s'il n'y est pas. */
export async function forgetPushTokenEverywhere(fastify: FastifyInstance, token: string): Promise<void> {
  const { error } = await fastify.supabaseAdmin.from("push_tokens").delete().eq("token", token);
  if (error) throw new PushTokenStoreError("Appareil : suppression impossible");
}

/** « Alertes prix et stock » coupé (lib/wishAlerts.ts) : les appareils de ce
 * compte qui ne restaient que pour les alertes — sans les messages ni (avec
 * 0051) aucune sorte d'activité — sont oubliés. Sans savoir si 0051 est là :
 * tous ceux sans les messages, comme avant 0051 (au pire, un appareil cesse de
 * recevoir l'activité jusqu'au prochain enregistrement par l'app). */
export async function forgetAlertsOnlyDevices(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, userId: string): Promise<void> {
  let query = fastify.supabaseAdmin.from("push_tokens").delete().eq("user_id", userId).eq("notify_messages", false);
  if ((await activitySchemaState(fastify)) === "ready") for (const family of ACTIVITY_PUSH_KINDS) query = query.eq(FAMILY_COLUMN[family], false);
  const { error } = await query;
  if (error) throw new PushTokenStoreError("Appareils des seules alertes : suppression impossible");
}

/** Suppression du compte : tous ses appareils (la base les efface aussi en cascade). */
export async function deleteAllPushTokens(fastify: FastifyInstance, userId: string): Promise<void> {
  const { error } = await fastify.supabaseAdmin.from("push_tokens").delete().eq("user_id", userId);
  if (error) throw new PushTokenStoreError("Appareils du compte : suppression impossible");
}

// ---- Contenu d'une notification ----

export const PUSH_TITLE = BRAND;
/** Sortes de notifications : un message, une invitation, une alerte prix ou
 * stock, et (migration 0051) un « j'aime », un commentaire, un abonnement,
 * une mention. */
export type PushKind = "direct" | "invitation" | "wish_alert" | ActivityKind;
/** Les sortes de l'activité, une par réponse de l'appareil. */
export type ActivityKind = "like" | "comment" | "follow" | "mention";
type MessagePushKind = "direct" | "invitation";
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

/** Tests seulement : oublie les notifications déjà envoyées (messages et
 * activité : regroupement et plafond du jour). */
export function resetPushCollapse(): void {
  lastPushAt.clear();
  lastActivityPushAt.clear();
  activityPushTimes.clear();
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

// ---- Notifications d'activité (migration 0051) ----

/** Une seule notification par personne, sorte et publication (ou auteur,
 * pour un abonné) pendant ce délai. */
export const ACTIVITY_COLLAPSE_WINDOW_MS = 10 * 60_000;
/** Au plus ce nombre de notifications d'activité par personne, sur 24 heures glissantes. */
export const ACTIVITY_PUSH_DAILY_MAX = 30;
const ACTIVITY_DAY_MS = 24 * 60 * 60_000;

/** La sorte (la réponse de l'appareil) de chaque notification de l'onglet
 * Activité écrite par lib/notify.ts. Un nouveau type devra choisir la sienne. */
export const ACTIVITY_KIND: Record<MemberNotificationType, ActivityKind> = {
  like: "like",
  comment: "comment",
  reply: "comment",
  follow: "follow",
  follow_request: "follow",
  follow_accepted: "follow",
  mention: "mention",
  tag: "mention",
};

const ACTIVITY_BODIES: Record<MemberNotificationType, Record<PushLocale, (username: string) => string>> = {
  like: { fr: (username) => `@${username} a aimé votre publication`, en: (username) => `@${username} liked your post` },
  comment: { fr: (username) => `@${username} a commenté votre publication`, en: (username) => `@${username} commented on your post` },
  reply: { fr: (username) => `@${username} a répondu à votre commentaire`, en: (username) => `@${username} replied to your comment` },
  follow: { fr: (username) => `@${username} s'est abonné(e) à vous`, en: (username) => `@${username} started following you` },
  follow_request: { fr: (username) => `@${username} demande à vous suivre`, en: (username) => `@${username} asked to follow you` },
  follow_accepted: { fr: (username) => `@${username} a accepté votre demande d'abonnement`, en: (username) => `@${username} accepted your follow request` },
  mention: { fr: (username) => `@${username} vous a mentionné(e)`, en: (username) => `@${username} mentioned you` },
  tag: { fr: (username) => `@${username} vous a identifié(e) dans une publication`, en: (username) => `@${username} tagged you in a post` },
};

/** Le texte d'une notification d'activité : qui a fait quoi, dans la langue
 * de la personne qui la reçoit ; jamais un commentaire, une légende ni une image. */
export function activityPushBody(type: MemberNotificationType, username: string, locale: string | null | undefined): string {
  return ACTIVITY_BODIES[type][locale === "en" ? "en" : "fr"](username);
}

/** Ce que porte la notification, rien d'autre : la publication, le membre
 * (abonné, demande acceptée) ou la liste des demandes. Null : une
 * notification qui parle d'une publication sans la nommer ne part pas. */
export function activityPushData(type: MemberNotificationType, actorId: string, postId: string | undefined): ActivityPushData | null {
  if (type === "follow_request") return { screen: "requests" };
  if (type === "follow" || type === "follow_accepted") return { userId: actorId };
  return postId !== undefined ? { postId } : null;
}

/** Une notification de l'onglet Activité vient d'être écrite (lib/notify.ts). */
export interface ActivityPush {
  recipientId: string;
  actorId: string;
  type: MemberNotificationType;
  postId?: string;
}

const lastActivityPushAt = new Map<string, number>();
/** Heures des notifications d'activité envoyées à chaque personne (24 heures au plus). */
const activityPushTimes = new Map<string, number[]>();

function activityCollapseKey({ recipientId, actorId, postId }: ActivityPush, kind: ActivityKind): string {
  return `${recipientId}:${kind}:${kind === "follow" || postId === undefined ? actorId : postId}`;
}

function sentInLastDay(recipientId: string, now: number): number[] {
  return (activityPushTimes.get(recipientId) ?? []).filter((at) => now - at < ACTIVITY_DAY_MS);
}

/** Retenue en mémoire : déjà envoyée pour la même chose il y a moins de 10
 * minutes, ou plafond des 24 heures atteint pour cette personne. */
function activityHeld(key: string, recipientId: string, now: number): "collapsed" | "capped" | null {
  const at = lastActivityPushAt.get(key);
  if (at !== undefined && now - at < ACTIVITY_COLLAPSE_WINDOW_MS) return "collapsed";
  return sentInLastDay(recipientId, now).length >= ACTIVITY_PUSH_DAILY_MAX ? "capped" : null;
}

function rememberActivityPush(key: string, recipientId: string, now: number): void {
  if (lastActivityPushAt.size >= COLLAPSE_PRUNE_AT) {
    for (const [other, at] of lastActivityPushAt) if (now - at >= ACTIVITY_COLLAPSE_WINDOW_MS) lastActivityPushAt.delete(other);
  }
  if (activityPushTimes.size >= COLLAPSE_PRUNE_AT) {
    for (const [other, times] of activityPushTimes) if (sentInLastDay(other, now).length === 0) activityPushTimes.delete(other);
  }
  lastActivityPushAt.set(key, now);
  activityPushTimes.set(recipientId, [...sentInLastDay(recipientId, now), now]);
}

const ACTIVITY_HELD_LOG = {
  collapsed: "Notification d'activité regroupée",
  capped: "Notification d'activité : plafond des 24 heures atteint",
} as const;

/** Prévient les appareils de la personne qui reçoit une notification de
 * l'onglet Activité, si elle a allumé cette sorte sur l'un d'eux, sans jamais
 * faire attendre ni échouer l'action : appelée par lib/notify.ts SEULEMENT
 * juste après l'écriture de la notification (ses règles sont donc passées),
 * sans `await`. Toute erreur finit au journal (son code seulement). */
export function notifyActivity(fastify: FastifyInstance, log: FastifyBaseLogger, push: ActivityPush): void {
  if (!pushEnabled()) return;
  const task = sendActivityPush(fastify, log, push).catch((error: unknown) => {
    log.warn({ error }, "Notification d'activité non envoyée");
  });
  inFlight.add(task);
  void task.finally(() => inFlight.delete(task));
}

async function sendActivityPush(fastify: FastifyInstance, log: FastifyBaseLogger, push: ActivityPush): Promise<void> {
  const { recipientId, actorId, type, postId } = push;
  if (recipientId === actorId) return;
  const kind = ACTIVITY_KIND[type];
  const data = activityPushData(type, actorId, postId);
  if (!data) return;
  const key = activityCollapseKey(push, kind);
  const held = activityHeld(key, recipientId, Date.now());
  if (held) {
    log.info({ outcome: held, kind }, ACTIVITY_HELD_LOG[held]);
    return;
  }
  if (!(await activityPushAvailable(fastify))) return;
  // Les appareils d'abord : sans appareil qui a allumé cette sorte, rien d'autre n'est lu.
  const tokens = await readPushTokens(fastify, recipientId, kind);
  if (tokens.length === 0) return;
  // Jamais d'un compte suspendu, ni vers lui. Le reste (soi-même, blocage,
  // publication visible) vient d'être vérifié par lib/notify.ts.
  const [suspended, profiles] = await Promise.all([
    suspendedAmong(fastify, [actorId, recipientId]),
    (async () => parseDbRows(PROFILE_ROWS, await fastify.supabaseAdmin.from("profiles").select("id, username, locale").in("id", [actorId, recipientId]), "Profils de la notification"))(),
  ]);
  if (suspended.size > 0) {
    log.info({ outcome: "skipped", kind }, "Notification d'activité non due");
    return;
  }
  const username = profiles.find((row) => row.id === actorId)?.username;
  if (!username) return;
  const locale = profiles.find((row) => row.id === recipientId)?.locale;

  // Revérifié juste avant l'envoi, sans attente entre la vérification et la
  // réservation : deux « j'aime » simultanés ne font qu'une notification.
  const now = Date.now();
  const late = activityHeld(key, recipientId, now);
  if (late) {
    log.info({ outcome: late, kind }, ACTIVITY_HELD_LOG[late]);
    return;
  }
  rememberActivityPush(key, recipientId, now);
  await deliverPush(fastify, log, tokens, { kind, body: activityPushBody(type, username, locale), data });
}

// ---- Envoi commun (messages, alertes, activité) ----

/** Messages, alertes, ou l'une des quatre sortes d'activité (migration
 * 0051) : une réponse de l'appareil chacune ; pour le journal et le choix des
 * appareils. */
type PushFamily = "messages" | "alerts" | ActivityPushKind;
const PUSH_FAMILY: Record<PushKind, PushFamily> = {
  direct: "messages",
  invitation: "messages",
  wish_alert: "alerts",
  like: "likes",
  comment: "comments",
  follow: "follows",
  mention: "mentions",
};
/** La colonne de push_tokens qui garde chaque réponse. */
const FAMILY_COLUMN: Record<PushFamily, string> = {
  messages: "notify_messages",
  alerts: "notify_alerts",
  likes: "notify_likes",
  comments: "notify_comments",
  follows: "notify_follows",
  mentions: "notify_mentions",
};
/** Réponses connues avec 0036 seule, puis avec 0051. */
const LEGACY_FAMILIES: readonly PushFamily[] = ["messages", "alerts"];
const ALL_FAMILIES: readonly PushFamily[] = [...LEGACY_FAMILIES, ...ACTIVITY_PUSH_KINDS];
const isActivityFamily = (family: PushFamily): family is ActivityPushKind => (ACTIVITY_PUSH_KINDS as readonly string[]).includes(family);
const ACTIVITY_LOG_MESSAGES = {
  refused: "Notification d'activité refusée par Expo",
  unreadable: "Notification d'activité : réponse d'Expo illisible",
  sent: "Notification d'activité envoyée",
};
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
  likes: ACTIVITY_LOG_MESSAGES,
  comments: ACTIVITY_LOG_MESSAGES,
  follows: ACTIVITY_LOG_MESSAGES,
  mentions: ACTIVITY_LOG_MESSAGES,
};

/** Ce qu'une notification montre et transporte : jamais un jeton. */
export interface PushContent {
  kind: PushKind;
  /** Texte de la notification (le titre est toujours « Spotto »). */
  body: string;
  /** Données jointes, lues par l'app quand la notification est touchée. */
  data: Record<string, string>;
}

/** Issue d'un envoi : appareils visés, appareils pour lesquels Expo a
 * accepté, et `uncertain` : la demande est peut-être arrivée chez Expo sans
 * qu'on sache s'il l'a acceptée (délai dépassé, réponse illisible) — une
 * alerte dans ce cas n'est jamais renvoyée (lib/wishAlertsSend.ts). */
export interface PushOutcome {
  devices: number;
  delivered: number;
  uncertain: boolean;
}

/** Les appareils d'une personne pour cette sorte de notification (10 au plus,
 * les plus récents). Avec 0036, une notification de message ne va qu'aux
 * appareils qui les reçoivent (notify_messages), une alerte qu'à ceux qui
 * les reçoivent (notify_alerts). Sans 0036 : les messages à tous (comme
 * avant), aucune alerte. Sans savoir si 0036 est là : erreur, rien ne part
 * (un appareil des seules alertes recevrait des messages refusés).
 * Migration 0051 : une sorte d'activité ne va qu'aux appareils qui ont
 * allumé CETTE sorte ; sans 0051, à aucun ; sans savoir : erreur, rien ne part. */
export async function readPushTokens(fastify: FastifyInstance, recipientId: string, kind: PushKind): Promise<string[]> {
  const schema = await wishAlertsSchemaState(fastify);
  if (schema === "unknown") throw new DatabaseReadError("Appareils : on ne sait pas lesquels reçoivent cette sorte de notification");
  const family = PUSH_FAMILY[kind];
  if (family === "alerts" && schema !== "ready") return [];
  if (isActivityFamily(family) && (schema !== "ready" || !(await activityPushReady(fastify)))) return [];
  let query = fastify.supabaseAdmin.from("push_tokens").select("token").eq("user_id", recipientId);
  if (schema === "ready") query = query.eq(FAMILY_COLUMN[family], true);
  return parseDbRows(TOKEN_ROWS, await query.order("updated_at", { ascending: false }).limit(MAX_DEVICES_PER_ACCOUNT), "Appareils de la personne qui reçoit").map(
    (row) => row.token
  );
}

/** Une notification à une personne : ses appareils, puis l'envoi par Expo.
 * Sans appareil : rien n'est envoyé (devices = 0). Une erreur avant l'envoi
 * (appareils illisibles) remonte : rien n'est parti. Une erreur pendant ou
 * après la demande à Expo ne remonte pas : `uncertain` (peut-être parti). */
export async function sendPush(fastify: FastifyInstance, log: FastifyBaseLogger, recipientId: string, content: PushContent): Promise<PushOutcome> {
  const tokens = await readPushTokens(fastify, recipientId, content.kind);
  if (tokens.length === 0) return { devices: 0, delivered: 0, uncertain: false };
  try {
    return await deliverPush(fastify, log, tokens, content);
  } catch (error) {
    log.warn({ code: error instanceof Error ? error.name : null, devices: tokens.length }, PUSH_LOG_MESSAGES[PUSH_FAMILY[content.kind]].unreadable);
    return { devices: tokens.length, delivered: 0, uncertain: true };
  }
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
    return { devices: tokens.length, delivered: 0, uncertain: false };
  }
  // Acceptée par Expo, reçus illisibles : peut-être partie.
  const parsed = TICKETS.safeParse(await response.json().catch(() => null));
  if (!parsed.success || parsed.data.data.length !== tokens.length) {
    log.warn({ devices: tokens.length }, logMessages.unreadable);
    return { devices: tokens.length, delivered: 0, uncertain: true };
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
  return { devices: tokens.length, delivered: tokens.length - failures, uncertain: false };
}
