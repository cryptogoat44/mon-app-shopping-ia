// Modération des profils (lot « conformité Apple », migration 0037 ; règle
// 1.2 d'Apple : pouvoir retirer un contenu choquant). Deux choses :
//
// 1. Un administrateur peut retirer la bio ou la photo d'un profil
//    (routes/moderation.ts, fonction moderation_remove_profile_part). Ici :
//    la sonde de la migration. Sans 0037, les deux décisions ne sont pas
//    proposées (lib/moderationQueue.ts) et la route répond « indisponible ».
// 2. La bio et la photo d'un compte SUSPENDU ne sont plus montrées aux autres
//    membres (profil, publications, commentaires, messages, notifications,
//    pièces reçues, comptes bloqués). Rien n'est effacé : lever la suspension
//    les remontre. Aucune migration pour cela (table « suspensions », 0023).
//    La personne suspendue voit toujours son propre profil, et
//    l'administrateur voit tout dans la file de modération.
import type { FastifyInstance } from "fastify";
import { suspendedAmong } from "./moderation.js";

export const PROFILE_MODERATION_UNAVAILABLE = {
  error: "profile_moderation_unavailable",
  message: "Le retrait d'une bio ou d'une photo de profil n'est pas encore disponible.",
} as const;

/** Bucket public des photos de profil (migration 0009). */
export const AVATAR_BUCKET = "avatars";

/** Sonde refaite au plus toutes les 5 minutes tant que 0037 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;
/** Aucun compte n'a cet identifiant : la fonction répond « not_admin » sans rien faire. */
const NOBODY = "00000000-0000-0000-0000-000000000000";

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

/** La fonction de 0037 répond-elle ? Appelée sans administrateur : elle
 * refuse (« not_admin ») avant tout verrou et toute écriture. */
async function probeSchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  try {
    const { data, error } = await fastify.supabaseAdmin.rpc("moderation_remove_profile_part", {
      p_admin_id: NOBODY,
      p_user_id: NOBODY,
      p_part: "bio",
      p_reason: null,
      p_note: null,
    });
    if (!error && Array.isArray(data)) return true;
    fastify.log.warn({ code: (error as { code?: string } | null)?.code ?? null }, "Modération des profils coupée : migration 0037 absente");
  } catch {
    fastify.log.warn({ code: null }, "Modération des profils coupée : base illisible");
  }
  return false;
}

/** La base a-t-elle la migration 0037 ? Mémorisé une fois vu ; absente, un
 * avertissement, puis la sonde n'est refaite qu'au bout de 5 minutes (comme
 * collectionModerationReady). */
export async function profileModerationReady(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<boolean> {
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
export function resetProfileModerationProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}

/** Ce qu'un profil montre de personnel, en plus de ses noms. */
interface PublicFace {
  id: string;
  avatar_url: string | null;
  bio?: string | null;
}

/** Les profils tels que `viewerId` peut les voir : la photo (et la bio, si
 * elle est lue) d'un compte suspendu sont retirées de la réponse, sauf pour
 * ce compte lui-même. Les suspensions ne sont lues que si un de ces profils
 * a quelque chose à cacher. Lecture impossible : DatabaseReadError (jamais
 * « non suspendu » par défaut). */
export async function withoutSuspendedFaces<T extends PublicFace>(fastify: FastifyInstance, profiles: T[], viewerId: string): Promise<T[]> {
  const exposed = profiles.filter((profile) => profile.id !== viewerId && (profile.avatar_url !== null || (profile.bio ?? null) !== null));
  if (exposed.length === 0) return profiles;
  const suspended = await suspendedAmong(fastify, [...new Set(exposed.map((profile) => profile.id))]);
  if (suspended.size === 0) return profiles;
  return profiles.map((profile) => {
    if (profile.id === viewerId || !suspended.has(profile.id)) return profile;
    return { ...profile, avatar_url: null, ...("bio" in profile ? { bio: null } : {}) };
  });
}
