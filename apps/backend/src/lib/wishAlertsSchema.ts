// Alertes prix et stock (lot 2) : la base a-t-elle la migration 0036, et
// ses garde-fous (0040) ? Même sonde que pour les messages, les collections
// et les notifications (lib/push.ts) : mémorisée une fois vue ; absente, un
// avertissement, puis la sonde n'est refaite qu'au bout de 5 minutes.
// La sonde appelle la fonction wish_alerts_version (seul le serveur peut
// l'appeler) : 1 avec 0036 seule, 2 avec 0040. Une base sans 0036, ou une
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
//   0040 (lot « durcissement des alertes », revue de sécurité). Avec 0036
//   SANS 0040, les alertes sont coupées exactement comme sans 0036 (rien
//   n'est suivi, observé, signalé ni envoyé ; l'app cache la cloche,
//   l'interrupteur et « Plus disponible »), et le journal le dit
//   (« garde-fous de 0040 absents ») ; la sonde est refaite toutes les
//   5 minutes, pour voir 0040 dès qu'elle est appliquée.
import type { FastifyInstance } from "fastify";

/** Sonde refaite au plus toutes les 5 minutes tant que 0036, ou 0040, manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;
/** Sonde refaite au plus toutes les 30 secondes après une réponse illisible. */
const SCHEMA_UNKNOWN_RETRY_MS = 30_000;
/** Codes d'une fonction inconnue de la base (PostgREST, puis Postgres). */
const FUNCTION_MISSING_CODES = new Set(["PGRST202", "42883"]);

/** Présente, absente (base sans 0036), ou inconnue (la base n'a pas répondu). */
export type WishAlertsSchemaState = "ready" | "absent" | "unknown";

/** Version de wish_alerts_version avec les garde-fous (migration 0040). */
export const WISH_ALERTS_GUARDED_VERSION = 2;

/** Ce que dit la sonde : l'état de 0036, et si les garde-fous (0040) sont là. */
interface Probe {
  state: WishAlertsSchemaState;
  guarded: boolean;
}

let schemaReadyAt: number | null = null;
let schemaGuarded = false;
let schemaMissingAt: number | null = null;
let schemaUnknownAt: number | null = null;
let schemaProbe: Promise<Probe> | null = null;

async function probeSchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<Probe> {
  try {
    const { data, error } = await fastify.supabaseAdmin.rpc("wish_alerts_version");
    if (!error && typeof data === "number" && data >= 1) {
      const guarded = data >= WISH_ALERTS_GUARDED_VERSION;
      if (!guarded) fastify.log.warn({ version: data }, "Alertes prix coupées : garde-fous de la migration 0040 absents (0036 seule)");
      return { state: "ready", guarded };
    }
    if (error && FUNCTION_MISSING_CODES.has(error.code ?? "")) {
      fastify.log.warn({ code: error.code ?? null }, "Alertes prix coupées : migration 0036 absente");
      return { state: "absent", guarded: false };
    }
    fastify.log.warn({ code: error?.code ?? null }, "Alertes prix : schéma inconnu (réponse illisible)");
  } catch {
    fastify.log.warn({ code: null }, "Alertes prix : schéma inconnu (base injoignable)");
  }
  return { state: "unknown", guarded: false };
}

async function probe(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number): Promise<Probe> {
  // Garde-fous vus : mémorisé pour toujours. 0036 seule : la sonde est
  // refaite au bout de 5 minutes (0040 a pu être appliquée entre-temps).
  if (schemaReadyAt !== null && (schemaGuarded || now() - schemaReadyAt < SCHEMA_RETRY_MS)) return { state: "ready", guarded: schemaGuarded };
  if (schemaMissingAt !== null && now() - schemaMissingAt < SCHEMA_RETRY_MS) return { state: "absent", guarded: false };
  if (schemaUnknownAt !== null && now() - schemaUnknownAt < SCHEMA_UNKNOWN_RETRY_MS) return { state: "unknown", guarded: false };
  schemaProbe ??= probeSchema(fastify)
    .then((seen) => {
      // 0036 déjà vue : une réponse illisible ne la fait pas oublier.
      if (seen.state === "unknown" && schemaReadyAt !== null) {
        schemaReadyAt = now();
        return { state: "ready" as const, guarded: schemaGuarded };
      }
      schemaReadyAt = seen.state === "ready" ? now() : null;
      schemaGuarded = seen.guarded;
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

/** Les alertes peuvent-elles marcher ? Seulement avec 0036 ET ses garde-fous
 * (0040). Absente, inconnue, ou 0036 sans 0040 : non, tout se tait. */
export async function wishAlertsReady(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<boolean> {
  const seen = await probe(fastify, now);
  return seen.state === "ready" && seen.guarded;
}

/** Tests seulement : oublie la sonde. */
export function resetWishAlertsProbe(): void {
  schemaReadyAt = null;
  schemaGuarded = false;
  schemaMissingAt = null;
  schemaUnknownAt = null;
  schemaProbe = null;
}
