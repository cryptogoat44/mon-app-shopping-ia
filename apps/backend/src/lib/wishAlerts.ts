// Alertes prix et stock (lot 2, migration 0036) : ce que les routes
// demandent à la base — l'interrupteur « Alertes prix et stock », le suivi
// de chaque envie (wish_tracking), la cloche (wish_watches) et les
// signalements « Plus disponible ». Sans 0036 (wishAlertsSchema.ts), rien de
// tout cela n'est lu ni écrit : chaque fonction se tait ou répond « indisponible ».
//
// Le suivi d'une envie est créé par trackNewWish, appelée par CHAQUE chemin
// qui crée une envie (POST /api/wishlist, « Garder » une envie d'un ami ;
// tests/alertesPrixChemins.test.ts vérifie qu'aucun chemin ne l'oublie), puis,
// pour les envies d'avant, par le script de rattrapage
// (scripts/rattraper-suivi-envies-dev.ts) ou à la première lecture de leur cloche.
// - La clé « même pièce » vient de l'adresse de la boutique et de son nom
//   (lib/alertKeys.ts) ; la base n'en garde que l'empreinte.
// - Prix de référence de départ (règle B) : celui que le SERVEUR a rangé pour
//   la proposition d'origine (product_matches), daté de sa recherche, jamais
//   celui envoyé par l'app. Sans proposition (envie à la main, « Garder »), ou
//   devise inconnue : aucune référence ; la première observation la fixera.
// Journal : des codes, jamais un compte, un titre ni une adresse.
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { alertCurrency, WISH_ALERT_RULES, STOCK_STATES, type WishAlertState, type WishAlertsStatus } from "@monapp/shared-types";
import { ALERT_KEY_VERSION, trackingKeyOf, type TrackingKey } from "./alertKeys.js";
import { pushAvailable } from "./push.js";
import { chunks, readAll } from "./pagedReads.js";
import { DatabaseReadError, parseDbRows } from "./validation.js";
import { wishAlertsReady } from "./wishAlertsSchema.js";

export { wishAlertsReady } from "./wishAlertsSchema.js";

type Db = FastifyInstance;

/** Écriture impossible (le message ne dit jamais rien de la personne). */
export class WishAlertsStoreError extends Error {}

/** Le jour (heure de Paris) d'un instant, « AAAA-MM-JJ » ; null s'il est illisible. */
export function parisDay(value: string | Date): string | null {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

// ---- Interrupteur « Alertes prix et stock » ----

const ENABLED_ROW = z.object({ price_alerts_enabled: z.boolean() });

async function readAlertsEnabled(fastify: Db, userId: string): Promise<boolean> {
  const { data, error } = await fastify.supabaseAdmin.from("profiles").select("price_alerts_enabled").eq("id", userId).maybeSingle();
  if (error) throw new DatabaseReadError("Interrupteur des alertes illisible");
  const row = ENABLED_ROW.safeParse(data);
  return row.success ? row.data.price_alerts_enabled : false;
}

/** L'état des alertes pour cette personne. Sans 0036 : tout faux (l'app cache tout). */
export async function wishAlertsStatus(fastify: Db, userId: string): Promise<WishAlertsStatus> {
  if (!(await wishAlertsReady(fastify))) return { available: false, enabled: false, push: false };
  const [enabled, push] = await Promise.all([readAlertsEnabled(fastify, userId), pushAvailable(fastify)]);
  return { available: true, enabled, push };
}

/** Allume ou coupe l'interrupteur. Coupé : les appareils gardés pour les
 * seules alertes (notifications des messages coupées) sont oubliés — un
 * appareil ne reste enregistré que tant que les messages OU les alertes sont allumés. */
export async function setWishAlertsEnabled(fastify: Db, userId: string, enabled: boolean): Promise<void> {
  const { error } = await fastify.supabaseAdmin
    .from("profiles")
    .update({ price_alerts_enabled: enabled, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw new WishAlertsStoreError("Interrupteur des alertes non enregistré");
  if (enabled) return;
  const { error: tokensError } = await fastify.supabaseAdmin.from("push_tokens").delete().eq("user_id", userId).eq("notify_messages", false);
  if (tokensError) throw new WishAlertsStoreError("Appareils des seules alertes non oubliés");
}

// ---- Suivi d'une envie (wish_tracking) ----

/** Une envie qui vient d'être créée (ou une ancienne, au rattrapage). */
export interface WishForTracking {
  id: string;
  userId: string;
  merchantUrl: string | null;
  merchantName: string | null;
  productMatchId: string | null;
}

const MATCH_REFERENCE_ROW = z.object({
  price_min: z.union([z.string(), z.number()]).nullable(),
  currency: z.string().nullable(),
  merchant_name: z.string().nullable(),
  created_at: z.string(),
});

interface Reference {
  ref_price: number;
  ref_currency: string;
  ref_country: string;
  ref_set_on: string;
}

/** La proposition d'origine telle que le serveur l'a rangée : son prix (s'il
 * est sûr) et le nom de sa boutique. `country` : pays de la recherche de la
 * personne (lib/locale.ts) ; null (rattrapage) : aucune référence. */
async function readOriginMatch(fastify: Db, matchId: string, country: string | null): Promise<{ reference: Reference | null; merchantName: string | null } | null> {
  const { data, error } = await fastify.supabaseAdmin.from("product_matches").select("price_min, currency, merchant_name, created_at").eq("id", matchId).maybeSingle();
  if (error) throw new DatabaseReadError("Proposition d'origine illisible");
  const row = MATCH_REFERENCE_ROW.safeParse(data);
  if (!row.success) return null;
  const price = row.data.price_min === null ? null : Number(row.data.price_min);
  const currency = alertCurrency(row.data.currency, country);
  const day = parisDay(row.data.created_at);
  const usable = price !== null && Number.isFinite(price) && price > 0 && currency !== null && country !== null && day !== null;
  return {
    reference: usable ? { ref_price: Math.round(price * 100) / 100, ref_currency: currency, ref_country: country, ref_set_on: day } : null,
    merchantName: row.data.merchant_name,
  };
}

/** La ligne de suivi d'une envie (sans écrire). */
export async function trackingRowFor(fastify: Db, wish: WishForTracking, country: string | null): Promise<Record<string, unknown>> {
  const origin = wish.productMatchId ? await readOriginMatch(fastify, wish.productMatchId, country) : null;
  const key = trackingKeyOf(wish.merchantUrl, origin?.merchantName ?? wish.merchantName);
  return {
    wishlist_item_id: wish.id,
    user_id: wish.userId,
    match_key_hash: key?.hash ?? null,
    key_version: ALERT_KEY_VERSION,
    merchant_key: key?.merchant ?? null,
    ...(key && origin?.reference ? origin.reference : {}),
  };
}

/** Crée le suivi d'une nouvelle envie (une seule fois : déjà là, rien ne
 * change). Ne lève jamais d'erreur et ne fait jamais échouer la création de
 * l'envie : un échec est journalisé (code seulement), le rattrapage s'en chargera. */
export async function trackNewWish(fastify: Db, log: FastifyBaseLogger, wish: WishForTracking, country: string | null): Promise<void> {
  try {
    if (!(await wishAlertsReady(fastify))) return;
    const row = await trackingRowFor(fastify, wish, country);
    const { error } = await fastify.supabaseAdmin.from("wish_tracking").insert(row);
    // Déjà suivie (envie déjà gardée, deux demandes simultanées) : rien à faire.
    if (error && error.code !== "23505") log.warn({ code: error.code ?? null }, "Alertes prix : suivi de l'envie non créé");
  } catch (error) {
    log.warn({ code: error instanceof Error ? error.name : null }, "Alertes prix : suivi de l'envie non créé");
  }
}

const WISH_ROW = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  merchant_url: z.string().nullable(),
  merchant_name: z.string().nullable(),
  product_match_id: z.string().uuid().nullable(),
});

/** L'envie de la personne (null : inexistante ou d'une autre personne). */
export async function readOwnWish(fastify: Db, userId: string, wishId: string): Promise<WishForTracking | null> {
  const { data, error } = await fastify.supabaseAdmin
    .from("wishlist_items")
    .select("id, user_id, merchant_url, merchant_name, product_match_id")
    .eq("id", wishId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new DatabaseReadError("Envie illisible");
  const row = WISH_ROW.safeParse(data);
  if (!row.success) return null;
  return { id: row.data.id, userId: row.data.user_id, merchantUrl: row.data.merchant_url, merchantName: row.data.merchant_name, productMatchId: row.data.product_match_id };
}

const TRACKING_ROW = z.object({
  wishlist_item_id: z.string().uuid(),
  match_key_hash: z.string().nullable(),
  merchant_key: z.string().nullable(),
  stock_state: z.enum(STOCK_STATES),
});
type TrackingRow = z.infer<typeof TRACKING_ROW>;

async function readTracking(fastify: Db, userId: string, wishId: string): Promise<TrackingRow | null> {
  const rows = parseDbRows(
    z.array(TRACKING_ROW),
    await fastify.supabaseAdmin.from("wish_tracking").select("wishlist_item_id, match_key_hash, merchant_key, stock_state").eq("user_id", userId).eq("wishlist_item_id", wishId).limit(1),
    "Suivi d'une envie"
  );
  return rows[0] ?? null;
}

/** Le suivi d'une envie de la personne, créé s'il manque (envie d'avant 0036
 * ou d'avant le rattrapage). null : l'envie n'existe pas pour elle. */
export async function ensureTracking(fastify: Db, log: FastifyBaseLogger, userId: string, wishId: string, country: string | null): Promise<TrackingRow | null> {
  const found = await readTracking(fastify, userId, wishId);
  if (found) return found;
  const wish = await readOwnWish(fastify, userId, wishId);
  if (!wish) return null;
  await trackNewWish(fastify, log, wish, country);
  return (await readTracking(fastify, userId, wishId)) ?? { wishlist_item_id: wishId, match_key_hash: null, merchant_key: null, stock_state: "unknown" };
}

// ---- Cloche (wish_watches) ----

const WATCH_ROW = z.object({
  wishlist_item_id: z.string().uuid(),
  notify_price_drop: z.boolean(),
  notify_restock: z.boolean(),
  notify_sold_out: z.boolean(),
});
type WatchRow = z.infer<typeof WATCH_ROW>;
const WATCH_COLUMNS = "wishlist_item_id, notify_price_drop, notify_restock, notify_sold_out";

function toState(wishId: string, tracking: TrackingRow | null, watch: WatchRow | null): WishAlertState {
  return {
    wishlistItemId: wishId,
    trackable: Boolean(tracking?.match_key_hash),
    priceDrop: watch?.notify_price_drop ?? false,
    restock: watch?.notify_restock ?? false,
    soldOut: watch?.notify_sold_out ?? false,
    stock: tracking?.stock_state ?? "unknown",
  };
}

async function readWatch(fastify: Db, userId: string, wishId: string): Promise<WatchRow | null> {
  const rows = parseDbRows(
    z.array(WATCH_ROW),
    await fastify.supabaseAdmin.from("wish_watches").select(WATCH_COLUMNS).eq("user_id", userId).eq("wishlist_item_id", wishId).limit(1),
    "Cloche d'une envie"
  );
  return rows[0] ?? null;
}

/** La cloche d'une envie de la personne (son suivi créé s'il manque) ; null : envie introuvable. */
export async function readWishAlertState(fastify: Db, log: FastifyBaseLogger, userId: string, wishId: string, country: string | null): Promise<WishAlertState | null> {
  const tracking = await ensureTracking(fastify, log, userId, wishId, country);
  if (!tracking) return null;
  return toState(wishId, tracking, await readWatch(fastify, userId, wishId));
}

/** Au plus ce nombre d'envies dans GET /api/alerts/wishes. */
export const MAX_ALERT_STATES = 1000;

/** La cloche de chacune des envies suivies de la personne (envies avec un suivi ou une cloche). */
export async function readWishAlertStates(fastify: Db, userId: string): Promise<WishAlertState[]> {
  const [trackings, watches] = await Promise.all([
    fastify.supabaseAdmin
      .from("wish_tracking")
      .select("wishlist_item_id, match_key_hash, merchant_key, stock_state")
      .eq("user_id", userId)
      .order("wishlist_item_id", { ascending: true })
      .limit(MAX_ALERT_STATES)
      .then((result) => parseDbRows(z.array(TRACKING_ROW), result, "Suivi des envies")),
    fastify.supabaseAdmin
      .from("wish_watches")
      .select(WATCH_COLUMNS)
      .eq("user_id", userId)
      .order("wishlist_item_id", { ascending: true })
      .limit(MAX_ALERT_STATES)
      .then((result) => parseDbRows(z.array(WATCH_ROW), result, "Cloches des envies")),
  ]);
  const trackingById = new Map(trackings.map((row) => [row.wishlist_item_id, row]));
  const watchById = new Map(watches.map((row) => [row.wishlist_item_id, row]));
  const ids = [...new Set([...trackingById.keys(), ...watchById.keys()])].sort().slice(0, MAX_ALERT_STATES);
  return ids.map((id) => toState(id, trackingById.get(id) ?? null, watchById.get(id) ?? null));
}

/** Ce que la personne a choisi sur la cloche d'une envie. */
export interface WatchChoice {
  priceDrop: boolean;
  restock: boolean;
  soldOut: boolean;
}

/** Enregistre la cloche ; tout coupé : la cloche est retirée. */
export async function saveWatch(fastify: Db, userId: string, wishId: string, choice: WatchChoice): Promise<void> {
  const db = fastify.supabaseAdmin;
  if (!choice.priceDrop && !choice.restock && !choice.soldOut) {
    const { error } = await db.from("wish_watches").delete().eq("user_id", userId).eq("wishlist_item_id", wishId);
    if (error) throw new WishAlertsStoreError("Cloche non retirée");
    return;
  }
  const values = { notify_price_drop: choice.priceDrop, notify_restock: choice.restock, notify_sold_out: choice.soldOut, updated_at: new Date().toISOString() };
  const refresh = async (): Promise<boolean> => {
    const updated = await db.from("wish_watches").update(values).eq("user_id", userId).eq("wishlist_item_id", wishId).select("wishlist_item_id");
    if (updated.error) throw new WishAlertsStoreError("Cloche non mise à jour");
    return parseDbRows(z.array(z.object({ wishlist_item_id: z.string() })), updated, "Cloche mise à jour").length > 0;
  };
  if (await refresh()) return;
  const inserted = await db.from("wish_watches").insert({ wishlist_item_id: wishId, user_id: userId, ...values });
  // Deux demandes simultanées : la base n'en garde qu'une.
  if (inserted.error?.code === "23505" && (await refresh())) return;
  if (inserted.error) throw new WishAlertsStoreError("Cloche non enregistrée");
}

// ---- « Plus disponible » (stock_reports) ----

const REPORT_ROWS = z.array(z.object({ allowed: z.boolean(), matched: z.number().int().nonnegative() })).length(1);

/** Signalement « Plus disponible » d'une pièce (sa clé) par la personne :
 * toutes les envies de la même pièce passent « épuisée », sans aucune
 * alerte. « limited » : 20 signalements déjà aujourd'hui (heure de Paris). */
export async function reportSoldOut(fastify: Db, userId: string, key: Pick<TrackingKey, "hash" | "merchant">): Promise<"reported" | "limited"> {
  const { data, error } = await fastify.supabaseAdmin.rpc("wish_stock_report", {
    p_user_id: userId,
    p_key: key.hash,
    p_merchant: key.merchant,
    p_daily_cap: WISH_ALERT_RULES.stockReportsPerDay,
  });
  if (error) throw new WishAlertsStoreError("Signalement « Plus disponible » non enregistré");
  const parsed = REPORT_ROWS.safeParse(data);
  if (!parsed.success) throw new WishAlertsStoreError("Signalement « Plus disponible » : réponse illisible");
  return parsed.data[0]!.allowed ? "reported" : "limited";
}

// ---- Rattrapage des envies d'avant 0036 (scripts/rattraper-suivi-envies-dev.ts) ----

const BACKFILL_WISH_ROW = WISH_ROW;
const BACKFILL_TRACKING_ROWS = z.array(z.object({ wishlist_item_id: z.string().uuid(), key_version: z.number().int() }));

/** Bilan du rattrapage : des nombres. */
export interface BackfillSummary {
  scanned: number;
  created: number;
  updated: number;
  unchanged: number;
}

/** Crée le suivi des envies qui n'en ont pas, et recalcule la clé de celles
 * dont la version est plus ancienne (ALERT_KEY_VERSION). Rejouable sans
 * effet. Aucun prix de référence (le pays de la recherche d'origine n'est
 * connu nulle part) : la première observation de chaque pièce le fixera,
 * sans alerte. Les envies sont lues page après page (lib/pagedReads.ts). */
export async function backfillWishTracking(fastify: Db): Promise<BackfillSummary> {
  const db = fastify.supabaseAdmin;
  const wishes = (
    await readAll<unknown>("Envies à suivre", () => db.from("wishlist_items").select("id, user_id, merchant_url, merchant_name, product_match_id", { count: "exact" }), [
      "created_at",
      "id",
    ])
  ).map((raw) => {
    const row = BACKFILL_WISH_ROW.parse(raw);
    return { id: row.id, userId: row.user_id, merchantUrl: row.merchant_url, merchantName: row.merchant_name, productMatchId: row.product_match_id };
  });
  const summary: BackfillSummary = { scanned: wishes.length, created: 0, updated: 0, unchanged: 0 };
  for (const part of chunks(wishes)) {
    const existing = parseDbRows(
      BACKFILL_TRACKING_ROWS,
      await db.from("wish_tracking").select("wishlist_item_id, key_version").in("wishlist_item_id", part.map((wish) => wish.id)),
      "Suivi déjà là"
    );
    const versions = new Map(existing.map((row) => [row.wishlist_item_id, row.key_version]));
    for (const wish of part) {
      const version = versions.get(wish.id);
      if (version !== undefined && version >= ALERT_KEY_VERSION) {
        summary.unchanged += 1;
        continue;
      }
      const row = await trackingRowFor(fastify, wish, null);
      if (version === undefined) {
        const { error } = await db.from("wish_tracking").insert(row);
        if (error && error.code !== "23505") throw new WishAlertsStoreError("Suivi d'une envie non créé");
        if (error) summary.unchanged += 1;
        else summary.created += 1;
      } else {
        const { error } = await db
          .from("wish_tracking")
          .update({ match_key_hash: row.match_key_hash, merchant_key: row.merchant_key, key_version: row.key_version, updated_at: new Date().toISOString() })
          .eq("wishlist_item_id", wish.id);
        if (error) throw new WishAlertsStoreError("Clé d'une envie non recalculée");
        summary.updated += 1;
      }
    }
  }
  return summary;
}
