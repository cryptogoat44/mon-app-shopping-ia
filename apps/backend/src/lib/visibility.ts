import type { FastifyInstance } from "fastify";
import type { PrivacyLevel } from "@monapp/shared-types";

// Règles de visibilité entre deux comptes (Lot Q, décision 6) — une seule
// source pour le fil, le détail d'une publication, les « j'aime » et le
// profil d'un autre utilisateur.

/** Un blocage dans un sens OU dans l'autre rend les deux comptes
 * mutuellement invisibles. */
export async function isBlockedEitherWay(fastify: FastifyInstance, userA: string, userB: string): Promise<boolean> {
  const [{ data: aBlocksB }, { data: bBlocksA }] = await Promise.all([
    fastify.supabaseAdmin.from("blocks").select("blocker_id").eq("blocker_id", userA).eq("blocked_id", userB).maybeSingle(),
    fastify.supabaseAdmin.from("blocks").select("blocker_id").eq("blocker_id", userB).eq("blocked_id", userA).maybeSingle(),
  ]);
  return Boolean(aBlocksB || bBlocksA);
}

export async function isFollowing(fastify: FastifyInstance, followerId: string, followeeId: string): Promise<boolean> {
  const { data } = await fastify.supabaseAdmin
    .from("follows")
    .select("follower_id")
    .eq("follower_id", followerId)
    .eq("followee_id", followeeId)
    .maybeSingle();
  return Boolean(data);
}

/** Confidentialités qu'un visiteur peut voir chez un auteur (hors blocage,
 * à vérifier à part) : publique pour tous, « abonnés » pour ses abonnés,
 * privée pour personne d'autre que l'auteur. */
export function visiblePrivacies(isOwner: boolean, follows: boolean): PrivacyLevel[] {
  if (isOwner) return ["public", "followers", "private"];
  return follows ? ["public", "followers"] : ["public"];
}

/** Une publication précise est-elle visible par ce visiteur ? */
export async function canViewPost(
  fastify: FastifyInstance,
  viewerId: string,
  post: { user_id: string; privacy: PrivacyLevel }
): Promise<boolean> {
  if (post.user_id === viewerId) return true;
  if (await isBlockedEitherWay(fastify, viewerId, post.user_id)) return false;
  if (post.privacy === "public") return true;
  if (post.privacy === "private") return false;
  return isFollowing(fastify, viewerId, post.user_id);
}
