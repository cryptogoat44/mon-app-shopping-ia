// Essayage virtuel : la base a-t-elle la migration 0042 ? Même sonde que pour
// les alertes prix (lib/wishAlertsSchema.ts) : la fonction tryon_version,
// que seul le serveur peut appeler. Présente : mémorisé ; absente : la
// sonde n'est refaite qu'au bout de 5 minutes ; réponse illisible : 30 s.
// Sert à l'export des données (sections vides sans 0042). L'essayage
// lui-même n'en a pas besoin : sans 0042, son drapeau est introuvable,
// donc éteint (lib/tryon/featureFlag.ts).
import type { FastifyInstance } from "fastify";

const SCHEMA_RETRY_MS = 5 * 60_000;
const SCHEMA_UNKNOWN_RETRY_MS = 30_000;
const FUNCTION_MISSING_CODES = new Set(["PGRST202", "42883"]);

type ProbeState = "ready" | "absent" | "unknown";
type Database = Pick<FastifyInstance, "supabaseAdmin" | "log">;

let readyAt: number | null = null;
let missingAt: number | null = null;
let unknownAt: number | null = null;
let probe: Promise<ProbeState> | null = null;

async function probeSchema(fastify: Database): Promise<ProbeState> {
  try {
    const { data, error } = await fastify.supabaseAdmin.rpc("tryon_version");
    if (!error && typeof data === "number" && data >= 1) return "ready";
    if (error && FUNCTION_MISSING_CODES.has(error.code ?? "")) return "absent";
    fastify.log.warn({ code: error?.code ?? null }, "Essayage virtuel : schéma inconnu (réponse illisible)");
  } catch {
    fastify.log.warn({ code: null }, "Essayage virtuel : schéma inconnu (base injoignable)");
  }
  return "unknown";
}

/** La migration 0042 est-elle là ? (absente ou inconnue : non). */
export async function tryonSchemaReady(fastify: Database, now: () => number = Date.now): Promise<boolean> {
  if (readyAt !== null) return true;
  if (missingAt !== null && now() - missingAt < SCHEMA_RETRY_MS) return false;
  if (unknownAt !== null && now() - unknownAt < SCHEMA_UNKNOWN_RETRY_MS) return false;
  probe ??= probeSchema(fastify)
    .then((state) => {
      readyAt = state === "ready" ? now() : null;
      missingAt = state === "absent" ? now() : null;
      unknownAt = state === "unknown" ? now() : null;
      return state;
    })
    .finally(() => {
      probe = null;
    });
  return (await probe) === "ready";
}

/** Tests seulement : oublie la sonde. */
export function resetTryonSchemaProbe(): void {
  readyAt = null;
  missingAt = null;
  unknownAt = null;
  probe = null;
}
