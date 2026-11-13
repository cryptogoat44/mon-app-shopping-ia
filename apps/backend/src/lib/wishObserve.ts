// Alertes prix et stock (lot 2, migration 0036 ; nouvelle version, 0041) :
// l'observation des résultats. Après la réponse d'une recherche (jamais
// avant, jamais en la ralentissant), les propositions FRAÎCHES que la
// personne vient de recevoir sont comparées aux envies des membres, dans la
// base, en un seul appel atomique (wish_observe). Aucune surveillance en
// tâche de fond, aucun appel payé.
//
// Règles :
// - seulement les réponses fraîches : Lens appelé (jamais le cache de 24 h,
//   ni la réponse d'un appel identique en cours), Google Shopping appelé
//   (jamais le cache), « Que cherchez-vous ? » ; pour les boutiques ensuite et
//   « Que cherchez-vous ? », seulement les nouvelles propositions ; rien quand
//   l'enregistrement a échoué (routes/searches.ts décide, ici on compte) ;
// - un achat (« Je l'ai achetée ») n'est JAMAIS observé (0041) : il ne
//   compare rien avec les envies des autres membres ; il ne fait que noter
//   achetées les envies de l'acheteur de la même pièce (markPurchase) ;
// - la base reçoit le membre qui a cherché (p_observer) pour deux règles
//   seulement : « Aider les autres membres » coupé, ses recherches ne servent
//   qu'à ses propres envies ; et « De retour en stock » ne part jamais quand
//   il est l'un des auteurs de la série de signalements « Plus disponible »
//   en cours. Elle ne le garde nulle part, et le journal ne le dit jamais ;
// - par lot, une observation par empreinte ; une empreinte dont les
//   observations ne s'accordent pas (prix, devise, pays, stock, boutique) est écartée ;
// - prix ≤ 0, devise inconnue, ou devise qui n'est pas celle du pays de la
//   recherche : pas de prix (une baisse ne se compare qu'à pays et devise
//   identiques) ; en centimes ;
// - « compteur gratuit » : pour chaque réponse fraîche, le journal compte (et
//   seulement compte) les stocks annoncés (true/false), les identifiants
//   produits de SerpApi et les empreintes — même sans les alertes, pour
//   savoir si un « épuisé » arrive un jour. Journal racine (détaché de la
//   requête), jamais de compte, d'envie, de titre ni d'adresse ;
// - lancé puis oublié : au plus 4 observations en cours par serveur (au-delà,
//   celle-ci est sautée et comptée), aucune erreur ne remonte ;
// - une observation qui crée des alertes lance aussitôt un passage d'envoi
//   (sendWishAlertsNow, lib/wishAlertsSend.ts), lui aussi détaché de la
//   requête : le membre est prévenu à la seconde près, toujours après la
//   réponse de la recherche.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { alertCurrency, COUNTRY_CURRENCIES, SEARCH_COUNTRIES } from "@monapp/shared-types";
import { trackingKeyOf } from "./alertKeys.js";
import { sendWishAlertsNow } from "./wishAlertsSend.js";
import { wishAlertsReady } from "./wishAlertsSchema.js";

/** D'où vient l'observation (valeur d'une liste fermée, pour le journal). */
export type ObservationSource = "lens" | "shopping" | "words";

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

/** Ce qui part vers wish_observe pour chaque pièce : jamais une adresse ni
 * une personne (le membre qui cherche part à côté, p_observer). */
export interface Observation {
  /** Empreinte du lien de la boutique (« même pièce »). */
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

/** Les observations d'une réponse, une par empreinte, et le compteur
 * gratuit. Sans réseau ni base (testée à part). `country` : pays de la recherche. */
export function buildObservations(rows: readonly ObservedRow[], country: string | null): { observations: Observation[]; counts: ObservationCounts } {
  const counts: ObservationCounts = { rows: rows.length, keyed: 0, inStockTrue: 0, inStockFalse: 0, productIdField: 0, conflicts: 0, observations: 0 };
  const byKey = new Map<string, Observation | "conflict">();
  const supported = country !== null && (SEARCH_COUNTRIES as readonly string[]).includes(country);
  for (const row of rows) {
    if (row.inStock === true) counts.inStockTrue += 1;
    if (row.inStock === false) counts.inStockFalse += 1;
    if (row.hasProductId) counts.productIdField += 1;
    const key = trackingKeyOf(row.merchantUrl, row.merchantName);
    if (!key) continue;
    counts.keyed += 1;
    const currency = alertCurrency(row.currency, country);
    // Lot « durcissement des alertes » : un prix ne sert aux alertes que venu
    // d'un pays que la recherche prend en charge (SEARCH_COUNTRIES). Une
    // recherche faite avec une autre région (« en-NZ ») garde son pays pour la
    // recherche elle-même, mais n'apporte aux alertes que l'état du stock :
    // elle ne peut jamais fixer le seuil des autres membres. Nouvelle version
    // (0041) : seulement dans la devise de ce pays (même pays, même devise).
    const local = supported && country !== null && currency !== null && COUNTRY_CURRENCIES[country] === currency;
    const price = local ? cents(row.priceValue) : null;
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
  /** Pays de la recherche (searchLocaleFor). */
  country: string | null;
  /** Le membre qui a cherché : envoyé à la base pour son réglage « Aider les
   * autres membres » et la règle des auteurs, jamais au journal. */
  observerId: string;
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

/** Tests seulement : attend la fin des observations en cours. */
export async function flushObservations(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}

async function runObservation(fastify: FastifyInstance, input: ObserveInput): Promise<void> {
  const { observations, counts } = buildObservations(input.rows, input.country);
  let outcome: "counted" | "observed" | "failed" = "counted";
  let matched = 0;
  let events = 0;
  const ready = observations.length > 0 && (await wishAlertsReady(fastify));
  if (ready) {
    const { data, error } = await fastify.supabaseAdmin.rpc("wish_observe", { p_batch: observations, p_observer: input.observerId });
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
  // Journal racine : des nombres et des valeurs d'une liste fermée (jamais le
  // membre qui a cherché, ni une envie, ni un membre prévenu).
  fastify.log.info({ source: input.source, ...counts, matched, events, outcome }, OBSERVATION_LOG_MESSAGE);
  // Des alertes viennent de naître : envoyées tout de suite (« à la seconde près »).
  if (events > 0) sendWishAlertsNow(fastify);
}
