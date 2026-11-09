// Modération des collections (lot modération des collections, migration
// 0034 ; règle 1.2 d'Apple). Ici : la sonde du schéma, et qui peut signaler
// une collection. Le reste suit les autres contenus : signalement
// (routes/reports.ts), file de modération (lib/moderationQueue.ts), retrait
// de la copie d'une image (lib/imageRemoval.ts), masquage (fonctions de la
// base). Sans 0034 : « Signaler » est caché dans l'app, un signalement de
// collection reçoit « indisponible », et les collections marchent comme
// avant. Le nom d'une collection n'est jamais écrit au journal.
import type { FastifyInstance } from "fastify";
import { collectionsReady, readVisibleCollection } from "./collections.js";

export const COLLECTION_MODERATION_UNAVAILABLE = {
  error: "collection_moderation_unavailable",
  message: "Le signalement des collections n'est pas encore disponible.",
} as const;

/** Sonde refaite au plus toutes les 5 minutes tant que 0034 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

async function probeSchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  try {
    const db = fastify.supabaseAdmin;
    const checks = await Promise.all([
      db.from("collections").select("id, hidden_at").limit(0),
      db.from("collection_image_copies").select("wishlist_item_id, image_removed_at").limit(0),
    ]);
    const failed = checks.find((check) => check.error);
    if (!failed) return true;
    fastify.log.warn({ code: failed.error?.code ?? null }, "Modération des collections coupée : migration 0034 absente");
  } catch {
    fastify.log.warn({ code: null }, "Modération des collections coupée : schéma illisible");
  }
  return false;
}

/** La base a-t-elle les migrations 0033 ET 0034 ? Mémorisé une fois vu ;
 * absente, un avertissement, puis la sonde n'est refaite qu'au bout de
 * 5 minutes (comme collectionsReady). */
export async function collectionModerationReady(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<boolean> {
  if (!(await collectionsReady(fastify, now))) return false;
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
export function resetCollectionModerationProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}

/** `reporterId` peut-il signaler la collection `id` ? Seulement s'il la voit
 * vraiment (montrée aux amis, pas masquée, entre amis, sans blocage, auteur
 * non suspendu : la règle de readSharedCollection), et jamais la sienne.
 * Sinon : non, quelle que soit la raison (même réponse qu'une collection
 * inexistante). Une collection déjà signalée par lui peut l'être encore,
 * comme les autres contenus. */
export async function canReportCollection(fastify: FastifyInstance, reporterId: string, id: string): Promise<boolean> {
  const row = await readVisibleCollection(fastify, reporterId, id);
  return row !== null && row.user_id !== reporterId;
}
