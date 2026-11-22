// Stock affiché (lot « stock visible », migration 0056) : quand Google Lens
// dit qu'une offre est en stock ou épuisée (services/visualSearch.ts,
// inStock), ce oui ou ce non est rangé sur sa ligne (product_matches.in_stock)
// et renvoyé à l'app avec la proposition. Il n'est écrit qu'une fois la
// colonne vue par cette sonde : sans 0056, rien n'est noté, l'insertion n'est
// jamais refusée, et aucune carte ne montre de stock (comportement d'avant).
// Même sonde que pour 0054 (lib/brandShopColumn.ts). Si l'insertion avec le
// stock est refusée malgré la sonde (colonne retirée depuis, cache du
// schéma), routes/searches.ts la refait sans le stock : les propositions sont
// toujours rangées.
import type { FastifyInstance } from "fastify";

/** Sonde refaite au plus toutes les 5 minutes tant que 0056 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

async function probeSchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  try {
    const { error } = await fastify.supabaseAdmin.from("product_matches").select("in_stock").limit(0);
    if (!error) return true;
    fastify.log.warn({ code: error.code ?? null }, "Stock non noté : migration 0056 absente, aucune carte ne montre de stock");
  } catch {
    fastify.log.warn({ code: null }, "Stock non noté : schéma illisible, aucune carte ne montre de stock");
  }
  return false;
}

/** La base a-t-elle la migration 0056 ? Mémorisé une fois vu ; absent, un
 * avertissement, puis la sonde n'est refaite qu'au bout de 5 minutes. */
export async function stockColumnReady(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<boolean> {
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
export function resetStockColumnProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}
