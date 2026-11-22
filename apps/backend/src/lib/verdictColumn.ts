// Le verdict (lot « verdict », migration 0055) : le palier du titre de
// chaque proposition de « Cette pièce dans d'autres boutiques »
// (lib/lightSort.ts, verdictTier), noté au moment où il est calculé
// (lib/voieC.ts), est rangé sur sa ligne (product_matches.title_tier). Il
// n'est écrit qu'une fois la colonne vue par cette sonde : sans 0055, rien
// n'est noté, l'insertion n'est jamais refusée, et la relecture ne calcule
// aucun verdict (lib/verdict.ts ; comportement d'avant). Même sonde que pour 0054
// (lib/brandShopColumn.ts) et 0056 (lib/stockColumn.ts). Si l'insertion avec
// le palier est refusée malgré la sonde (colonne retirée depuis, cache du
// schéma), routes/searches.ts la refait une fois sans lui : les boutiques
// sont toujours rangées.
import type { FastifyInstance } from "fastify";

/** Sonde refaite au plus toutes les 5 minutes tant que 0055 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

async function probeSchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  try {
    const { error } = await fastify.supabaseAdmin.from("product_matches").select("title_tier").limit(0);
    if (!error) return true;
    fastify.log.warn({ code: error.code ?? null }, "Verdict non noté : migration 0055 absente, aucun verdict n'est montré");
  } catch {
    fastify.log.warn({ code: null }, "Verdict non noté : schéma illisible, aucun verdict n'est montré");
  }
  return false;
}

/** La base a-t-elle la migration 0055 ? Mémorisé une fois vu ; absent, un
 * avertissement, puis la sonde n'est refaite qu'au bout de 5 minutes. */
export async function verdictColumnReady(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<boolean> {
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
export function resetVerdictColumnProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}
