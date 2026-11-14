// Essayage virtuel : la purge des données de plus de 12 mois (fonction
// tryon_purge, migration 0042 : essais, signalements, alertes, essais
// offerts expirés), QUEL QUE SOIT l'interrupteur de l'essayage : la durée
// promise au membre (12 mois) tient même quand plus rien n'y écrit,
// fonction éteinte après usage comprise. Lancée au passage par la route des
// recherches (routes/searches.ts), à côté des autres purges ; la base la
// refait aussi à chaque réservation d'un essai, et pnpm tryon:purge à la
// demande. Sans 0042 : rien. Ne lève jamais d'erreur ; le journal ne garde
// que le code de la base.
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { tryonSchemaReady } from "./schema.js";

/** Durée de conservation des données de l'essayage, en mois. */
export const TRYON_RETENTION_MONTHS = 12;

export async function purgeTryonHistory(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, log: FastifyBaseLogger): Promise<void> {
  try {
    if (!(await tryonSchemaReady(fastify))) return;
    const { error } = await fastify.supabaseAdmin.rpc("tryon_purge", { p_months: TRYON_RETENTION_MONTHS });
    if (error) log.warn({ code: error.code ?? null }, "Essayage virtuel : purge impossible");
  } catch {
    log.warn({ code: null }, "Essayage virtuel : purge impossible");
  }
}
