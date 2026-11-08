// Boutiques ensuite (2026-11-08, migration 0031). Avec la voie C, la nouvelle
// app reçoit les résultats Lens dès qu'ils arrivent ; « Cette pièce dans
// d'autres boutiques » (l'IA, puis Google Shopping : lib/voieC.ts,
// runComplement) est faite ensuite, par POST /api/searches/:id/complement.
// Ici, sans réseau : l'état de cette étape différée, la sonde du schéma et
// l'ordre de Google des propositions Lens relu dans la base.
//
// Règles tenues (routes/searches.ts) :
// - l'étape payante ne tourne qu'UNE fois par recherche : « pending » →
//   « running » en une seule instruction conditionnelle, même avec deux
//   appels simultanés, une relance ou un second appareil ;
// - une étape restée « pending » plus de 5 minutes est expirée : jamais
//   d'appel payant plus tard pour une recherche abandonnée ;
// - l'IA lit les titres Lens dans l'ordre de Google, jamais dans celui des
//   mots tapés sous la photo (ils ne sont ni enregistrés, ni envoyés) ;
// - les apps déjà installées ne demandent rien : pour elles, rien ne change.
import type { FastifyInstance } from "fastify";
import type { VisualMatch } from "../services/visualSearch.js";
import type { MatchRow, SearchRow } from "./searchRows.js";

/** Au-delà, une étape jamais demandée par l'app est expirée (aucun appel). */
export const COMPLEMENT_PENDING_MAX_MS = 5 * 60_000;

/** Au-delà, une étape « running » est tenue pour abandonnée (serveur
 * redémarré pendant l'étape) : son budget est de 14 s. */
export const COMPLEMENT_RUNNING_MAX_MS = 60_000;

/** Pendant qu'une autre demande fait l'étape, l'issue est relue à ce rythme. */
export const COMPLEMENT_WAIT_STEP_MS = 500;

/** États enregistrés (product_searches.complement_deferred, 0031). */
export type DeferredColumn = "pending" | "running" | "done";

/** État lu, avec l'âge : « none » (lancement sans boutiques ensuite, ou rien
 * à chercher), « pending » (en attente de l'app), « expired » (« pending »
 * trop vieux), « running » (une demande fait l'étape), « stale » (« running »
 * trop vieux), « done » (issue enregistrée). */
export type DeferredState = "none" | "pending" | "expired" | "running" | "stale" | "done";

export function deferredStateOf(row: Pick<SearchRow, "complement_deferred" | "complement_deferred_at">, now: number): DeferredState {
  const column = row.complement_deferred ?? null;
  if (column === null) return "none";
  if (column === "done") return "done";
  const at = Date.parse(row.complement_deferred_at ?? "");
  const age = Number.isFinite(at) ? now - at : Number.POSITIVE_INFINITY;
  if (column === "pending") return age <= COMPLEMENT_PENDING_MAX_MS ? "pending" : "expired";
  return age <= COMPLEMENT_RUNNING_MAX_MS ? "running" : "stale";
}

/** Les boutiques arrivent encore : l'app peut attendre leur issue. */
export function deferredPending(state: DeferredState): boolean {
  return state === "pending" || state === "running";
}

/** Les propositions Lens d'une recherche, dans l'ordre de Google (avant le
 * tri par les mots de la photo), telles que runComplement les lit.
 * - Rangées avec lens_rank (les mots avaient changé l'ordre) : dans l'ordre
 *   de lens_rank.
 * - Sinon, l'ordre des rangs est déjà celui de Google.
 * Les propositions du complément (« shopping », « words ») sont écartées. */
export function lensInGoogleOrder(rows: readonly MatchRow[]): VisualMatch[] {
  const lens = rows.filter((row) => (row.origin ?? "lens") === "lens");
  const byLensRank = lens.length > 0 && lens.every((row) => typeof row.lens_rank === "number");
  const ordered = [...lens].sort((a, b) => (byLensRank ? a.lens_rank! - b.lens_rank! : 0) || a.rank - b.rank);
  return ordered.map((row, index) => ({
    rank: index + 1,
    productName: row.product_name,
    imageUrl: row.image_url,
    imageHdUrl: row.image_hd_url,
    merchantName: row.merchant_name,
    merchantUrl: row.merchant_url,
    priceValue: row.price_min === null ? null : Number(row.price_min),
    currency: row.currency,
  }));
}

/** Des rangs de Google ont-ils été gardés pour cette recherche ? (à effacer) */
export function hasLensRanks(rows: readonly MatchRow[]): boolean {
  return rows.some((row) => typeof row.lens_rank === "number");
}

// ---- Schéma de la base (migration 0031) ----

/** Sonde refaite au plus toutes les 5 minutes tant que 0031 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

async function probeSchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  try {
    const db = fastify.supabaseAdmin;
    const checks = await Promise.all([
      db.from("product_searches").select("complement_deferred, complement_deferred_at").limit(0),
      db.from("product_matches").select("lens_rank").limit(0),
    ]);
    const failed = checks.find((check) => check.error);
    if (!failed) return true;
    fastify.log.warn({ code: failed.error?.code ?? null }, "Boutiques ensuite coupées : migration 0031 absente, les boutiques restent cherchées au lancement");
  } catch {
    fastify.log.warn({ code: null }, "Boutiques ensuite coupées : schéma illisible, les boutiques restent cherchées au lancement");
  }
  return false;
}

/** La base a-t-elle la migration 0031 ? Mémorisé une fois vu ; absent, un
 * avertissement, puis la sonde n'est refaite qu'au bout de 5 minutes. Sans
 * elle, la demande de la nouvelle app est ignorée : tout se fait au
 * lancement, comme avant. */
export async function deferredComplementReady(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<boolean> {
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
export function resetDeferredSchemaProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}
