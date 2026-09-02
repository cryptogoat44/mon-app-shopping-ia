import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Profile } from "@monapp/shared-types";

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

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    locale: row.locale,
    defaultPrivacy: row.default_privacy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default async function meRoutes(fastify: FastifyInstance) {
  fastify.get("/api/me", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    const { data, error } = await fastify.supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error || !data) {
      request.log.error({ error }, "Profil introuvable pour un utilisateur authentifié");
      return reply.code(404).send({ error: "profile_not_found", message: "Profil introuvable." });
    }

    return reply.send(toProfile(data as ProfileRow));
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

    return reply.send(toProfile(data as ProfileRow));
  });
}
