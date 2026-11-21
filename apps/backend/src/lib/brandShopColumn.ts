// Ordre des boutiques (décision du fondateur, 21 novembre 2026, migration
// 0054) : dans « Cette pièce dans d'autres boutiques », la ligne de la
// boutique officielle de la marque de la pièce, reconnue au moment où la
// section est cherchée (lib/voieC.ts), porte un oui
// (product_matches.brand_shop) ; seule elle passe en tête de la section à la
// relecture (lib/shopTrust.ts, sectionOrder). Ce oui n'est écrit qu'une fois
// la colonne vue par cette sonde : sans 0054, rien n'est noté, l'insertion
// n'est jamais refusée, et chaque boutique officielle garde sa place reçue,
// avec sa mention (aucune marque en avant). Même sonde que pour 0028 et 0031.
import type { FastifyInstance } from "fastify";

/** Sonde refaite au plus toutes les 5 minutes tant que 0054 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

async function probeSchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  try {
    const { error } = await fastify.supabaseAdmin.from("product_matches").select("brand_shop").limit(0);
    if (!error) return true;
    fastify.log.warn({ code: error.code ?? null }, "Boutique de la marque non notée : migration 0054 absente, chaque boutique officielle garde sa place reçue");
  } catch {
    fastify.log.warn({ code: null }, "Boutique de la marque non notée : schéma illisible, chaque boutique officielle garde sa place reçue");
  }
  return false;
}

/** La base a-t-elle la migration 0054 ? Mémorisé une fois vu ; absent, un
 * avertissement, puis la sonde n'est refaite qu'au bout de 5 minutes. */
export async function brandShopColumnReady(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<boolean> {
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
export function resetBrandShopColumnProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}
