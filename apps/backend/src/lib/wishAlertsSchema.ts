// Alertes prix et stock (lot 2) : la base a-t-elle la migration 0036 ? Même
// sonde que pour les messages, les collections et les notifications
// (lib/push.ts) : mémorisée une fois vue ; absente, un avertissement, puis la
// sonde n'est refaite qu'au bout de 5 minutes. Sans 0036, chaque chemin des
// alertes se tait : rien n'est enregistré ni envoyé, les notifications des
// messages restent exactement celles d'avant, et l'app cache la cloche,
// l'interrupteur et « Plus disponible » (GET /api/alerts/status).
// La sonde appelle la fonction wish_alerts_version (seul le serveur peut
// l'appeler) : une base sans 0036, ou une fausse base de test qui ne la
// connaît pas, répond « absente » (fonction inconnue : PGRST202 ou 42883).
// Toute autre erreur (panne, délai dépassé) ne dit RIEN de la migration :
// « inconnue », jamais mémorisée comme « absente » — les chemins qui en
// dépendent pour respecter un choix de la personne (notifications des
// messages coupées, lib/push.ts) refusent alors d'agir au lieu de faire comme
// avant 0036 ; la sonde est refaite au bout de 30 secondes.
import type { FastifyInstance } from "fastify";

/** Sonde refaite au plus toutes les 5 minutes tant que 0036 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;
/** Sonde refaite au plus toutes les 30 secondes après une réponse illisible. */
const SCHEMA_UNKNOWN_RETRY_MS = 30_000;
/** Codes d'une fonction inconnue de la base (PostgREST, puis Postgres). */
const FUNCTION_MISSING_CODES = new Set(["PGRST202", "42883"]);

/** Présente, absente (base sans 0036), ou inconnue (la base n'a pas répondu). */
export type WishAlertsSchemaState = "ready" | "absent" | "unknown";

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaUnknownAt: number | null = null;
let schemaProbe: Promise<WishAlertsSchemaState> | null = null;

async function probeSchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<WishAlertsSchemaState> {
  try {
    const { data, error } = await fastify.supabaseAdmin.rpc("wish_alerts_version");
    if (!error && typeof data === "number" && data >= 1) return "ready";
    if (error && FUNCTION_MISSING_CODES.has(error.code ?? "")) {
      fastify.log.warn({ code: error.code ?? null }, "Alertes prix coupées : migration 0036 absente");
      return "absent";
    }
    fastify.log.warn({ code: error?.code ?? null }, "Alertes prix : schéma inconnu (réponse illisible)");
  } catch {
    fastify.log.warn({ code: null }, "Alertes prix : schéma inconnu (base injoignable)");
  }
  return "unknown";
}

/** L'état de la migration 0036, sondé au besoin (présente : mémorisé pour
 * toujours ; absente : 5 minutes ; inconnue : 30 secondes). */
export async function wishAlertsSchemaState(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<WishAlertsSchemaState> {
  if (schemaReadyAt !== null) return "ready";
  if (schemaMissingAt !== null && now() - schemaMissingAt < SCHEMA_RETRY_MS) return "absent";
  if (schemaUnknownAt !== null && now() - schemaUnknownAt < SCHEMA_UNKNOWN_RETRY_MS) return "unknown";
  schemaProbe ??= probeSchema(fastify)
    .then((state) => {
      schemaReadyAt = state === "ready" ? now() : null;
      schemaMissingAt = state === "absent" ? now() : null;
      schemaUnknownAt = state === "unknown" ? now() : null;
      return state;
    })
    .finally(() => {
      schemaProbe = null;
    });
  return schemaProbe;
}

/** Les alertes sont-elles là ? (absente ou inconnue : non, tout se tait). */
export async function wishAlertsReady(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<boolean> {
  return (await wishAlertsSchemaState(fastify, now)) === "ready";
}

/** Tests seulement : oublie la sonde. */
export function resetWishAlertsProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaUnknownAt = null;
  schemaProbe = null;
}
