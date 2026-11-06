// Masquage automatique (chantier 3, point 6 de la feuille de route V1 ;
// règle 1.2 d'Apple) : un contenu signalé par plusieurs personnes
// DIFFÉRENTES est masqué aussitôt, en attendant la décision d'un
// administrateur. Tout se passe dans la base, en une transaction (fonction
// moderation_auto_hide, migration 0030) : décompte des signalements encore à
// traiter, masquage, journal (décision « automatique », sans administrateur),
// personne concernée prévenue. Les signalements restent « à traiter » :
// l'administrateur confirme le masquage ou classe sans suite, ce qui rétablit
// le contenu (migration 0030, moderation_apply).
// Contre les masquages abusifs, ne comptent pas : un compte créé depuis
// moins d'un jour, un compte suspendu, une personne dont un administrateur a
// déjà jugé un signalement du même contenu (relecture sécurité).
//
// Sans la migration 0030 (production avant que le fondateur l'applique), la
// fonction n'existe pas : le signalement est enregistré comme avant, rien
// n'est masqué, un seul avertissement au journal, et la base n'est
// réinterrogée qu'au bout de 5 minutes.
import { z } from "zod";

/** Personnes différentes dont les signalements, encore à traiter, masquent
 * un contenu en attendant la décision d'un administrateur. */
export const AUTO_HIDE_DISTINCT_REPORTERS = 3;

/** Contenus qui se masquent (un profil ne se masque pas : il se suspend). */
export const AUTO_HIDE_TARGET_TYPES = ["post", "comment", "piece"] as const;
export type AutoHideTargetType = (typeof AUTO_HIDE_TARGET_TYPES)[number];

export function isAutoHideTarget(targetType: string): targetType is AutoHideTargetType {
  return (AUTO_HIDE_TARGET_TYPES as readonly string[]).includes(targetType);
}

/** L'appel à la base, seul point de contact (un faux dans les tests). Le
 * client Supabase du serveur s'y branche par `(fn, args) => db.rpc(fn, args)`. */
export type AutoHideRpc = (
  fn: "moderation_auto_hide",
  args: { p_target_type: AutoHideTargetType; p_target_id: string; p_threshold: number }
) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;

export interface AutoHideLog {
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

/** Fonction inconnue : code de Postgres, puis celui de PostgREST (absente de son cache de schéma). */
const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202"]);
const RETRY_MS = 5 * 60_000;
const OUTCOME = z.array(z.object({ outcome: z.string(), action_id: z.string().uuid().nullable() })).length(1);

let missingAt: number | null = null;

/** « hidden » : masqué à l'instant ; « not_hidden » : pas (encore) assez de
 * personnes, déjà masqué, ou contenu disparu ; « unavailable » : migration
 * 0030 absente ; « failed » : erreur, journalisée. Ne lève jamais : le
 * signalement, déjà enregistré, ne doit pas échouer pour autant. */
export type AutoHideOutcome = "hidden" | "not_hidden" | "unavailable" | "failed";

export async function autoHideIfReported(
  rpc: AutoHideRpc,
  log: AutoHideLog,
  targetType: string,
  targetId: string,
  now: () => number = Date.now
): Promise<AutoHideOutcome> {
  if (!isAutoHideTarget(targetType)) return "not_hidden";
  if (missingAt !== null && now() - missingAt < RETRY_MS) return "unavailable";
  try {
    const { data, error } = await rpc("moderation_auto_hide", {
      p_target_type: targetType,
      p_target_id: targetId,
      p_threshold: AUTO_HIDE_DISTINCT_REPORTERS,
    });
    if (error) {
      if (error.code !== undefined && MISSING_FUNCTION_CODES.has(error.code)) {
        if (missingAt === null) log.warn({ code: error.code }, "Masquage automatique indisponible : migration 0030 absente");
        missingAt = now();
        return "unavailable";
      }
      log.error({ code: error.code ?? null }, "Masquage automatique : échec");
      return "failed";
    }
    missingAt = null;
    const parsed = OUTCOME.safeParse(data);
    if (!parsed.success) {
      log.error({}, "Masquage automatique : réponse illisible");
      return "failed";
    }
    return parsed.data[0]!.outcome === "ok" ? "hidden" : "not_hidden";
  } catch {
    log.error({}, "Masquage automatique : exception");
    return "failed";
  }
}

/** Tests seulement : oublie l'absence constatée de la migration. */
export function resetAutoHideProbe(): void {
  missingAt = null;
}
