import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { PHOTO_SIZES, optimizePhoto } from "../lib/photos.js";
import { z } from "zod";
import { APP_LOCALES, PRIVACY_LEVELS, type Profile } from "@monapp/shared-types";
import { parseInput } from "../lib/validation.js";
import { isFileTooLargeError } from "../lib/multipartErrors.js";
import { GENERIC_SERVER_ERROR } from "../lib/messages.js";
import { isAdmin } from "../lib/moderation.js";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

const updateMeSchema = z.object({
  username: z
    .string()
    .toLowerCase()
    .regex(USERNAME_REGEX, "3 à 20 caractères : lettres minuscules, chiffres, underscore."),
  displayName: z.string().trim().min(1).max(60),
  bio: z.string().trim().max(280).optional(),
});

const updateLocaleSchema = z.object({ locale: z.enum(APP_LOCALES) });

// Ligne brute de la table `profiles` (colonnes en snake_case, cf. schema.sql), relue sans lui faire confiance.
const profileRowSchema = z.object({
  id: z.string().uuid(),
  username: z.string().nullable(),
  display_name: z.string(),
  avatar_url: z.string().nullable(),
  bio: z.string().nullable(),
  locale: z.string(),
  default_privacy: z.enum(PRIVACY_LEVELS),
  created_at: z.string(),
  updated_at: z.string(),
});

interface ProfileCounts {
  followersCount: number;
  followingCount: number;
  postsCount: number;
}

/** Profil renvoyé à l'app ; null si la ligne lue n'a pas la forme attendue. */
function toProfile(row: unknown, counts: ProfileCounts, admin: boolean): Profile | null {
  const parsed = profileRowSchema.safeParse(row);
  if (!parsed.success) return null;
  const profile = parsed.data;
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
    bio: profile.bio,
    locale: profile.locale,
    defaultPrivacy: profile.default_privacy,
    ...counts,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
    isAdmin: admin,
  };
}

async function fetchFollowCounts(fastify: FastifyInstance, userId: string): Promise<ProfileCounts> {
  const [followers, following, posts] = await Promise.all([
    fastify.supabaseAdmin.from("follows").select("*", { count: "exact", head: true }).eq("followee_id", userId),
    fastify.supabaseAdmin.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", userId),
    // Son propre nombre de publications (toutes, y compris privées), hors
    // publications masquées par la modération (lot 5).
    fastify.supabaseAdmin.from("posts").select("id", { count: "exact", head: true }).eq("user_id", userId).is("hidden_at", null),
  ]);
  return { followersCount: followers.count ?? 0, followingCount: following.count ?? 0, postsCount: posts.count ?? 0 };
}

const PROFILE_UNREADABLE = { error: "internal_error", message: GENERIC_SERVER_ERROR } as const;

export default async function meRoutes(fastify: FastifyInstance) {
  fastify.get("/api/me", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    // Rôle administrateur illisible : la requête échoue (500), jamais « non administrateur » par défaut.
    const [{ data, error }, counts, admin] = await Promise.all([
      fastify.supabaseAdmin.from("profiles").select("*").eq("id", userId).single(),
      fetchFollowCounts(fastify, userId),
      isAdmin(fastify, userId),
    ]);

    if (error || !data) {
      request.log.error({ error }, "Profil introuvable pour un utilisateur authentifié");
      return reply.code(404).send({ error: "profile_not_found", message: "Profil introuvable." });
    }

    const profile = toProfile(data, counts, admin);
    if (!profile) {
      request.log.error("Profil illisible");
      return reply.code(500).send(PROFILE_UNREADABLE);
    }
    return reply.send(profile);
  });

  // Profil public (photo, nom, bio) : non modifiable par un compte suspendu (lot 5).
  fastify.post("/api/me/avatar", { preHandler: [fastify.requireAuth, fastify.requireActiveAccount] }, async (request, reply) => {
    const userId = request.user!.id;

    const file = await request.file();
    if (!file || !file.mimetype.startsWith("image/")) {
      return reply.code(400).send({ error: "invalid_file", message: "Merci d'envoyer une image." });
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (error) {
      if (isFileTooLargeError(error)) {
        return reply.code(413).send({ error: "file_too_large", message: "Le fichier est trop volumineux (10 Mo maximum)." });
      }
      throw error;
    }

    // Avatar optimisé (512 px, sans métadonnées) — lot « images et fluidité ».
    let optimized: Buffer;
    try {
      optimized = await optimizePhoto(buffer, PHOTO_SIZES.avatar);
    } catch {
      return reply.code(400).send({ error: "invalid_file", message: "Cette photo n'a pas pu être lue." });
    }
    // Lu avant toute écriture : une lecture impossible n'enregistre rien.
    const admin = await isAdmin(fastify, userId);

    // upsert avec un nom fixe par utilisateur : une photo de profil n'a
    // qu'une seule version à la fois, contrairement aux photos du vault.
    const path = `${userId}/avatar.jpg`;

    const { error: uploadError } = await fastify.supabaseAdmin.storage
      .from("avatars")
      .upload(path, optimized, { contentType: "image/jpeg", upsert: true });

    if (uploadError) {
      request.log.error({ uploadError }, "Échec d'upload de la photo de profil");
      return reply.code(500).send({ error: "upload_failed", message: "L'envoi de la photo a échoué." });
    }

    // Un paramètre anti-cache : upsert écrase le même chemin, donc le CDN /
    // le cache navigateur doit être invité à revalider plutôt que resservir
    // l'ancienne image sous la même URL.
    const publicUrl = `${fastify.supabaseAdmin.storage.from("avatars").getPublicUrl(path).data.publicUrl}?v=${randomUUID()}`;

    const { data: updated, error: updateError } = await fastify.supabaseAdmin
      .from("profiles")
      .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select("*")
      .single();

    if (updateError || !updated) {
      request.log.error({ updateError }, "Échec de mise à jour de avatar_url");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const profile = toProfile(updated, await fetchFollowCounts(fastify, userId), admin);
    if (!profile) {
      request.log.error("Profil illisible");
      return reply.code(500).send(PROFILE_UNREADABLE);
    }
    return reply.send(profile);
  });

  fastify.patch("/api/me", { preHandler: [fastify.requireAuth, fastify.requireActiveAccount] }, async (request, reply) => {
    const parsed = updateMeSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: parsed.error.issues[0]?.message ?? "Requête invalide.",
      });
    }

    const userId = request.user!.id;
    const { username, displayName, bio } = parsed.data;
    // Lu avant toute écriture : une lecture impossible n'enregistre rien.
    const admin = await isAdmin(fastify, userId);

    const { data, error } = await fastify.supabaseAdmin
      .from("profiles")
      .update({ username, display_name: displayName, bio: bio ?? null, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select("*")
      .single();

    if (error) {
      // Contrainte unique sur `username` violée
      if (error.code === "23505") {
        return reply.code(409).send({ error: "username_taken", message: "Ce nom d'utilisateur est déjà pris." });
      }
      request.log.error({ error }, "Échec de mise à jour du profil");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    // Un profil qu'on vient de compléter n'a par construction encore
    // aucun abonné, abonnement ni publication — pas besoin de requêter les
    // compteurs ici.
    const profile = toProfile(data, { followersCount: 0, followingCount: 0, postsCount: 0 }, admin);
    if (!profile) {
      request.log.error("Profil illisible");
      return reply.code(500).send(PROFILE_UNREADABLE);
    }
    return reply.send(profile);
  });

  // Langue de l'interface (lot 3) : choisie sur l'écran Bienvenue ou dans les
  // Réglages, elle fixe aussi la langue des messages du serveur.
  fastify.put("/api/me/locale", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const body = parseInput(updateLocaleSchema, request.body, reply, { error: "invalid_body" });
    if (!body) return;
    const { error } = await fastify.supabaseAdmin
      .from("profiles")
      .update({ locale: body.locale, updated_at: new Date().toISOString() })
      .eq("id", request.user!.id);
    if (error) {
      request.log.error({ error }, "Échec de mise à jour de la langue");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    return reply.code(204).send();
  });
}
