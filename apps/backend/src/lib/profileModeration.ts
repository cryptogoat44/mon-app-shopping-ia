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
import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { suspendedAmong } from "./moderation.js";
import { extractOwnedStoragePath } from "./storage.js";

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

/** Revue de sécurité du 12 novembre 2026 : à la suspension d'un compte, sa
 * photo de profil change d'adresse. Le bucket des photos de profil est
 * public : cacher l'adresse dans les réponses du serveur ne suffisait pas,
 * la photo restait lisible par quiconque connaissait son adresse (pour les
 * photos d'avant le 12 novembre : « <compte>/avatar.jpg », devinable). Le
 * fichier est déplacé sous un nom au hasard, que seuls la personne suspendue
 * et l'administrateur reçoivent ; rien n'est effacé, lever la suspension
 * remontre la photo. `actionId` : la décision de suspension enregistrée.
 * Ne relève jamais d'erreur et ne défait jamais la suspension : un échec
 * laisse la photo à son ancienne adresse (journal sans chemin ni identifiant). */
export async function moveSuspendedAvatar(fastify: Pick<FastifyInstance, "supabaseAdmin">, log: FastifyBaseLogger, actionId: string): Promise<void> {
  try {
    const db = fastify.supabaseAdmin;
    const suspension = await db.from("suspensions").select("user_id").eq("moderation_action_id", actionId).maybeSingle();
    const userId = (suspension.data as { user_id?: unknown } | null)?.user_id;
    if (suspension.error || typeof userId !== "string") return;
    const profile = await db.from("profiles").select("avatar_url").eq("id", userId).maybeSingle();
    const previousUrl = (profile.data as { avatar_url?: unknown } | null)?.avatar_url;
    if (profile.error || typeof previousUrl !== "string") return;
    const previousPath = extractOwnedStoragePath(previousUrl, AVATAR_BUCKET, userId);
    if (!previousPath) return;

    const bucket = db.storage.from(AVATAR_BUCKET);
    const path = `${userId}/avatar-${randomUUID()}.jpg`;
    const moved = await bucket.move(previousPath, path);
    if (moved.error) {
      log.warn({ bucket: AVATAR_BUCKET }, "Suspension : la photo de profil n'a pas pu changer d'adresse");
      return;
    }
    const updated = await db
      .from("profiles")
      .update({ avatar_url: bucket.getPublicUrl(path).data.publicUrl, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .eq("avatar_url", previousUrl)
      .select("id");
    if (updated.error || !Array.isArray(updated.data) || updated.data.length !== 1) {
      // Profil non mis à jour (ou photo changée entre-temps) : le fichier retrouve son nom.
      await bucket.move(path, previousPath);
      log.warn({ bucket: AVATAR_BUCKET }, "Suspension : la nouvelle adresse de la photo de profil n'a pas pu être enregistrée");
    }
  } catch {
    log.warn({ bucket: AVATAR_BUCKET }, "Suspension : la photo de profil n'a pas pu changer d'adresse");
  }
}
