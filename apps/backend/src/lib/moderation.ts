// Modération minimaliste (lot 5, section 5.B) : rôle administrateur et comptes
// suspendus, chacun dans sa table (migration 0023) — jamais une colonne du
// profil. Toute vérification se fait ici, côté serveur.
import type { FastifyInstance } from "fastify";
import { DatabaseReadError } from "./validation.js";

/** Réponse d'une action refusée à un compte suspendu (publier, commenter,
 * suivre, réagir, modifier son profil public). Le motif figure dans la
 * notification de la suspension. */
export const ACCOUNT_SUSPENDED = {
  error: "account_suspended",
  message: "Votre compte est suspendu : cette action n'est plus possible.",
} as const;

/** Les routes d'administration n'existent pas pour les autres comptes. */
export const ADMIN_NOT_FOUND = { error: "not_found", message: "Page introuvable." } as const;

// Lecture impossible : DatabaseReadError (jamais « non administrateur » ni « non suspendu » par défaut).

export async function isAdmin(fastify: FastifyInstance, userId: string): Promise<boolean> {
  const { data, error } = await fastify.supabaseAdmin.from("admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw new DatabaseReadError("Lecture du rôle administrateur impossible");
  return data !== null;
}

export async function isSuspended(fastify: FastifyInstance, userId: string): Promise<boolean> {
  const { data, error } = await fastify.supabaseAdmin.from("suspensions").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw new DatabaseReadError("Lecture des suspensions impossible");
  return data !== null;
}

/** Comptes suspendus parmi `userIds` (recherche de comptes). */
export async function suspendedAmong(fastify: FastifyInstance, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const { data, error } = await fastify.supabaseAdmin.from("suspensions").select("user_id").in("user_id", userIds);
  if (error) throw new DatabaseReadError("Lecture des suspensions impossible");
  return new Set((data ?? []).map((row: { user_id: string }) => row.user_id));
}
