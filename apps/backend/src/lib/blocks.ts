import type { FastifyInstance } from "fastify";

/** Identifiants de tous les comptes en relation de blocage avec `userId`,
 * dans un sens comme dans l'autre (règle 8 du programme : un compte bloqué
 * n'apparaît jamais, quel que soit le sens du blocage). Relève une erreur si
 * la lecture échoue : mieux vaut une erreur qu'un contenu bloqué affiché. */
export async function fetchBlockedUserIds(fastify: FastifyInstance, userId: string): Promise<Set<string>> {
  const [blockedByMe, blockingMe] = await Promise.all([
    fastify.supabaseAdmin.from("blocks").select("blocked_id").eq("blocker_id", userId),
    fastify.supabaseAdmin.from("blocks").select("blocker_id").eq("blocked_id", userId),
  ]);
  if (blockedByMe.error || blockingMe.error) {
    throw new Error("Lecture des blocages impossible");
  }
  return new Set([
    ...(blockedByMe.data ?? []).map((b) => b.blocked_id as string),
    ...(blockingMe.data ?? []).map((b) => b.blocker_id as string),
  ]);
}
