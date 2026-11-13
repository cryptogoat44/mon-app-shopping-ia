// Alertes prix et stock (lot 2) : la base a-t-elle la migration 0036, ses
// garde-fous (0040) et leur nouvelle version (0041) ? Même sonde que pour les messages, les collections
// et les notifications (lib/push.ts) : mémorisée une fois vue ; absente, un
// avertissement, puis la sonde n'est refaite qu'au bout de 5 minutes.
// La sonde appelle la fonction wish_alerts_version (seul le serveur peut
// l'appeler) : 1 avec 0036 seule, 2 avec 0040, 3 avec 0041. Une base sans 0036, ou une
// fausse base de test qui ne la connaît pas, répond « absente » (fonction
// inconnue : PGRST202 ou 42883). Toute autre erreur (panne, délai dépassé) ne
// dit RIEN de la migration : « inconnue », jamais mémorisée comme « absente »
// — les chemins qui en dépendent pour respecter un choix de la personne
// (notifications des messages coupées, lib/push.ts) refusent alors d'agir au
// lieu de faire comme avant 0036 ; la sonde est refaite au bout de 30 secondes.
//
// Deux questions, deux réponses :
// - wishAlertsSchemaState : les tables et colonnes de 0036 sont-elles là ?
//   (ce que reçoit chaque appareil, lib/push.ts ; l'export des données) ;
// - wishAlertsReady : les alertes peuvent-elles marcher ? Seulement avec
//   0041 (nouvelle version : seuil choisi par le membre, rupture établie par
//   trois membres d'affilée, « Aider les autres membres », jours seulement).
//   Avec 0036 ou 0040 SANS 0041, les alertes sont coupées exactement comme
//   sans 0036 (rien n'est suivi, observé, signalé ni envoyé ; l'app cache la
//   cloche, les réglages et « Plus disponible »), et le journal le dit
//   (« version 0041 absente ») ; la sonde est refaite toutes les 5 minutes,
//   pour voir 0041 dès qu'elle est appliquée ;
// - wishAlertsSchemaVersion : la version vue (1, 2 ou 3), pour l'export des
//   données (ses colonnes changent avec 0040 puis 0041).
import type { FastifyInstance } from "fastify";

/** Sonde refaite au plus toutes les 5 minutes tant que 0036, ou 0040, manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;
/** Sonde refaite au plus toutes les 30 secondes après une réponse illisible. */
const SCHEMA_UNKNOWN_RETRY_MS = 30_000;
/** Codes d'une fonction inconnue de la base (PostgREST, puis Postgres). */
const FUNCTION_MISSING_CODES = new Set(["PGRST202", "42883"]);

/** Présente, absente (base sans 0036), ou inconnue (la base n'a pas répondu). */
export type WishAlertsSchemaState = "ready" | "absent" | "unknown";

/** Version de wish_alerts_version avec laquelle les alertes marchent
 * (migration 0041 : nouvelle version des alertes). */
export const WISH_ALERTS_GUARDED_VERSION = 3;

/** Ce que dit la sonde : l'état de 0036, sa version (0 : inconnue), et si
 * la version attendue (0041) est là. */
interface Probe {
  state: WishAlertsSchemaState;
  guarded: boolean;
  version: number;
}

let schemaReadyAt: number | null = null;
let schemaGuarded = false;
let schemaVersion = 0;
let schemaMissingAt: number | null = null;
let schemaUnknownAt: number | null = null;
let schemaProbe: Promise<Probe> | null = null;

async function probeSchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<Probe> {
  try {
    const { data, error } = await fastify.supabaseAdmin.rpc("wish_alerts_version");
    if (!error && typeof data === "number" && Number.isInteger(data) && data >= 1) {
      const guarded = data >= WISH_ALERTS_GUARDED_VERSION;
      if (!guarded) fastify.log.warn({ version: data }, "Alertes prix coupées : version de la migration 0041 absente (0036 ou 0040 seule)");
      return { state: "ready", guarded, version: data };
    }
    if (error && FUNCTION_MISSING_CODES.has(error.code ?? "")) {
      fastify.log.warn({ code: error.code ?? null }, "Alertes prix coupées : migration 0036 absente");
      return { state: "absent", guarded: false, version: 0 };
    }
    fastify.log.warn({ code: error?.code ?? null }, "Alertes prix : schéma inconnu (réponse illisible)");
  } catch {
    fastify.log.warn({ code: null }, "Alertes prix : schéma inconnu (base injoignable)");
  }
  return { state: "unknown", guarded: false, version: 0 };
}

async function probe(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number): Promise<Probe> {
  // Version attendue vue : mémorisé pour toujours. Une version plus ancienne :
  // la sonde est refaite au bout de 5 minutes (0041 a pu être appliquée entre-temps).
  if (schemaReadyAt !== null && (schemaGuarded || now() - schemaReadyAt < SCHEMA_RETRY_MS)) return { state: "ready", guarded: schemaGuarded, version: schemaVersion };
  if (schemaMissingAt !== null && now() - schemaMissingAt < SCHEMA_RETRY_MS) return { state: "absent", guarded: false, version: 0 };
  if (schemaUnknownAt !== null && now() - schemaUnknownAt < SCHEMA_UNKNOWN_RETRY_MS) return { state: "unknown", guarded: false, version: 0 };
  schemaProbe ??= probeSchema(fastify)
    .then((seen) => {
      // 0036 déjà vue : une réponse illisible ne la fait pas oublier.
      if (seen.state === "unknown" && schemaReadyAt !== null) {
        schemaReadyAt = now();
        return { state: "ready" as const, guarded: schemaGuarded, version: schemaVersion };
      }
      schemaReadyAt = seen.state === "ready" ? now() : null;
      schemaGuarded = seen.guarded;
      schemaVersion = seen.version;
      schemaMissingAt = seen.state === "absent" ? now() : null;
      schemaUnknownAt = seen.state === "unknown" ? now() : null;
      return seen;
    })
    .finally(() => {
      schemaProbe = null;
    });
  return schemaProbe;
}

/** L'état de la migration 0036 (ses tables et colonnes), sondé au besoin
 * (présente : mémorisé ; absente : 5 minutes ; inconnue : 30 secondes). */
export async function wishAlertsSchemaState(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<WishAlertsSchemaState> {
  return (await probe(fastify, now)).state;
}

/** Les alertes peuvent-elles marcher ? Seulement avec 0036, 0040 ET 0041.
 * Absente, inconnue, ou une version plus ancienne : non, tout se tait. */
export async function wishAlertsReady(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<boolean> {
  const seen = await probe(fastify, now);
  return seen.state === "ready" && seen.guarded;
}

/** La version des alertes dans la base (1 : 0036, 2 : 0040, 3 : 0041), ou 0
 * si elle est absente ou inconnue. Pour l'export des données. */
export async function wishAlertsSchemaVersion(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<number> {
  const seen = await probe(fastify, now);
  return seen.state === "ready" ? seen.version : 0;
}

/** Tests seulement : oublie la sonde. */
export function resetWishAlertsProbe(): void {
  schemaReadyAt = null;
  schemaGuarded = false;
  schemaVersion = 0;
  schemaMissingAt = null;
  schemaUnknownAt = null;
  schemaProbe = null;
}
