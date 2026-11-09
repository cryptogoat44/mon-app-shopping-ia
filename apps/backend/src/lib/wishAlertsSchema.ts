// Alertes prix et stock (lot 2) : la base a-t-elle la migration 0036 ? Même
// sonde que pour les messages, les collections et les notifications
// (lib/push.ts) : mémorisée une fois vue ; absente, un avertissement, puis la
// sonde n'est refaite qu'au bout de 5 minutes. Sans 0036, chaque chemin des
// alertes se tait : rien n'est enregistré ni envoyé, les notifications des
// messages restent exactement celles d'avant, et l'app cache la cloche,
// l'interrupteur et « Plus disponible » (GET /api/alerts/status).
// La sonde appelle la fonction wish_alerts_version (seul le serveur peut
// l'appeler) : une base sans 0036, ou une fausse base de test qui ne la
// connaît pas, répond « absente ».
import type { FastifyInstance } from "fastify";

/** Sonde refaite au plus toutes les 5 minutes tant que 0036 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

async function probeSchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  try {
    const { data, error } = await fastify.supabaseAdmin.rpc("wish_alerts_version");
    if (!error && typeof data === "number" && data >= 1) return true;
    fastify.log.warn({ code: error?.code ?? null }, "Alertes prix coupées : migration 0036 absente");
  } catch {
    fastify.log.warn({ code: null }, "Alertes prix coupées : schéma illisible");
  }
  return false;
}

export async function wishAlertsReady(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<boolean> {
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
export function resetWishAlertsProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}
