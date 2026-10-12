import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PRIVACY_LEVELS, type PrivacyLevel } from "@monapp/shared-types";
import { DatabaseReadError } from "./validation.js";

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

/** Publications montrables (lot 5, modération) : une publication masquée
 * disparaît partout — fil, profils, détail, liens partagés, commentaires,
 * « j'aime », pièces taguées — y compris pour son auteur, informé par une
 * notification. Seuls l'export de ses données et la modération la voient. */
export function shownPosts<Columns extends string>(fastify: FastifyInstance, columns: Columns, options?: { count: "exact"; head: true }) {
  return fastify.supabaseAdmin.from("posts").select(columns, options).is("hidden_at", null);
}

/** Une publication précise est-elle visible par ce visiteur ? À appeler sur
 * une publication lue avec `shownPosts` (jamais une publication masquée). */
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

const postRefSchema = z.object({ id: z.string().uuid(), user_id: z.string().uuid(), privacy: z.enum(PRIVACY_LEVELS) });
export type PostRef = z.infer<typeof postRefSchema>;

/** La publication `postId` si ce visiteur peut la voir (masquage, blocages,
 * confidentialité), sinon null — sans distinguer « n'existe pas » de « pas
 * pour vous ». Lecture impossible : DatabaseReadError. */
export async function findViewablePost(fastify: FastifyInstance, viewerId: string, postId: string): Promise<PostRef | null> {
  const { data, error } = await shownPosts(fastify, "id, user_id, privacy").eq("id", postId).maybeSingle();
  if (error) throw new DatabaseReadError("Lecture d'une publication impossible");
  if (data === null) return null;
  const parsed = postRefSchema.safeParse(data);
  if (!parsed.success) throw new DatabaseReadError("Publication illisible");
  return (await canViewPost(fastify, viewerId, parsed.data)) ? parsed.data : null;
}
