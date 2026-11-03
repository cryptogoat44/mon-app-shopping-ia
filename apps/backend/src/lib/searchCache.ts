// Cache des recherches de la voie C (lot c, 2026-11-02 ; table search_cache,
// migration 0028). Règle du fondateur : la même image (mêmes octets, même
// cadre) relancée ne refait jamais les mêmes recherches payantes.
// - Trois étapes : « lens » (réponse de Google Lens filtrée), « query » (la
//   requête écrite par l'IA, ou son absence) et « shopping » (réponse de
//   Google Shopping filtrée, pour une requête de l'IA seulement). Les mots
//   tapés par la personne (voie B) ne sont JAMAIS mis en cache : l'empreinte
//   de quelques mots se retrouve facilement.
// - Clés : empreintes SHA-256 à sens unique ; la table n'a ni compte ni
//   recherche (aucun user_id, aucun search_id) : elle n'est ni exportée ni
//   supprimée avec un compte, sa durée de 24 h borne la conservation.
// - Seules les réponses réussies et facturées sont gardées (les vides
//   comprises) ; pannes, délais dépassés et refus jamais (choix de l'appelant).
// - Le cache n'empêche jamais une recherche : une lecture en erreur, lente
//   (signal), sur une table absente ou au contenu invalide vaut « absent » ;
//   une écriture trop grosse ou en échec est seulement journalisée. Aucune
//   fonction d'ici ne lève d'erreur.
// - Journaux : un type et un code, jamais la clé ni le contenu.

import { createHash } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { ZodType, ZodTypeDef } from "zod";

/** Étapes mises en cache (contrainte search_cache.step, 0028). */
export type CacheStep = "lens" | "query" | "shopping";

/** Durée de vie d'une entrée : 24 h, une seule constante (décision du
 * fondateur ; les réponses vides de Lens comprises). */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Taille maximale du contenu, comme la contrainte de 0028
 * (octet_length(payload::text) <= 262144). */
export const CACHE_PAYLOAD_MAX_BYTES = 262_144;

const TABLE = "search_cache";
/** Table absente (0028 pas encore appliquée) : code de Postgres, puis celui
 * de PostgREST (table inconnue de son cache de schéma). */
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

/** Erreur renvoyée par le client : seul son code est lu (le message pourrait
 * reprendre une valeur, donc la clé). */
export interface CacheDbError {
  code?: string;
}

export interface CacheRow {
  key: string;
  step: CacheStep;
  payload: unknown;
  created_at: string;
  expires_at: string;
}

/** Client minimal : seulement les appels faits ici. Le client Supabase du
 * serveur y correspond tel quel (vérifié par tests/searchCache.test.ts), et
 * un faux écrit à la main dans les tests aussi. `filter(colonne, "eq", …)`
 * plutôt que `eq(…)` : même requête PostgREST, mais une signature simple, que
 * TypeScript sait comparer (celle de `eq` est trop profonde pour lui). */
export interface CacheDb {
  from(table: typeof TABLE): {
    select(columns: "payload, expires_at"): {
      filter(
        column: "key",
        operator: "eq",
        value: string
      ): {
        filter(
          column: "expires_at",
          operator: "gt",
          value: string
        ): {
          abortSignal(signal: AbortSignal): {
            maybeSingle(): PromiseLike<{ data: unknown; error: CacheDbError | null }>;
          };
        };
      };
    };
    upsert(row: CacheRow, options: { onConflict: "key" }): PromiseLike<{ error: CacheDbError | null }>;
    delete(): {
      filter(column: "expires_at", operator: "lt", value: string): PromiseLike<{ error: CacheDbError | null }>;
    };
  };
}

export type CacheLog = Pick<FastifyBaseLogger, "warn">;

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Empreinte de l'image préparée (JPEG recadré et réduit par
 * prepareImageForAnalysis) : l'image n'est jamais gardée, seulement ceci. */
export function imageHash(image: Buffer): string {
  return sha256(image);
}

/** Clé d'une entrée : SHA-256 (64 caractères hexadécimaux en minuscules) de
 * l'étape et des parties, sérialisées sans ambiguïté (aucune confusion
 * possible entre « a|b » + « c » et « a » + « b|c »). Les parties sont
 * données telles quelles : l'appelant les normalise (requête en NFC,
 * minuscules, espaces simples) et y met la version de ses réglages. */
export function cacheKey(step: CacheStep, parts: readonly string[]): string {
  return sha256(JSON.stringify([step, ...parts]));
}

function isMissingTable(error: CacheDbError): boolean {
  return error.code !== undefined && MISSING_TABLE_CODES.has(error.code);
}

/** Résout `null` dès que le signal est déclenché (délai de lecture dépassé),
 * même si le client ne l'écoute pas. */
function whenAborted(signal: AbortSignal): Promise<null> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve(null);
    else signal.addEventListener("abort", () => resolve(null), { once: true });
  });
}

const ROW_SHAPE = (row: unknown): row is { payload: unknown; expires_at: string } =>
  typeof row === "object" && row !== null && "payload" in row && typeof (row as { expires_at?: unknown }).expires_at === "string";

/** Lit une entrée encore valable et la valide avec `schema` (sa sortie est
 * renvoyée : valeurs par défaut et transformations comprises). Absente,
 * expirée, illisible, invalide, table absente ou lecture plus lente que le
 * signal (800 ms, VOIE_C_BUDGET.cacheReadMs) : null, et un avertissement
 * sans la clé. Ne lève jamais d'erreur. */
export async function readCache<T>(
  db: CacheDb,
  key: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
  log: CacheLog,
  signal: AbortSignal
): Promise<T | null> {
  const miss = (reason: "timeout" | "missing_table" | "error" | "invalid_payload", code?: string): null => {
    log.warn({ reason, code: code ?? null }, "Cache recherche : lecture ignorée");
    return null;
  };
  try {
    const now = new Date();
    const query = db.from(TABLE).select("payload, expires_at").filter("key", "eq", key).filter("expires_at", "gt", now.toISOString()).abortSignal(signal).maybeSingle();
    const result = await Promise.race([Promise.resolve(query), whenAborted(signal)]);
    if (result === null || signal.aborted) return miss("timeout");
    if (result.error) return miss(isMissingTable(result.error) ? "missing_table" : "error", result.error.code);
    if (result.data === null || result.data === undefined) return null;
    if (!ROW_SHAPE(result.data)) return miss("invalid_payload");
    // Le filtre de la base suffit ; revérifié ici (horloges, faux clients).
    const expiresAt = Date.parse(result.data.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return null;
    const parsed = schema.safeParse(result.data.payload);
    return parsed.success ? parsed.data : miss("invalid_payload");
  } catch {
    return miss(signal.aborted ? "timeout" : "error");
  }
}

/** Nombre de séparateurs « : » et « , » d'une valeur JSON : jsonb les écrit
 * suivis d'une espace (« {"a": 1, "b": 2} »), que JSON.stringify n'écrit pas. */
function separatorCount(value: unknown): number {
  if (Array.isArray(value)) return Math.max(value.length - 1, 0) + value.reduce((sum: number, item) => sum + separatorCount(item), 0);
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    return entries.length * 2 - (entries.length > 0 ? 1 : 0) + entries.reduce((sum, [, item]) => sum + separatorCount(item), 0);
  }
  return 0;
}

/** Taille du contenu telle que la base la mesure (payload::text), ou null
 * s'il n'est pas sérialisable en JSON. */
export function payloadBytes(payload: unknown): number | null {
  try {
    const json = JSON.stringify(payload);
    if (json === undefined) return null;
    return Buffer.byteLength(json, "utf8") + separatorCount(payload);
  } catch {
    return null;
  }
}

/** Écrit (ou remplace) une entrée valable `ttlMs` (24 h par défaut). Contenu
 * de plus de 256 Ko ou non sérialisable : rien n'est écrit, un avertissement
 * est journalisé (étape et taille seulement). Échec de la base : journalisé.
 * Ne lève jamais d'erreur ; l'appelant ne l'attend pas. */
export async function writeCache(db: CacheDb, key: string, step: CacheStep, payload: unknown, log: CacheLog, ttlMs = CACHE_TTL_MS): Promise<void> {
  try {
    const bytes = payloadBytes(payload);
    if (bytes === null || bytes > CACHE_PAYLOAD_MAX_BYTES) {
      log.warn({ step, bytes }, "Cache recherche : écriture ignorée (contenu trop gros ou illisible)");
      return;
    }
    const now = Date.now();
    const row: CacheRow = { key, step, payload, created_at: new Date(now).toISOString(), expires_at: new Date(now + ttlMs).toISOString() };
    const { error } = await db.from(TABLE).upsert(row, { onConflict: "key" });
    if (error) log.warn({ step, code: error.code ?? null }, "Cache recherche : écriture impossible");
  } catch {
    log.warn({ step }, "Cache recherche : écriture impossible");
  }
}

/** Supprime les entrées expirées. Appelée à chaque /prepare, QUEL QUE SOIT
 * l'interrupteur de la voie C : la durée de 24 h tient même quand plus rien
 * n'écrit. Table absente (0028 pas appliquée) : ignoré sans bruit. Autre
 * échec : un avertissement. Ne lève jamais d'erreur. */
export async function purgeExpiredCache(db: CacheDb, log: CacheLog): Promise<void> {
  try {
    const { error } = await db.from(TABLE).delete().filter("expires_at", "lt", new Date().toISOString());
    if (error && !isMissingTable(error)) log.warn({ code: error.code ?? null }, "Cache recherche : purge impossible");
  } catch {
    log.warn({ code: null }, "Cache recherche : purge impossible");
  }
}
