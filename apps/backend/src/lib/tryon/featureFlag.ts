// Second interrupteur de l'essayage virtuel : le drapeau feature_flags.tryon
// de la base (migration 0042), allumé seulement par le script du fondateur
// (pnpm tryon:flag --on --confirm). Relu au plus toutes les 15 secondes :
// l'éteindre dans la base coupe l'essayage en moins de 15 secondes, sans
// mise en ligne. Dans le doute, éteint : table absente (base sans 0042),
// ligne absente, réponse illisible ou base injoignable.
import type { FastifyInstance } from "fastify";
import { z } from "zod";

/** Durée pendant laquelle une lecture du drapeau est gardée. */
export const FEATURE_FLAG_TTL_MS = 15_000;
const READ_TIMEOUT_MS = 3_000;
const FLAG_ROW = z.object({ enabled: z.boolean() });

export interface FeatureFlagReader {
  /** Le drapeau est-il allumé ? (lecture gardée 15 s ; toute erreur : non). */
  isOn(): Promise<boolean>;
}

type FlagDatabase = Pick<FastifyInstance, "supabaseAdmin" | "log">;

async function readFlag(fastify: FlagDatabase, key: string): Promise<boolean> {
  try {
    const { data, error } = await fastify.supabaseAdmin
      .from("feature_flags")
      .select("enabled")
      .eq("key", key)
      .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS))
      .maybeSingle();
    if (error) {
      fastify.log.warn({ code: error.code ?? null }, "Drapeau illisible : fonction éteinte");
      return false;
    }
    const row = FLAG_ROW.safeParse(data);
    return row.success && row.data.enabled;
  } catch {
    fastify.log.warn({ code: null }, "Drapeau illisible (base injoignable) : fonction éteinte");
    return false;
  }
}

/** Lecteur du drapeau `key`, avec sa propre mémoire (une lecture à la fois). */
export function featureFlagReader(fastify: FlagDatabase, key: string, now: () => number = Date.now): FeatureFlagReader {
  let cached: { value: boolean; readAt: number } | null = null;
  let pending: Promise<boolean> | null = null;
  return {
    async isOn() {
      if (cached && now() - cached.readAt < FEATURE_FLAG_TTL_MS) return cached.value;
      pending ??= readFlag(fastify, key)
        .then((value) => {
          cached = { value, readAt: now() };
          return value;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  };
}
