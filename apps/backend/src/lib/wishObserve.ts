// Alertes prix et stock (lot 2, migration 0036) : l'observation des
// résultats. Après la réponse d'une recherche (jamais avant, jamais en la
// ralentissant), les propositions FRAÎCHES que la personne vient de recevoir
// sont comparées aux envies des membres, dans la base, en un seul appel
// atomique (wish_observe). Aucune surveillance en tâche de fond, aucun appel payé.
//
// Règles :
// - seulement les réponses fraîches : Lens appelé (jamais le cache de 24 h,
//   ni la réponse d'un appel identique en cours), Google Shopping appelé
//   (jamais le cache), « Que cherchez-vous ? » ; pour les boutiques ensuite et
//   « Que cherchez-vous ? », seulement les nouvelles propositions ; rien quand
//   l'enregistrement a échoué (routes/searches.ts décide, ici on compte) ;
// - un achat via Spotto (« Je l'ai achetée ») annonce seulement « disponible
//   chez cette boutique aujourd'hui », sans prix — sauf si l'acheteur a
//   lui-même signalé la pièce « Plus disponible » ces 30 derniers jours ;
//   les envies de l'acheteur de la même pièce sont notées achetées AVANT
//   (markPurchase, lib/wishAlerts.ts, route du Vault) : l'achat ne lui envoie
//   jamais « De retour en stock » pour sa propre envie ;
// - un seul membre ne fabrique jamais un « De retour en stock » chez les
//   autres : la base (migration 0040) n'annonce le retour en stock qu'après
//   un « épuisé » annoncé par la boutique, jamais après des signalements
//   « Plus disponible », et un signalement ne touche les envies des autres
//   qu'à partir de deux membres différents ;
// - par lot, une observation par clé ; une clé dont les observations ne
//   s'accordent pas (prix, devise, pays, stock, boutique) est écartée ;
// - prix ≤ 0 ou devise inconnue : pas de prix (alertCurrency) ; en centimes ;
// - jamais qui a cherché ou acheté : la base ne reçoit que des empreintes de
//   clés, des prix, des devises, des pays et des stocks ;
// - « compteur gratuit » : pour chaque réponse fraîche, le journal compte (et
//   seulement compte) les stocks annoncés (true/false), les identifiants
//   produits de SerpApi et les clés — même sans 0036, pour savoir si un
//   « épuisé » arrive un jour. Journal racine, jamais de compte, de titre ni d'adresse ;
// - lancé puis oublié : au plus 4 observations en cours par serveur (au-delà,
//   celle-ci est sautée et comptée), aucune erreur ne remonte ;
// - une observation qui crée des alertes lance aussitôt un passage d'envoi
//   (sendWishAlertsNow, lib/wishAlertsSend.ts) : le membre est prévenu à la
//   seconde près, toujours après la réponse de la recherche ou de l'achat.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { alertCurrency, WISH_ALERT_RULES, SEARCH_COUNTRIES } from "@monapp/shared-types";
import { trackingKeyOf } from "./alertKeys.js";
import { sendWishAlertsNow } from "./wishAlertsSend.js";
import { wishAlertsReady } from "./wishAlertsSchema.js";

/** D'où vient l'observation (valeur d'une liste fermée, pour le journal). */
export type ObservationSource = "lens" | "shopping" | "words" | "purchase";

/** Une proposition observée, telle que la recherche l'a reçue (VisualMatch,
 * ShoppingMatch). */
export interface ObservedRow {
  merchantUrl: string;
  merchantName: string | null;
  priceValue: number | null;
  currency: string | null;
  inStock?: boolean;
  hasProductId?: true;
}

/** Ce qui part vers wish_observe : jamais une adresse ni une personne. */
export interface Observation {
  /** Empreinte de la clé « même pièce ». */
  k: string;
  /** Boutique normalisée. */
  m: string | null;
  /** Prix en centimes (entier), ou null. */
  p: number | null;
  /** Devise ISO du prix. */
  c: string | null;
  /** Pays de la recherche. */
  n: string | null;
  /** Stock annoncé. */
  s: boolean | null;
}

/** Des nombres seulement (« compteur gratuit »). */
export interface ObservationCounts {
  rows: number;
  keyed: number;
  googleKeys: number;
  inStockTrue: number;
  inStockFalse: number;
  productIdField: number;
  conflicts: number;
  observations: number;
}

/** Au plus ce nombre d'observations par appel (la base refuse au-delà de 200). */
export const MAX_OBSERVATIONS = 200;
/** Au plus ce nombre d'observations en cours par serveur. */
export const MAX_OBSERVERS_IN_FLIGHT = 4;

function cents(price: number | null): number | null {
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  const value = Math.round(price * 100);
  return value > 0 ? value : null;
}

function agree<T>(a: T | null, b: T | null): boolean {
  return a === null || b === null || a === b;
}

/** Les observations d'une réponse, une par clé, et le compteur gratuit. Sans
 * réseau ni base (testée à part). `country` : pays de la recherche ; null
 * pour un achat (aucun prix). */
export function buildObservations(rows: readonly ObservedRow[], country: string | null): { observations: Observation[]; counts: ObservationCounts } {
  const counts: ObservationCounts = { rows: rows.length, keyed: 0, googleKeys: 0, inStockTrue: 0, inStockFalse: 0, productIdField: 0, conflicts: 0, observations: 0 };
  const byKey = new Map<string, Observation | "conflict">();
  const supported = country !== null && (SEARCH_COUNTRIES as readonly string[]).includes(country);
  for (const row of rows) {
    if (row.inStock === true) counts.inStockTrue += 1;
    if (row.inStock === false) counts.inStockFalse += 1;
    if (row.hasProductId) counts.productIdField += 1;
    const key = trackingKeyOf(row.merchantUrl, row.merchantName);
    if (!key) continue;
    counts.keyed += 1;
    if (key.kind === "google") counts.googleKeys += 1;
    const currency = alertCurrency(row.currency, country);
    // Lot « durcissement des alertes » : un prix ne sert aux alertes que venu
    // d'un pays que la recherche prend en charge (SEARCH_COUNTRIES). Une
    // recherche faite avec une autre région (« en-NZ ») garde son pays pour la
    // recherche elle-même, mais n'apporte aux alertes que l'état du stock :
    // elle ne peut jamais fixer le prix de référence des autres membres.
    const price = currency !== null && supported ? cents(row.priceValue) : null;
    const observation: Observation = {
      k: key.hash,
      m: key.merchant,
      p: price,
      c: price === null ? null : currency,
      n: price === null ? null : country,
      s: typeof row.inStock === "boolean" ? row.inStock : null,
    };
    const known = byKey.get(key.hash);
    if (known === undefined) {
      byKey.set(key.hash, observation);
      continue;
    }
    if (known === "conflict") continue;
    const same = agree(known.m, observation.m) && agree(known.p, observation.p) && agree(known.c, observation.c) && agree(known.n, observation.n) && agree(known.s, observation.s);
    if (!same) {
      byKey.set(key.hash, "conflict");
      counts.conflicts += 1;
      continue;
    }
    byKey.set(key.hash, {
      k: key.hash,
      m: known.m ?? observation.m,
      p: known.p ?? observation.p,
      c: known.c ?? observation.c,
      n: known.n ?? observation.n,
      s: known.s ?? observation.s,
    });
  }
  const observations = [...byKey.values()]
    .filter((value): value is Observation => value !== "conflict")
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .slice(0, MAX_OBSERVATIONS);
  counts.observations = observations.length;
  return { observations, counts };
}

const OBSERVE_ROWS = z.array(z.object({ matched: z.number().int().nonnegative(), events: z.number().int().nonnegative() })).length(1);

export const OBSERVATION_LOG_MESSAGE = "Alertes prix : observation";

export interface ObserveInput {
  source: ObservationSource;
  rows: readonly ObservedRow[];
  /** Pays de la recherche (searchLocaleFor) ; null pour un achat. */
  country: string | null;
  /** Achat : rien n'est observé si cette personne (l'acheteur) a signalé
   * l'une de ces pièces « Plus disponible » récemment. */
  skipIfReportedBy?: string;
}

const inFlight = new Set<Promise<void>>();

/** Observe des propositions fraîches, sans jamais faire attendre ni échouer
 * la réponse : à appeler APRÈS reply.send, sans `await`. */
export function observeResults(fastify: FastifyInstance, input: ObserveInput): void {
  if (input.rows.length === 0) return;
  if (inFlight.size >= MAX_OBSERVERS_IN_FLIGHT) {
    fastify.log.info({ source: input.source, rows: input.rows.length, outcome: "busy" }, OBSERVATION_LOG_MESSAGE);
    return;
  }
  const task = runObservation(fastify, input).catch((error: unknown) => {
    fastify.log.warn({ source: input.source, code: error instanceof Error ? error.name : null }, "Alertes prix : observation impossible");
  });
  inFlight.add(task);
  void task.finally(() => inFlight.delete(task));
}

/** « Je l'ai achetée » sur une proposition : disponible chez cette boutique
 * aujourd'hui (aucun prix, aucune personne envoyée à la base). `buyerId` ne
 * sert qu'à vérifier, avant, que l'acheteur n'a pas signalé lui-même la pièce
 * « Plus disponible » (WISH_ALERT_RULES.purchaseAfterOwnReportDays). Jamais
 * dans le journal. À n'appeler qu'une fois les envies de l'acheteur notées
 * achetées (markPurchase a répondu true). */
export function observePurchase(fastify: FastifyInstance, buyerId: string, match: { merchantUrl: string; merchantName: string | null }): void {
  observeResults(fastify, {
    source: "purchase",
    rows: [{ merchantUrl: match.merchantUrl, merchantName: match.merchantName, priceValue: null, currency: null, inStock: true }],
    country: null,
    skipIfReportedBy: buyerId,
  });
}

/** Le jour de Paris il y a `days` jours, « AAAA-MM-JJ ». */
function parisDayBefore(days: number, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now.getTime() - days * 86_400_000));
}

/** Cette personne a-t-elle signalé l'une de ces pièces « Plus disponible »
 * récemment ? Lecture impossible : oui (dans le doute, l'achat ne vaut pas
 * « disponible »). */
async function reportedRecently(fastify: FastifyInstance, userId: string, keys: readonly string[]): Promise<boolean> {
  const { data, error } = await fastify.supabaseAdmin
    .from("stock_reports")
    .select("id")
    .eq("user_id", userId)
    .in("match_key_hash", [...keys])
    .gte("created_on", parisDayBefore(WISH_ALERT_RULES.purchaseAfterOwnReportDays))
    .limit(1);
  if (error || !Array.isArray(data)) return true;
  return data.length > 0;
}

/** Tests seulement : attend la fin des observations en cours. */
export async function flushObservations(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}

async function runObservation(fastify: FastifyInstance, input: ObserveInput): Promise<void> {
  const { observations, counts } = buildObservations(input.rows, input.country);
  let outcome: "counted" | "observed" | "failed" | "own_report" = "counted";
  let matched = 0;
  let events = 0;
  const ready = observations.length > 0 && (await wishAlertsReady(fastify));
  if (ready && input.skipIfReportedBy && (await reportedRecently(fastify, input.skipIfReportedBy, observations.map((observation) => observation.k)))) {
    outcome = "own_report";
  } else if (ready) {
    const { data, error } = await fastify.supabaseAdmin.rpc("wish_observe", { p_batch: observations });
    const parsed = OBSERVE_ROWS.safeParse(data);
    if (error || !parsed.success) {
      outcome = "failed";
      fastify.log.warn({ source: input.source, code: error?.code ?? null }, "Alertes prix : observation refusée par la base");
    } else {
      outcome = "observed";
      matched = parsed.data[0]!.matched;
      events = parsed.data[0]!.events;
    }
  }
  // Journal racine : des nombres et des valeurs d'une liste fermée.
  fastify.log.info({ source: input.source, ...counts, matched, events, outcome }, OBSERVATION_LOG_MESSAGE);
  // Des alertes viennent de naître : envoyées tout de suite (« à la seconde près »).
  if (events > 0) sendWishAlertsNow(fastify);
}
