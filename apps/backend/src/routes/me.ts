import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { PHOTO_SIZES, optimizePhoto } from "../lib/photos.js";
import { z } from "zod";
import type { Profile } from "@monapp/shared-types";
import { isFileTooLargeError } from "../lib/multipartErrors.js";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

const updateMeSchema = z.object({
  username: z
    .string()
    .toLowerCase()
    .regex(USERNAME_REGEX, "3 à 20 caractères : lettres minuscules, chiffres, underscore."),
  displayName: z.string().trim().min(1).max(60),
  bio: z.string().trim().max(280).optional(),
});

// Ligne brute de la table `profiles` (colonnes en snake_case, cf. schema.sql)
interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  locale: string;
  default_privacy: "public" | "followers" | "private";
  created_at: string;
  updated_at: string;
}

function toProfile(row: ProfileRow, followersCount: number, followingCount: number, postsCount: number): Profile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    locale: row.locale,
    defaultPrivacy: row.default_privacy,
    followersCount,
    followingCount,
    postsCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchFollowCounts(
  fastify: FastifyInstance,
  userId: string
): Promise<{ followersCount: number; followingCount: number; postsCount: number }> {
  const [followers, following, posts] = await Promise.all([
    fastify.supabaseAdmin.from("follows").select("*", { count: "exact", head: true }).eq("followee_id", userId),
    fastify.supabaseAdmin.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", userId),
    // Son propre nombre de publications (toutes, y compris privées).
    fastify.supabaseAdmin.from("posts").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  return { followersCount: followers.count ?? 0, followingCount: following.count ?? 0, postsCount: posts.count ?? 0 };
}

export default async function meRoutes(fastify: FastifyInstance) {
  fastify.get("/api/me", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    const [{ data, error }, counts] = await Promise.all([
      fastify.supabaseAdmin.from("profiles").select("*").eq("id", userId).single(),
      fetchFollowCounts(fastify, userId),
    ]);

    if (error || !data) {
      request.log.error({ error }, "Profil introuvable pour un utilisateur authentifié");
      return reply.code(404).send({ error: "profile_not_found", message: "Profil introuvable." });
    }

    return reply.send(toProfile(data as ProfileRow, counts.followersCount, counts.followingCount, counts.postsCount));
  });

  fastify.post("/api/me/avatar", { preHandler: fastify.requireAuth }, async (request, reply) => {
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

    const counts = await fetchFollowCounts(fastify, userId);
    return reply.send(toProfile(updated as ProfileRow, counts.followersCount, counts.followingCount, counts.postsCount));
  });

  fastify.patch("/api/me", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const parsed = updateMeSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: parsed.error.issues[0]?.message ?? "Requête invalide.",
      });
    }

    const userId = request.user!.id;
    const { username, displayName, bio } = parsed.data;

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
    return reply.send(toProfile(data as ProfileRow, 0, 0, 0));
  });
}
