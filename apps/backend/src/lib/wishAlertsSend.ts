// Alertes prix et stock (lot 2, migration 0036) : l'envoi, sans tâche de
// fond. Une alerte est due dès sa création par une observation
// (lib/wishObserve.ts) : décision du fondateur, le membre doit le savoir « à
// la seconde près ». Le passage d'envoi part donc JUSTE APRÈS l'observation
// qui l'a créée (sendWishAlertsNow), en arrière-plan après la réponse de la
// recherche ou de l'achat — jamais en la ralentissant. La notification ne
// dit jamais qui a cherché, acheté ou signalé la pièce : la base ne le garde
// nulle part.
//
// Les alertes restées en attente (pas d'appareil, notifications coupées,
// limites) partent par le passage déclenché par les routes fréquentes des
// membres connectés (fil, notifications, messages, préparation d'une
// recherche, Envies : scheduleWishAlertsFlush), au plus une fois par minute
// et par serveur. Un passage, par lots bornés, toujours par le même chemin
// atomique (deux serveurs n'envoient jamais la même alerte) :
// 1. wish_alerts_claim, dans la base, d'un bloc : expire les alertes de plus
//    de 72 h, désactive celles dont l'interrupteur ou la cloche est coupé,
//    revérifie chaque alerte due (périmée si la baisse ou le stock a
//    disparu), applique les limites (1 par envie et par sorte sur 7 jours,
//    5 par personne et par jour de Paris) et réserve les autres ;
// 2. notifications coupées sur le serveur (PUSH_ENABLED) : seulement l'étape
//    d'entretien ; les alertes restent en attente et expireront à 72 h ;
// 3. une notification par personne (plusieurs alertes : une seule,
//    « 3 de vos envies ont du nouveau »), par sendPush (lib/push.ts) ; juste
//    avant de la demander à Expo, ses alertes sont notées « peut-être
//    envoyées » (wish_alerts_mark_pushing) ;
// 4. acceptée par Expo : « envoyée » (wish_alerts_mark_sent, retenté 3 fois :
//    la référence d'une baisse bouge alors, règle B). Refusée par Expo, ou
//    aucun appareil : la réservation est rendue (wish_alerts_release) et
//    l'alerte sera retentée, jusqu'à 72 h. Issue inconnue (délai dépassé,
//    réponse illisible) ou envoi impossible à noter : rien n'est rendu, et
//    le passage suivant la note « envoyée » (wish_alerts_claim) — jamais deux
//    fois la même notification, au pire une alerte perdue.
// Journal racine : des nombres seulement, jamais un compte, un titre ni un prix.
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { WISH_ALERT_KINDS, WISH_ALERT_PUSH_KIND, type WishAlertKind } from "@monapp/shared-types";
import { formatPrice } from "./exportFormat.js";
import { pushAvailable, sendPush } from "./push.js";
import { wishAlertsReady } from "./wishAlertsSchema.js";

/** Au plus un passage d'envoi par minute et par serveur. */
export const FLUSH_INTERVAL_MS = 60_000;
/** Alertes réservées au plus par passage. */
export const FLUSH_BATCH = 50;
/** Alertes et signalements effacés au plus par purge (chaque table). */
export const PURGE_BATCH = 500;
/** Essais pour noter un envoi (une panne passagère ne fait jamais renvoyer). */
export const MARK_SENT_ATTEMPTS = 3;

const AMOUNT = z.union([z.number(), z.string()]).transform((value) => Number(value));
const CLAIM_ROWS = z.array(
  z.object({
    event_id: z.string().uuid(),
    user_id: z.string().uuid(),
    wishlist_item_id: z.string().uuid(),
    kind: z.enum(WISH_ALERT_KINDS),
    old_price: AMOUNT.nullable(),
    new_price: AMOUNT.nullable(),
    currency: z.string().nullable(),
    title: z.string(),
    merchant_name: z.string().nullable(),
    locale: z.string().nullable(),
  })
);

/** Une alerte réservée, prête à partir. */
export type ClaimedAlert = z.infer<typeof CLAIM_ROWS>[number];

/** Les alertes d'une même personne : une seule notification. */
export interface RecipientAlerts {
  userId: string;
  locale: "fr" | "en";
  alerts: ClaimedAlert[];
}

/** Regroupe les alertes réservées par personne, dans l'ordre de la file. */
export function groupByRecipient(alerts: readonly ClaimedAlert[]): RecipientAlerts[] {
  const groups = new Map<string, RecipientAlerts>();
  for (const alert of alerts) {
    const group = groups.get(alert.user_id);
    if (group) group.alerts.push(alert);
    else groups.set(alert.user_id, { userId: alert.user_id, locale: alert.locale === "en" ? "en" : "fr", alerts: [alert] });
  }
  return [...groups.values()];
}

/** Titre d'une envie dans une notification : 60 caractères au plus. */
const MAX_TITLE = 60;

function shortTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  return clean.length > MAX_TITLE ? `${clean.slice(0, MAX_TITLE - 1)}…` : clean;
}

type Texts = {
  price_drop: (title: string, price: string, old: string, shop: string | null) => string;
  restock: (title: string, shop: string | null) => string;
  sold_out: (title: string, shop: string | null) => string;
  grouped: (count: number) => string;
};

const PUSH_TEXTS: Record<"fr" | "en", Texts> = {
  fr: {
    price_drop: (title, price, old, shop) => (shop ? `Baisse de prix : ${title} à ${price} chez ${shop} (au lieu de ${old})` : `Baisse de prix : ${title} à ${price} (au lieu de ${old})`),
    restock: (title, shop) => (shop ? `De retour en stock : ${title} chez ${shop}` : `De retour en stock : ${title}`),
    sold_out: (title, shop) => (shop ? `Épuisé : ${title} chez ${shop}` : `Épuisé : ${title}`),
    grouped: (count) => `${count} de vos envies ont du nouveau`,
  },
  en: {
    price_drop: (title, price, old, shop) => (shop ? `Price drop: ${title} now ${price} at ${shop} (was ${old})` : `Price drop: ${title} now ${price} (was ${old})`),
    restock: (title, shop) => (shop ? `Back in stock: ${title} at ${shop}` : `Back in stock: ${title}`),
    sold_out: (title, shop) => (shop ? `Sold out: ${title} at ${shop}` : `Sold out: ${title}`),
    grouped: (count) => `${count} of your wishes have news`,
  },
};

function alertText(alert: ClaimedAlert, locale: "fr" | "en"): string {
  const texts = PUSH_TEXTS[locale];
  const title = shortTitle(alert.title);
  const shop = alert.merchant_name?.trim() || null;
  const kind: WishAlertKind = alert.kind;
  if (kind === "price_drop" && alert.new_price !== null && alert.old_price !== null) {
    return texts.price_drop(title, formatPrice(alert.new_price, alert.currency, locale), formatPrice(alert.old_price, alert.currency, locale), shop);
  }
  return kind === "sold_out" ? texts.sold_out(title, shop) : texts.restock(title, shop);
}

/** Le texte et les données de la notification d'une personne : le détail
 * quand une seule envie est concernée (toucher ouvre sa fiche), sinon
 * « {n} de vos envies ont du nouveau » (toucher ouvre vos Envies). Données :
 * la sorte et l'envie, rien d'autre. */
export function alertPushContent(group: RecipientAlerts): { body: string; data: Record<string, string> } {
  const items = [...new Set(group.alerts.map((alert) => alert.wishlist_item_id))];
  if (items.length === 1) {
    // Deux alertes pour la même envie (baisse et retour en stock) : la baisse d'abord.
    const first = group.alerts.find((alert) => alert.kind === "price_drop") ?? group.alerts[0]!;
    return { body: alertText(first, group.locale), data: { kind: WISH_ALERT_PUSH_KIND, wishlistItemId: items[0]! } };
  }
  return { body: PUSH_TEXTS[group.locale].grouped(items.length), data: { kind: WISH_ALERT_PUSH_KIND } };
}

/** Bilan d'un passage : des nombres. `uncertain` : peut-être envoyées, jamais renvoyées. */
export interface FlushSummary {
  claimed: number;
  recipients: number;
  sent: number;
  released: number;
  uncertain: number;
  push: boolean;
}

const EMPTY: FlushSummary = { claimed: 0, recipients: 0, sent: 0, released: 0, uncertain: 0, push: false };

/** Note les alertes « envoyées », en réessayant une panne passagère ; faux
 * si rien n'a pu être noté (elles le seront au passage suivant). */
async function markSent(fastify: FastifyInstance, log: FastifyBaseLogger, ids: string[]): Promise<boolean> {
  let code: string | null = null;
  for (let attempt = 1; attempt <= MARK_SENT_ATTEMPTS; attempt += 1) {
    const marked = await fastify.supabaseAdmin.rpc("wish_alerts_mark_sent", { p_ids: ids }).then(
      (result) => result.error,
      () => ({ code: null })
    );
    if (!marked) return true;
    code = marked.code ?? null;
  }
  log.warn({ code, alerts: ids.length }, "Alertes prix : envoi non noté (il le sera au passage suivant, jamais renvoyé)");
  return false;
}

/** Un passage d'envoi. Ne lève jamais d'erreur vers l'appelant (scheduleWishAlertsFlush) ; testée à part. */
export async function flushWishAlerts(fastify: FastifyInstance, log: FastifyBaseLogger = fastify.log): Promise<FlushSummary> {
  if (!(await wishAlertsReady(fastify))) return EMPTY;
  const push = await pushAvailable(fastify);
  const db = fastify.supabaseAdmin;
  const { data, error } = await db.rpc("wish_alerts_claim", { p_limit: push ? FLUSH_BATCH : 0 });
  if (error) {
    log.warn({ code: error.code ?? null }, "Alertes prix : file illisible");
    return { ...EMPTY, push };
  }
  if (!push) return EMPTY;
  const parsed = CLAIM_ROWS.safeParse(data ?? []);
  if (!parsed.success) {
    log.warn({ code: null }, "Alertes prix : alertes réservées illisibles");
    return { ...EMPTY, push };
  }
  const groups = groupByRecipient(parsed.data);
  const sent: string[] = [];
  const released: string[] = [];
  const uncertain: string[] = [];
  for (const group of groups) {
    const ids = group.alerts.map((alert) => alert.event_id);
    // Noté avant la demande à Expo : sans cette marque, rien ne part.
    const pushing = await db.rpc("wish_alerts_mark_pushing", { p_ids: ids }).then(
      (result) => !result.error && typeof result.data === "number" && result.data === ids.length,
      () => false
    );
    if (!pushing) {
      released.push(...ids);
      continue;
    }
    try {
      const content = alertPushContent(group);
      const outcome = await sendPush(fastify, log, group.userId, { kind: "wish_alert", body: content.body, data: content.data });
      if (outcome.delivered > 0) sent.push(...ids);
      else if (outcome.uncertain) uncertain.push(...ids);
      else released.push(...ids);
    } catch {
      // Erreur avant la demande à Expo (appareils illisibles) : rien n'est parti.
      released.push(...ids);
    }
  }
  if (sent.length > 0) await markSent(fastify, log, sent);
  if (released.length > 0) {
    const freed = await db.rpc("wish_alerts_release", { p_ids: released });
    if (freed.error) log.warn({ code: freed.error.code ?? null }, "Alertes prix : réservation non rendue (elle expire seule en 15 minutes)");
  }
  const summary = { claimed: parsed.data.length, recipients: groups.length, sent: sent.length, released: released.length, uncertain: uncertain.length, push };
  if (summary.claimed > 0) log.info(summary, "Alertes prix : passage d'envoi");
  return summary;
}

// ---- Déclenchement par les routes fréquentes ----

/** Routes des membres connectés qui déclenchent un passage (au plus un par minute). */
export const FLUSH_ROUTES: ReadonlySet<string> = new Set([
  "POST /api/searches/prepare",
  "GET /api/feed",
  "GET /api/notifications",
  "GET /api/notifications/unread-count",
  "GET /api/messages/status",
  "GET /api/wishlist",
]);

let lastFlushAt = 0;
let running: Promise<void> | null = null;
/** Une alerte est née pendant un passage : un autre passage suit aussitôt. */
let again = false;

function startFlush(fastify: FastifyInstance, now: number): void {
  lastFlushAt = now;
  running = flushWishAlerts(fastify)
    .then(() => undefined)
    .catch((error: unknown) => {
      fastify.log.warn({ code: error instanceof Error ? error.name : null }, "Alertes prix : passage d'envoi impossible");
    })
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        startFlush(fastify, Date.now());
      }
    });
}

/** Lance un passage d'envoi si le dernier date de plus d'une minute, sans
 * jamais l'attendre ni échouer. */
export function scheduleWishAlertsFlush(fastify: FastifyInstance, now: number = Date.now()): void {
  if (running || now - lastFlushAt < FLUSH_INTERVAL_MS) return;
  startFlush(fastify, now);
}

/** Une observation vient de créer des alertes : un passage d'envoi tout de
 * suite, sans attendre la minute (si un passage est en cours, un autre le
 * suit dès sa fin). Jamais attendu, jamais d'erreur : à appeler après la
 * réponse. Le même chemin atomique que les autres passages (wish_alerts_claim). */
export function sendWishAlertsNow(fastify: FastifyInstance): void {
  if (running) {
    again = true;
    return;
  }
  startFlush(fastify, Date.now());
}

/** Crochet « onResponse » de l'app : après la réponse d'une route fréquente
 * d'un membre connecté, réussie, un passage d'envoi (au plus un par minute). */
export async function flushAfterResponse(fastify: FastifyInstance, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user || reply.statusCode >= 400) return;
  if (!FLUSH_ROUTES.has(`${request.method} ${request.routeOptions?.url ?? ""}`)) return;
  scheduleWishAlertsFlush(fastify);
}

/** Tests seulement : attend le passage en cours (et ceux qui le suivent). */
export async function waitForWishAlertsFlush(): Promise<void> {
  while (running) await running;
}

/** Tests seulement : attend le passage en cours, et oublie le dernier. */
export async function resetWishAlertsFlush(): Promise<void> {
  while (running) await running;
  again = false;
  lastFlushAt = 0;
}

// ---- Purge (30 jours) ----

/** Efface les alertes et les signalements de plus de 30 jours, par lots
 * bornés, à côté de la purge du cache des recherches. Ne lève jamais d'erreur. */
export async function purgeWishAlerts(fastify: FastifyInstance, log: FastifyBaseLogger): Promise<void> {
  try {
    if (!(await wishAlertsReady(fastify))) return;
    const { error } = await fastify.supabaseAdmin.rpc("wish_alerts_purge", { p_limit: PURGE_BATCH });
    if (error) log.warn({ code: error.code ?? null }, "Alertes prix : purge impossible");
  } catch {
    log.warn({ code: null }, "Alertes prix : purge impossible");
  }
}
