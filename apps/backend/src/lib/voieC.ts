// Voie C (lot c, 2026-11-02) : le cœur du complément des résultats Lens, en
// fonctions sans réseau propre. Tout ce qui parle au monde (cache, IA, Google
// Shopping, plafonds, horloge, connexion de l'app) passe par des PORTS, dont
// les types sont définis ici : rien n'est importé des modules de l'IA, du
// cache ni du tri léger. La route (routes/searches.ts) les branche ; les
// tests les remplacent par des faux.
//
// Règles du fondateur, tenues ici :
// - les résultats Lens sont toujours gardés, montrés en premier, jamais
//   remplacés ni réordonnés ; le complément ne lève jamais d'erreur, et toute
//   panne revient à « les résultats Lens seuls » ;
// - jamais plus de 3 recherches réelles par photo (lib/deadline.ts), et la
//   même image relancée ne refait jamais les mêmes recherches (cache de 24 h,
//   et un seul appel à la fois pour une même clé : lib/singleFlight.ts) ;
// - le complément ne dépasse jamais T0 + 14 s, et garde 1,5 s pour
//   l'enregistrement ;
// - journaux : des nombres et des valeurs de listes fermées seulement ; jamais
//   la requête, un titre, une marque, un modèle, vos mots, une adresse ni un
//   identifiant. La requête de l'IA n'est rendue que dans la réponse du
//   lancement (ou, boutiques ensuite, dans celle de POST
//   /api/searches/:id/complement) ; vos mots ne sont ni enregistrés, ni
//   journalisés, ni mis en cache.
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { SEARCH_QUERY_MAX_LENGTH, type ComplementStatus, type SearchComplement, type TextSearchStatus } from "@monapp/shared-types";
import { LENS_SECTIONS, type LensMeasure } from "../services/lensMeasure.js";
import { CURRENT_LENS_SETTINGS, type SearchLocale } from "../services/lensSettings.js";
import { ProviderFailure, type TextSearchResponse } from "../services/searchProvider.js";
import { googleDomainFor, SHOPPING_SETTINGS } from "../services/serpapi.js";
import { filterShoppingItems, keepShown, withoutKnownPages, type ShoppingFiltered, type ShoppingMatch } from "../services/textSearch.js";
import { sanitizeQuery } from "../services/videoMoments.js";
import { MAX_MATCHES, MAX_PRICED_ADDITIONS, type VisualMatch } from "../services/visualSearch.js";
import { voieCEnabled } from "./aiSwitches.js";
import { photoCallsLeft, VOIE_C_BUDGET, type Deadline } from "./deadline.js";
import type { SearchReservation } from "./searchCapacity.js";
import { AI_ERROR_KINDS, NO_QUERY_REASONS, totalSeconds, type AiErrorKind, type ComplementMeasure, type NoQueryReason } from "./searchMeasure.js";
import { singleFlight } from "./singleFlight.js";
import { sortByWords } from "./wordSort.js";

// ---- Contenus du cache (lus avec zod : un contenu illisible vaut « absent ») ----

const VISUAL_MATCH = z.object({
  rank: z.number().int().positive(),
  productName: z.string().min(1),
  imageUrl: z.string().min(1),
  imageHdUrl: z.string().nullable(),
  merchantName: z.string().nullable(),
  merchantUrl: z.string().min(1),
  priceValue: z.number().nonnegative().nullable(),
  currency: z.string().nullable(),
  // Alertes prix et stock (lot 2) : le stock annoncé par Lens, gardé avec la
  // réponse (une réponse du cache n'est jamais observée, mais elle est rejouée telle quelle).
  inStock: z.boolean().optional(),
});
const COUNT = z.number().int().nonnegative();

/** Réponse de Lens filtrée, AVANT le tri par les mots de la photo (ils ne
 * sont jamais en cache), avec sa mesure et les rangs ajoutés par la règle des prix. */
export const LENS_CACHE_PAYLOAD = z.object({
  matches: z.array(VISUAL_MATCH).max(MAX_MATCHES + MAX_PRICED_ADDITIONS),
  measure: z.object({
    removedIncomplete: COUNT,
    removedSocial: COUNT,
    removedProfessional: COUNT,
    removedDuplicates: COUNT,
    received: COUNT,
    kept: COUNT,
    keptWithPrice: COUNT,
    keptOtherCurrency: COUNT.nullable(),
    distinctSites: COUNT,
    sections: z.array(z.enum([...LENS_SECTIONS, "other"])),
    googleState: z.enum(["empty", "other"]).nullable(),
  }),
  addedRanks: z.array(z.number().int().positive()).max(MAX_PRICED_ADDITIONS),
});

/** Requête écrite par l'IA (avec la marque et le modèle, pour le tri léger),
 * ou son absence et la raison : les deux sont gardées. */
export const QUERY_CACHE_PAYLOAD = z.union([
  z
    .object({
      query: z.string().min(1).max(SEARCH_QUERY_MAX_LENGTH),
      brand: z.string().max(SEARCH_QUERY_MAX_LENGTH),
      model: z.string().max(SEARCH_QUERY_MAX_LENGTH),
    })
    .strict(),
  z.object({ no_query: z.literal(true), reason: z.enum(NO_QUERY_REASONS) }).strict(),
]);

/** Réponse de Google Shopping filtrée (avant les pages Lens, le tri et la
 * coupe à 20), pour une requête de l'IA seulement. */
export const SHOPPING_CACHE_PAYLOAD = z.object({
  matches: z.array(VISUAL_MATCH.extend({ priceHidden: z.boolean(), hasProductId: z.literal(true).optional() })).max(60),
  received: COUNT,
  droppedDataThumbnails: COUNT,
});

export type LensAnswer = z.infer<typeof LENS_CACHE_PAYLOAD>;
type QueryCachePayload = z.infer<typeof QUERY_CACHE_PAYLOAD>;

// ---- Ports ----

/** Étapes mises en cache (contrainte search_cache.step, 0028). */
export type CacheStep = "lens" | "query" | "shopping";

/** Lecture du cache (lib/searchCache.ts, readCache, base et journal liés) :
 * null = absent ; ne lève jamais d'erreur. */
export type CacheReader = <T>(key: string, schema: z.ZodType<T>, signal: AbortSignal) => Promise<T | null>;
/** Écriture du cache (writeCache, base et journal liés), jamais attendue par
 * le lancement. */
export type CacheWriter = (key: string, step: CacheStep, payload: unknown) => unknown;
/** Clé d'une entrée (cacheKey) : SHA-256 de l'étape et des parties. */
export type CacheKeyMaker = (step: CacheStep, parts: string[]) => string;

export type VoieCLog = Pick<FastifyBaseLogger, "warn" | "error">;

/** Un résultat Lens envoyé à l'IA : son titre et son site (nom de domaine). */
export interface AiLensItem {
  title: string;
  site: string | null;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Réponse de l'IA (services/shoppingQueryAi.ts, askShoppingQuery), déjà
 * vérifiée par le serveur. Une panne lève une erreur dont `kind` est
 * « unavailable », « refused » ou « invalid_output ». */
export type ShoppingQueryAnswer =
  | { kind: "query"; value: { query: string; brand: string; model: string }; usage: AiUsage }
  | { kind: "no_query"; reason: NoQueryReason; usage: AiUsage };

/** Tri léger (lib/lightSort.ts, lightSort) : paliers 0, 1, 2, rien de retiré. */
export type LightSortPort = <T extends { productName: string }>(
  items: T[],
  reference: { brand: string; model: string }
) => { items: T[]; tierCounts: readonly number[] };

/** Ports du cache, communs à l'étape Lens et au complément. */
export interface CachePorts {
  readCache: CacheReader;
  writeCache: CacheWriter;
  cacheKey: CacheKeyMaker;
  /** Signal déclenché après `ms` (par défaut AbortSignal.timeout) : les tests y lisent les délais. */
  timeoutSignal?(ms: number): AbortSignal;
}

export interface ComplementPorts extends CachePorts {
  /** L'IA, texte seulement (titres et sites Lens), avec son délai. */
  askQuery(items: AiLensItem[], locale: SearchLocale, signal: AbortSignal): Promise<ShoppingQueryAnswer>;
  /** Clé du cache de la requête (consignes, modèle, pays, langue, entrée de l'IA). */
  aiInputKey(items: AiLensItem[], locale: SearchLocale): string;
  sortShopping: LightSortPort;
  /** UN appel à Google Shopping (serpApiTextProvider.searchByText) ; une panne lève une ProviderFailure. */
  searchText(query: string, locale: SearchLocale, signal: AbortSignal): Promise<TextSearchResponse>;
  /** Réserve la place de l'appel à Google Shopping (reserveSearch, étape « shopping »). */
  reserve(): Promise<SearchReservation>;
  /** Rend la place d'un refus non facturé (releaseReservation, étape « shopping »). */
  release(reservationId: number): Promise<boolean>;
  /** Lecture seule du plafond avant l'IA (searchCapacityBeforeComplementAi) : true s'il reste de la place. */
  capacityLeft(): Promise<boolean>;
  /** Compte un appel dans la limite commune de l'IA (lib/aiQuota.ts, shoppingQueryAiGlobal, dans la base) : false si atteinte ou illisible. */
  consumeAiLimit(): boolean | Promise<boolean>;
  /** La personne a coupé la connexion (« Annuler ») : plus d'IA ni de Google Shopping. */
  socketDestroyed(): boolean;
  /** Horloge des durées mesurées. */
  now(): number;
  log: VoieCLog;
}

// ---- Clés du cache ----

/** Version des clés : à changer dès que les filtres de Lens ou de Google Shopping changent.
 * v2 (lot « premier essai ») : Threads et pages sans vente écartés, prix sans devise retirés.
 * v3 (lot alertes prix et stock) : le stock annoncé par Lens (inStock) et la
 * présence d'un identifiant produit de Google Shopping sont gardés. */
const CACHE_KEY_VERSION = "v3";

/** Parties de la clé Lens : moteur, type, pays, langue et empreinte de l'image préparée. */
export function lensCacheParts(locale: SearchLocale, imageHash: string): string[] {
  return [CACHE_KEY_VERSION, "google_lens", CURRENT_LENS_SETTINGS.type, locale.country, locale.hl, imageHash];
}

/** Requête normalisée pour la clé : NFC, minuscules, espaces simples. */
export function normalizedQuery(query: string): string {
  return query.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Parties de la clé Google Shopping (requêtes de l'IA seulement) : moteur,
 * requête normalisée, pays (gl), langue (hl) et domaine de Google. */
export function shoppingCacheParts(query: string, locale: SearchLocale): string[] {
  return [CACHE_KEY_VERSION, SHOPPING_SETTINGS.engine, normalizedQuery(query), locale.country, locale.hl, googleDomainFor(locale.country)];
}

// ---- Outils communs ----

function signalAfter(ports: Pick<CachePorts, "timeoutSignal">, ms: number): AbortSignal {
  return ports.timeoutSignal ? ports.timeoutSignal(ms) : AbortSignal.timeout(ms);
}

/** Lecture bornée à 800 ms ; une erreur vaut « absent ». */
async function readCacheSafely<T>(ports: CachePorts, key: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    return await ports.readCache(key, schema, signalAfter(ports, VOIE_C_BUDGET.cacheReadMs));
  } catch {
    return null;
  }
}

/** Écriture jamais attendue par le lancement, jamais bloquante ; ne lève
 * jamais d'erreur. La promesse rendue (réglée une fois l'écriture finie, ou
 * échouée) ne sert qu'à garder l'entrée de singleFlight jusque-là. */
function writeCacheSafely(ports: CachePorts, key: string, step: CacheStep, payload: unknown): Promise<void> {
  return Promise.resolve()
    .then(() => ports.writeCache(key, step, payload))
    .then(
      () => undefined,
      () => undefined
    );
}

/** Au plus ce temps après l'appel, l'entrée de singleFlight attend l'écriture
 * du cache (la base a des pointes mesurées de 0,5 à 4,8 s). */
const CACHE_WRITE_HOLD_MS = 10_000;

/** Entre la fin de l'appel et l'écriture du cache, l'image n'est ni en cours,
 * ni lisible dans le cache : l'entrée de singleFlight, déjà réglée, reste donc
 * jusqu'à l'écriture (10 s au plus), et une relance arrivée entre-temps reçoit
 * la même réponse au lieu de payer à nouveau la même recherche. Jamais pour
 * une part vide (panne, refus) : elle n'est pas partagée. */
function heldUntilWritten(leg: { shared: unknown; written?: Promise<void> }): Promise<void> | null {
  const written = leg.written;
  if (!written || leg.shared === null) return null;
  return new Promise<void>((resolve) => {
    // Minuterie ordinaire (jamais ports.timeoutSignal) : elle ne retient pas
    // le processus et ne compte pas parmi les délais des étapes.
    const timer = setTimeout(resolve, CACHE_WRITE_HOLD_MS);
    timer.unref();
    void written.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Nom de l'erreur (« TypeError »…), jamais son message. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** Résultat d'une étape partagée : la part partageable (null : rien à
 * partager), le résultat propre au lancement qui a appelé, et l'écriture du
 * cache en cours, s'il y en a une. */
type Leg<T, R> = { shared: T | null; own: R; written?: Promise<void> };

const LATE = Symbol("late");

/** Résout LATE dès que le signal est déclenché (jamais s'il ne l'est pas). */
function lateAfter(signal: AbortSignal): Promise<typeof LATE> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve(LATE);
    else signal.addEventListener("abort", () => resolve(LATE), { once: true });
  });
}

/** Un seul appel à la fois pour une même clé, reprises comprises.
 * - Celui qui lance l'étape garde son propre résultat.
 * - Ceux qui arrivent pendant l'appel, ou après lui mais avant l'écriture de
 *   sa réponse dans le cache (heldUntilWritten), reçoivent sa part
 *   partageable (une réponse facturée). Sans elle (panne, refus, arrêt avant
 *   l'appel), ils ne font pas chacun leur appel : ils repassent par
 *   singleFlight, où l'un d'eux relance l'étape et où les autres, comme tout
 *   lancement arrivé entre-temps, l'attendent. Jamais deux appels identiques
 *   en même temps dans ce processus.
 * - `maxWaitMs` (complément seulement) : l'attente de l'appel d'un AUTRE
 *   lancement ne dépasse jamais le budget de celui-ci ; au-delà, « late »
 *   (l'appel attendu, lui, continue). Jamais pour Lens : son appel a déjà son
 *   propre plafond fixe de 12 s. */
function sharedStep<T, R>(ports: Pick<CachePorts, "timeoutSignal">, key: string, run: () => Promise<Leg<T, R>>): Promise<{ own: R } | { shared: T }>;
function sharedStep<T, R>(
  ports: Pick<CachePorts, "timeoutSignal">,
  key: string,
  run: () => Promise<Leg<T, R>>,
  maxWaitMs: () => number
): Promise<{ own: R } | { shared: T } | { late: true }>;
async function sharedStep<T, R>(
  ports: Pick<CachePorts, "timeoutSignal">,
  key: string,
  run: () => Promise<Leg<T, R>>,
  maxWaitMs?: () => number
): Promise<{ own: R } | { shared: T } | { late: true }> {
  for (;;) {
    let ran = false;
    // Sans appel en cours, singleFlight lance `run` tout de suite : `ran` est connu dès le retour.
    const flight = singleFlight(
      key,
      () => {
        ran = true;
        return run();
      },
      heldUntilWritten
    );
    let leg: Leg<T, R> | typeof LATE;
    try {
      if (ran || maxWaitMs === undefined) {
        leg = await flight;
      } else {
        const waitMs = Math.floor(maxWaitMs());
        if (waitMs < 1) return { late: true };
        leg = await Promise.race([flight, lateAfter(signalAfter(ports, waitMs))]);
      }
    } catch (error) {
      if (ran) throw error;
      continue;
    }
    if (leg === LATE) return { late: true };
    if (ran) return { own: leg.own };
    if (leg.shared !== null) return { shared: leg.shared };
  }
}

// ---- Étape Lens ----

export type LensStepPorts = CachePorts;

export interface LensStepInput<R> {
  /** Empreinte de l'image préparée (imageHash). */
  imageHash: string;
  locale: SearchLocale;
  /** Le chemin d'avant la voie C, quand le cache n'a rien : dépôt de l'image,
   * vérification de la connexion, réservation, appel à Lens (12 s fixes). */
  call(): Promise<R>;
  /** La réponse facturée à garder et à partager (trouvé, rien d'achetable,
   * Lens vide) ; null : panne, refus ou arrêt avant l'appel, jamais gardés. */
  answerOf(result: R): LensAnswer | null;
}

/** lensFromCache : réponse du cache (ou d'un appel identique en cours),
 * sans appel ni réservation pour ce lancement. Sinon, le résultat du chemin
 * d'avant (`result`) et sa réponse facturée, s'il y en a une. */
export type LensStepResult<R> = { lensFromCache: true; answer: LensAnswer } | { lensFromCache: false; result: R; answer: LensAnswer | null };

/** Étape Lens : un seul appel à la fois pour la même image (même pays, même
 * langue) ; cache lu (800 ms au plus), sinon `call`, puis la réponse facturée
 * écrite dans le cache (sans l'attendre). */
export async function lensStep<R>(ports: LensStepPorts, input: LensStepInput<R>): Promise<LensStepResult<R>> {
  const key = ports.cacheKey("lens", lensCacheParts(input.locale, input.imageHash));
  const step = await sharedStep(ports, key, async (): Promise<Leg<LensAnswer, LensStepResult<R>>> => {
    const cached = await readCacheSafely(ports, key, LENS_CACHE_PAYLOAD);
    if (cached) return { shared: cached, own: { lensFromCache: true, answer: cached } };
    const result = await input.call();
    const answer = input.answerOf(result);
    const written = answer ? writeCacheSafely(ports, key, "lens", answer) : undefined;
    return { shared: answer, own: { lensFromCache: false, result, answer }, written };
  });
  return "own" in step ? step.own : { lensFromCache: true, answer: step.shared };
}

// ---- Requête des boutiques ----

const GOOGLE_OPERATORS = new Set(["OR", "AND"]);
/** Tiret ailleurs qu'entre deux lettres ou chiffres (« t-shirt », « X-200 »
 * gardés) : l'exclusion de Google (« -mot »), même cachée derrière ' . & +
 * (« '-mot », « +-mot »). Même règle dans services/shoppingQueryAi.ts. */
const LOOSE_HYPHEN = /(?:^|[^\p{L}\p{M}\p{N}])-|-(?:$|[^\p{L}\p{M}\p{N}])/u;

/** Requête sûre pour Google Shopping : sanitizeQuery (caractères de contrôle
 * et chevrons retirés, 60 caractères au plus), puis les opérateurs de Google
 * retirés (« site:… » et tout mot avec deux-points, tout mot avec un tiret
 * hors d'un mot composé, « 10..20 », OR, AND, guillemets) et toute
 * ponctuation hors lettres, chiffres, espaces et ' - . & +. Vide : aucune
 * requête. */
export function sanitizeShoppingQuery(text: string): string {
  const kept: string[] = [];
  for (const raw of sanitizeQuery(text).replace(/’/g, "'").split(" ")) {
    if (raw.includes(":")) continue;
    const token = raw.replace(/[^\p{L}\p{M}\p{N}'\-.&+]/gu, "");
    if (token === "" || LOOSE_HYPHEN.test(token) || token.includes("..") || GOOGLE_OPERATORS.has(token) || !/[\p{L}\p{N}]/u.test(token)) continue;
    kept.push(token);
  }
  return kept.join(" ").slice(0, SEARCH_QUERY_MAX_LENGTH);
}

/** Nom de domaine d'une adresse, sans « www. » ; null si illisible. */
function siteOfUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Ce que l'IA reçoit : les titres et sites Lens, dans l'ordre de Google
 * (jamais celui des mots de la photo, qui ne partent nulle part). L'IA n'en
 * lit que les premiers (services/shoppingQueryAi.ts). */
function aiItems(lens: readonly VisualMatch[]): AiLensItem[] {
  return lens.map((match) => ({ title: match.productName, site: siteOfUrl(match.merchantUrl) }));
}

/** Type d'échec de l'IA, ou null pour une exception inattendue (issue « error »). */
function aiErrorKindOf(error: unknown): AiErrorKind | null {
  if (!(error instanceof Error) || error instanceof ProviderFailure) return null;
  const kind = (error as { kind?: unknown }).kind;
  if (typeof kind === "string" && (AI_ERROR_KINDS as readonly string[]).includes(kind)) return kind as AiErrorKind;
  return error.name === "AbortError" || error.name === "TimeoutError" ? "unavailable" : null;
}

// ---- Complément au lancement (source « ai ») ----

export interface ComplementInput {
  /** Propositions Lens gardées, dans l'ordre de Google (avant le tri par les
   * mots de la photo). Lues seulement : jamais modifiées ni réordonnées. */
  lens: readonly VisualMatch[];
  /** Panne technique de Lens : aucun complément. */
  lensFailed: boolean;
  /** Lens a été appelé pour cette photo (false : réponse du cache). */
  lensCalled: boolean;
  /** Recherches Google Shopping déjà envoyées pour cette photo (0 au lancement). */
  shoppingCalls: number;
  locale: SearchLocale;
  /** Budget depuis T0 (startDeadline(T0, VOIE_C_BUDGET.totalMs)). */
  deadline: Deadline;
  /** voieCAiEnabled() : interrupteur de l'IA allumé et clé présente. */
  aiEnabled: boolean;
}

/** Colonnes de product_searches que le complément connaît (la route y ajoute
 * lens_from_cache, served_from_cache et total_seconds). `shopping_calls` :
 * le nouveau total pour cette photo (un refus non facturé dont la place a
 * été rendue n'y compte pas). */
export interface ComplementColumns {
  complement_status: ComplementStatus | null;
  shopping_calls: number;
  text_suggested: boolean;
}

export interface ComplementResult {
  /** Propositions « Cette pièce dans d'autres boutiques » (origine « shopping »),
   * 20 au plus, rangs 1..n (la route les range après le dernier rang Lens). */
  matches: ShoppingMatch[];
  columns: ComplementColumns;
  /** Pour la réponse du lancement, ou de POST /api/searches/:id/complement
   * (la requête n'y figure que là). */
  reply: SearchComplement;
  /** Pour la ligne « Mesure complément » (complementLogLine), écrite après l'enregistrement. */
  measure: ComplementMeasure;
}

export function emptyComplementMeasure(source: ComplementMeasure["source"]): ComplementMeasure {
  return {
    source,
    status: null,
    queryFromCache: false,
    shoppingFromCache: false,
    calls: 0,
    aiMs: null,
    shoppingMs: null,
    received: null,
    kept: null,
    keptWithPrice: null,
    tier0: null,
    tier1: null,
    googleLinks: null,
    inputTokens: null,
    outputTokens: null,
    aiErrorKind: null,
    noQueryReason: null,
    shoppingFailureKind: null,
  };
}

interface RunState {
  measure: ComplementMeasure;
  /** Requête envoyée (ou lue dans le cache) : seulement pour la réponse. */
  query: string | null;
  /** L'appel aux boutiques a été refusé sans être facturé, et sa place
   * rendue : envoyé (measure.calls), mais jamais compté dans shopping_calls. */
  refusalReleased: boolean;
}

function finish(state: RunState, input: ComplementInput, status: ComplementStatus | null, matches: ShoppingMatch[], suggestText: boolean): ComplementResult {
  const showsQuery = state.query !== null && (status === "shown" || status === "empty");
  return {
    matches,
    columns: { complement_status: status, shopping_calls: input.shoppingCalls + state.measure.calls - (state.refusalReleased ? 1 : 0), text_suggested: suggestText },
    reply: { status, ...(showsQuery ? { query: state.query! } : {}), suggestText, textStatus: null },
    measure: { ...state.measure, status },
  };
}

/** Assez de temps pour une lecture du cache (800 ms) sans entamer l'enregistrement. */
function canReadCache(deadline: Deadline): boolean {
  return deadline.remainingMs() >= VOIE_C_BUDGET.saveReserveMs + VOIE_C_BUDGET.cacheReadMs;
}

// L'IA ne part que s'il reste de quoi faire l'IA (1 s), Google Shopping
// (2,5 s) et l'enregistrement (1,5 s) ; Google Shopping, s'il reste de quoi le
// faire et enregistrer.
const AI_GATE_MS = VOIE_C_BUDGET.saveReserveMs + VOIE_C_BUDGET.aiMinMs + VOIE_C_BUDGET.shoppingMinMs;
const SHOPPING_GATE_MS = VOIE_C_BUDGET.saveReserveMs + VOIE_C_BUDGET.shoppingMinMs;

type QueryOutcome = { kind: "query"; query: string; brand: string; model: string } | { kind: "stop"; status: ComplementStatus | null; suggestText: boolean };

/** Résultat propre au lancement qui a fait l'étape b-c : la réponse (lue dans
 * le cache, ou écrite par l'IA), ou l'arrêt et pourquoi. */
type QueryOwn = { kind: "answer"; answer: QueryCachePayload; fromCache: boolean } | { kind: "stop"; outcome: QueryOutcome };

/** Étapes b et c : le cache de la requête d'abord (sans IA ni garde de
 * dépense), sinon le temps, les gardes de dépense, puis l'IA. Un seul appel
 * à la fois pour les mêmes titres (sharedStep, comme Lens et les boutiques) :
 * un lancement arrivé pendant l'appel de l'IA, ou avant l'écriture de sa
 * réponse dans le cache, reçoit la même réponse, donc la même requête et la
 * même recherche dans les boutiques, au lieu d'une seconde réponse peut-être
 * formulée autrement (une seconde recherche payée). Son attente ne dépasse
 * jamais son propre budget (« late » : no_time). */
async function queryStep(ports: ComplementPorts, input: ComplementInput, state: RunState): Promise<QueryOutcome> {
  if (!canReadCache(input.deadline)) return { kind: "stop", status: "no_time", suggestText: false };
  const items = aiItems(input.lens);
  const key = ports.aiInputKey(items, input.locale);
  const stop = (status: ComplementStatus | null): Leg<QueryCachePayload, QueryOwn> => ({ shared: null, own: { kind: "stop", outcome: { kind: "stop", status, suggestText: false } } });
  const step = await sharedStep<QueryCachePayload, QueryOwn>(
    ports,
    key,
    async () => {
      // Revérifié ici : après l'attente d'un autre lancement sans réponse
      // partageable, la reprise ne lit le cache que s'il en reste le temps.
      if (!canReadCache(input.deadline)) return stop("no_time");
      const cached = await readCacheSafely(ports, key, QUERY_CACHE_PAYLOAD);
      if (cached) return { shared: cached, own: { kind: "answer", answer: cached, fromCache: true } };
      if (input.deadline.remainingMs() < AI_GATE_MS) return stop("no_time");
      // Gardes de dépense : lecture seule du plafond, puis limite commune de
      // l'IA. Atteints : l'IA est sautée, jamais de 429.
      const capacity = await ports.capacityLeft().catch(() => false);
      if (!capacity) return stop("no_capacity");
      const timeout = input.deadline.stepTimeoutMs(VOIE_C_BUDGET.aiMaxMs, VOIE_C_BUDGET.saveReserveMs + VOIE_C_BUDGET.shoppingMinMs);
      if (timeout === null || timeout < VOIE_C_BUDGET.aiMinMs) return stop("no_time");
      if (ports.socketDestroyed()) return stop(null);
      if (!(await ports.consumeAiLimit())) return stop("no_capacity");
      // Le compteur est lu dans la base (lot garde-fous) : le délai de l'IA
      // est recalculé après lui. Plus assez de temps : aucun appel (jamais un
      // appel coupé d'avance, qui serait compté comme un échec de l'IA).
      const aiTimeout = input.deadline.stepTimeoutMs(VOIE_C_BUDGET.aiMaxMs, VOIE_C_BUDGET.saveReserveMs + VOIE_C_BUDGET.shoppingMinMs);
      if (aiTimeout === null || aiTimeout < VOIE_C_BUDGET.aiMinMs) return stop("no_time");

      const started = ports.now();
      let result: ShoppingQueryAnswer;
      try {
        result = await ports.askQuery(items, input.locale, signalAfter(ports, aiTimeout));
      } catch (error) {
        state.measure.aiMs = ports.now() - started;
        const kind = aiErrorKindOf(error);
        if (kind === null) throw error;
        state.measure.aiErrorKind = kind;
        return stop("ai_failed");
      }
      state.measure.aiMs = ports.now() - started;
      state.measure.inputTokens = result.usage.inputTokens;
      state.measure.outputTokens = result.usage.outputTokens;
      const answer: QueryCachePayload =
        result.kind === "query"
          ? { query: result.value.query, brand: result.value.brand, model: result.value.model }
          : { no_query: true, reason: result.reason };
      // Requêtes vérifiées ET absences de requête sont gardées (24 h), et
      // partagées ; une réponse que le cache refuserait ne l'est pas.
      if (!QUERY_CACHE_PAYLOAD.safeParse(answer).success) return { shared: null, own: { kind: "answer", answer, fromCache: false } };
      const written = writeCacheSafely(ports, key, "query", answer);
      return { shared: answer, own: { kind: "answer", answer, fromCache: false }, written };
    },
    // Attente bornée : jamais pour une réponse que ce lancement ne pourrait plus
    // utiliser (il lui faut encore de quoi lire le cache et enregistrer).
    () => input.deadline.remainingMs() - (VOIE_C_BUDGET.saveReserveMs + VOIE_C_BUDGET.cacheReadMs)
  );

  let answer: QueryCachePayload;
  if ("late" in step) return { kind: "stop", status: "no_time", suggestText: false };
  if ("shared" in step) {
    state.measure.queryFromCache = true;
    answer = step.shared;
  } else if (step.own.kind === "stop") {
    return step.own.outcome;
  } else {
    if (step.own.fromCache) state.measure.queryFromCache = true;
    answer = step.own.answer;
  }

  if ("no_query" in answer) {
    state.measure.noQueryReason = answer.reason;
    return { kind: "stop", status: "no_query", suggestText: true };
  }
  const query = sanitizeShoppingQuery(answer.query);
  if (query === "") {
    state.measure.noQueryReason = "operators";
    return { kind: "stop", status: "no_query", suggestText: true };
  }
  return { kind: "query", query, brand: answer.brand, model: answer.model };
}

type ShoppingCall = { kind: "answered"; filtered: ShoppingFiltered } | { kind: "cached"; filtered: ShoppingFiltered } | { kind: "stop"; status: ComplementStatus | null };

/** Étape d : le cache d'abord, sinon le temps, le budget de la photo, la
 * réservation, puis UN appel à Google Shopping. L'appel identique d'un autre
 * lancement, s'il est en cours, est attendu (jamais au-delà de T0 + 14 s −
 * 1,5 s : sinon « no_time », sans appel). */
async function shoppingStep(ports: ComplementPorts, input: ComplementInput, state: RunState, query: string): Promise<ShoppingCall> {
  if (!canReadCache(input.deadline)) return { kind: "stop", status: "no_time" };
  const key = ports.cacheKey("shopping", shoppingCacheParts(query, input.locale));
  const step = await sharedStep(
    ports,
    key,
    async (): Promise<Leg<ShoppingFiltered, ShoppingCall>> => {
      // Reprise après l'appel d'un autre lancement (sans réponse partageable) : le temps est revu.
      if (!canReadCache(input.deadline)) return { shared: null, own: { kind: "stop", status: "no_time" } };
      const cached = await readCacheSafely(ports, key, SHOPPING_CACHE_PAYLOAD);
      if (cached) return { shared: cached, own: { kind: "cached", filtered: cached } };
      const own = await callShoppingOnce(ports, input, state, query);
      if (own.kind !== "answered") return { shared: null, own };
      // Réponse facturée (vide comprise) : gardée 24 h.
      const written = writeCacheSafely(ports, key, "shopping", own.filtered);
      return { shared: own.filtered, own, written };
    },
    () => input.deadline.remainingMs() - VOIE_C_BUDGET.saveReserveMs
  );
  if ("late" in step) return { kind: "stop", status: "no_time" };
  return "own" in step ? step.own : { kind: "cached", filtered: step.shared };
}

async function callShoppingOnce(ports: ComplementPorts, input: ComplementInput, state: RunState, query: string): Promise<ShoppingCall> {
  if (ports.socketDestroyed()) return { kind: "stop", status: null };
  if (input.deadline.remainingMs() < SHOPPING_GATE_MS) return { kind: "stop", status: "no_time" };
  // Budget de la photo, garanti par la ligne (jamais par le cache).
  if (photoCallsLeft(input.lensCalled, input.shoppingCalls + state.measure.calls) < 1) return { kind: "stop", status: "no_capacity" };
  const reservation = await ports.reserve().catch(() => null);
  if (!reservation || !reservation.allowed) return { kind: "stop", status: "no_capacity" };
  const timeout = input.deadline.stepTimeoutMs(VOIE_C_BUDGET.shoppingMaxMs, VOIE_C_BUDGET.saveReserveMs);
  if (timeout === null || timeout < VOIE_C_BUDGET.shoppingMinMs) {
    // Plus le temps : aucun appel envoyé, la place est rendue.
    await ports.release(reservation.reservationId).catch(() => false);
    return { kind: "stop", status: "no_time" };
  }

  state.measure.calls += 1;
  const started = ports.now();
  try {
    const response = await ports.searchText(query, input.locale, signalAfter(ports, timeout));
    state.measure.shoppingMs = ports.now() - started;
    return { kind: "answered", filtered: filterShoppingItems(response, input.locale.country) };
  } catch (error) {
    state.measure.shoppingMs = ports.now() - started;
    if (!(error instanceof ProviderFailure)) throw error;
    state.measure.shoppingFailureKind = error.kind;
    // Refus non facturé : la place est rendue, une fois, et l'appel ne compte
    // pas dans le budget de la photo (sauf si la place n'a pas pu être rendue).
    // Délai dépassé ou erreur incertaine : l'appel reste compté.
    if (error.kind === "refused") state.refusalReleased = await ports.release(reservation.reservationId).catch(() => false);
    return { kind: "stop", status: "shopping_failed" };
  }
}

/** Boutiques ensuite : le complément aura-t-il besoin d'un appel (cache, IA
 * ou Google Shopping) ? Faux : runComplement répond tout de suite, sans aucun
 * port (Lens en panne, aucune proposition Lens, IA coupée) ; le lancement
 * enregistre alors l'issue lui-même, comme avant. Mêmes conditions que
 * l'étape a de runComplement (tests/voieC.test.ts le vérifie). */
export function complementNeedsCalls(input: Pick<ComplementInput, "lens" | "lensFailed" | "aiEnabled">): boolean {
  return !input.lensFailed && input.lens.length > 0 && input.aiEnabled;
}

/** Le complément d'un lancement (source « ai ») : requête écrite par l'IA à
 * partir des titres Lens, puis Google Shopping, filtres, tri léger, 20 au
 * plus. Ne lève jamais d'erreur ; toute issue autre que « shown » laisse les
 * résultats Lens seuls. */
export async function runComplement(ports: ComplementPorts, input: ComplementInput): Promise<ComplementResult> {
  const state: RunState = { measure: emptyComplementMeasure("ai"), query: null, refusalReleased: false };
  try {
    // a. Sorties sans IA. Lens sans résultat : « Que cherchez-vous ? » est
    // proposé, même IA coupée (la voie B n'a pas besoin de l'IA).
    if (input.lensFailed || ports.socketDestroyed()) return finish(state, input, null, [], false);
    if (input.lens.length === 0) return finish(state, input, "no_query", [], true);
    if (!input.aiEnabled) return finish(state, input, "skipped", [], false);

    // b, c. La requête.
    const query = await queryStep(ports, input, state);
    if (query.kind === "stop") return finish(state, input, query.status, [], query.suggestText);
    state.query = query.query;

    // d. Google Shopping.
    const shopping = await shoppingStep(ports, input, state, query.query);
    if (shopping.kind === "stop") return finish(state, input, shopping.status, [], false);
    if (shopping.kind === "cached") state.measure.shoppingFromCache = true;

    // e. Pages déjà proposées par Lens, tri léger par marque et modèle, puis 20 au plus.
    const reference = { brand: query.brand, model: query.model };
    const fresh = withoutKnownPages(shopping.filtered.matches, input.lens).matches;
    const sorted = ports.sortShopping(fresh, reference);
    const shown = keepShown(sorted.items, shopping.filtered);
    Object.assign(state.measure, {
      received: shown.measure.received,
      kept: shown.measure.kept,
      keptWithPrice: shown.measure.keptWithPrice,
      googleLinks: shown.measure.googleLinks,
      tier0: sorted.tierCounts[0] ?? 0,
      tier1: sorted.tierCounts[1] ?? 0,
    });

    // f. Issue, et « Que cherchez-vous ? » quand rien n'est fiable : aucune
    // pièce, Lens ou boutiques, avec la marque ET le modèle dans son titre.
    if (shown.matches.length === 0) return finish(state, input, "empty", [], true);
    const lensTier0 = ports.sortShopping([...input.lens], reference).tierCounts[0] ?? 0;
    const reliable = (state.measure.tier0 ?? 0) > 0 || lensTier0 > 0;
    return finish(state, input, "shown", shown.matches, !reliable);
  } catch (error) {
    // g. Exception inattendue : « error » (distincte de « skipped »), journalisée sans contenu.
    ports.log.error({ step: "complement", errorName: errorName(error) }, "Complément de la voie C : exception inattendue, résultats Lens seuls");
    return finish(state, input, "error", [], false);
  }
}

/** Les lignes du complément n'ont pas pu être enregistrées : issue
 * « shopping_failed », aucune proposition, les résultats Lens restent. */
export function complementAfterSaveFailure(result: ComplementResult): ComplementResult {
  return {
    matches: [],
    columns: { ...result.columns, complement_status: "shopping_failed", text_suggested: false },
    reply: { status: "shopping_failed", suggestText: false, textStatus: null },
    measure: { ...result.measure, status: "shopping_failed", kept: 0, keptWithPrice: 0 },
  };
}

/** Colonnes de la voie C à l'enregistrement du lancement (écrites seulement
 * quand elle a tourné). served_from_cache : aucune recherche réelle comptée
 * dans ce lancement (Lens venu du cache, et aucun appel aux boutiques compté :
 * un refus non facturé dont la place a été rendue ne compte pas) : hors de la
 * part de 8 par personne. `totalMs` : depuis T0, enregistrement compris. */
export function launchColumns(lensFromCache: boolean, complement: ComplementResult, totalMs: number) {
  return {
    ...complement.columns,
    lens_from_cache: lensFromCache,
    served_from_cache: lensFromCache && complement.columns.shopping_calls === 0,
    total_seconds: totalSeconds(totalMs),
  };
}

// ---- « Que cherchez-vous ? » (source « words », voie B) ----

export interface TextComplementPorts {
  searchText(query: string, locale: SearchLocale, signal: AbortSignal): Promise<TextSearchResponse>;
  release(reservationId: number): Promise<boolean>;
  now(): number;
  log: VoieCLog;
  timeoutSignal?(ms: number): AbortSignal;
}

export interface TextComplementInput {
  /** Vos mots, déjà passés par sanitizeShoppingQuery (non vides). */
  words: string;
  /** Propositions déjà rangées (Lens, boutiques) : leurs pages ne reviennent pas. */
  existing: readonly { merchantUrl: string }[];
  locale: SearchLocale;
  /** Budget depuis le début de la requête (startDeadline(T0, VOIE_C_BUDGET.totalMs)). */
  deadline: Deadline;
  /** Place réservée par la route (étape « shopping »), rendue ici si l'appel n'est pas facturé. */
  reservationId: number;
}

export interface TextComplementResult {
  /** Propositions « Résultats pour vos mots » (origine « words »), 20 au plus, rangs 1..n. */
  matches: ShoppingMatch[];
  textStatus: TextSearchStatus;
  /** Recherches à ajouter à shopping_calls (0 ou 1) : celle envoyée, sauf un
   * refus non facturé dont la place a été rendue (la mesure, elle, la garde). */
  calls: number;
  measure: ComplementMeasure;
}

/** La recherche avec vos mots : UN appel à Google Shopping, mêmes filtres et
 * mêmes devises, pages déjà proposées retirées, tri par vos mots, 20 au plus.
 * Pas de règle « Lens vide », pas d'IA, pas de cache. Ne lève jamais d'erreur. */
export async function runTextComplement(ports: TextComplementPorts, input: TextComplementInput): Promise<TextComplementResult> {
  const measure = emptyComplementMeasure("words");
  // Faux seulement pour un refus non facturé dont la place a été rendue.
  let counted = true;
  const done = (textStatus: TextSearchStatus, matches: ShoppingMatch[]): TextComplementResult => ({
    matches,
    textStatus,
    calls: counted ? measure.calls : 0,
    measure: { ...measure, status: textStatus },
  });
  try {
    const timeout = input.deadline.stepTimeoutMs(VOIE_C_BUDGET.textShoppingMaxMs, VOIE_C_BUDGET.saveReserveMs);
    if (timeout === null) {
      await ports.release(input.reservationId).catch(() => false);
      return done("shopping_failed", []);
    }
    measure.calls = 1;
    const started = ports.now();
    let response: TextSearchResponse;
    try {
      response = await ports.searchText(input.words, input.locale, signalAfter(ports, timeout));
    } catch (error) {
      measure.shoppingMs = ports.now() - started;
      if (!(error instanceof ProviderFailure)) throw error;
      measure.shoppingFailureKind = error.kind;
      // Refus non facturé : la place est rendue, et l'appel ne compte pas
      // dans le budget de la photo (sauf si la place n'a pas pu être rendue).
      if (error.kind === "refused") counted = !(await ports.release(input.reservationId).catch(() => false));
      return done("shopping_failed", []);
    }
    measure.shoppingMs = ports.now() - started;
    const filtered = filterShoppingItems(response, input.locale.country);
    const fresh = withoutKnownPages(filtered.matches, input.existing).matches;
    const shown = keepShown(sortByWords(fresh, input.words).matches, filtered);
    Object.assign(measure, {
      received: shown.measure.received,
      kept: shown.measure.kept,
      keptWithPrice: shown.measure.keptWithPrice,
      googleLinks: shown.measure.googleLinks,
    });
    return done(shown.matches.length > 0 ? "shown" : "empty", shown.matches);
  } catch (error) {
    ports.log.error({ step: "text_complement", errorName: errorName(error) }, "Recherche avec vos mots : exception inattendue");
    return done("shopping_failed", []);
  }
}

// ---- Schéma de la base (migration 0028) ----

/** Sonde refaite au plus toutes les 5 minutes tant que 0028 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;
const SEARCH_COLUMNS_0028 = "complement_status, shopping_calls, lens_from_cache, served_from_cache, text_suggested, text_requested_at, text_status, total_seconds";
const CACHE_COLUMNS_0028 = "key, step, payload, created_at, expires_at";

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

async function probeSchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  try {
    const db = fastify.supabaseAdmin;
    const checks = await Promise.all([
      db.from("product_searches").select(SEARCH_COLUMNS_0028).limit(0),
      db.from("product_matches").select("origin").limit(0),
      db.from("search_cache").select(CACHE_COLUMNS_0028).limit(0),
    ]);
    const failed = checks.find((check) => check.error);
    if (!failed) return true;
    fastify.log.error({ code: failed.error?.code ?? null }, "Voie C coupée : migration 0028 absente ou incomplète, résultats Lens seuls");
  } catch {
    fastify.log.error({ code: null }, "Voie C coupée : schéma illisible, résultats Lens seuls");
  }
  return false;
}

/** La base a-t-elle la migration 0028 ? Mémorisé une fois vu ; absent, un
 * journal d'erreur puis Lens seul, et la sonde n'est refaite qu'au bout de
 * 5 minutes. */
export async function voieCSchemaReady(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<boolean> {
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
export function resetVoieCSchemaProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}

/** Voie C en service pour ce lancement : interrupteur allumé ET 0028 vue.
 * Interrupteur coupé : aucune sonde, aucun accès à la base. */
export async function voieCActive(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  return voieCEnabled() && (await voieCSchemaReady(fastify));
}
