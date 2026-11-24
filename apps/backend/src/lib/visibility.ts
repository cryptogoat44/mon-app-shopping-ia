import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PRIVACY_LEVELS, type PrivacyLevel } from "@monapp/shared-types";
import { postVisibleTo, readAudienceOf } from "./audience.js";
import { DatabaseReadError } from "./validation.js";

// Règles de visibilité entre deux comptes (Lot Q, décision 6) — une seule
// source pour le fil, le détail d'une publication, les « j'aime » et le
// profil d'un autre utilisateur.

/** Un blocage dans un sens OU dans l'autre rend les deux comptes
 * mutuellement invisibles. Lot « étagères des amis » (contre-lecture) : une
 * lecture impossible relève DatabaseReadError, jamais « pas de blocage » par
 * défaut (avant, une panne de la base valait « pas bloqué »). */
export async function isBlockedEitherWay(fastify: FastifyInstance, userA: string, userB: string): Promise<boolean> {
  const [aBlocksB, bBlocksA] = await Promise.all([
    fastify.supabaseAdmin.from("blocks").select("blocker_id").eq("blocker_id", userA).eq("blocked_id", userB).maybeSingle(),
    fastify.supabaseAdmin.from("blocks").select("blocker_id").eq("blocker_id", userB).eq("blocked_id", userA).maybeSingle(),
  ]);
  if (aBlocksB.error || bBlocksA.error) throw new DatabaseReadError("Lecture des blocages impossible");
  return Boolean(aBlocksB.data || bBlocksA.data);
}

/** `followerId` suit-il `followeeId` ? Lecture impossible : DatabaseReadError
 * (jamais une réponse par défaut). */
export async function isFollowing(fastify: FastifyInstance, followerId: string, followeeId: string): Promise<boolean> {
  const { data, error } = await fastify.supabaseAdmin
    .from("follows")
    .select("follower_id")
    .eq("follower_id", followerId)
    .eq("followee_id", followeeId)
    .maybeSingle();
  if (error) throw new DatabaseReadError("Lecture des abonnements impossible");
  return Boolean(data);
}

/** Confidentialités qu'un visiteur peut voir chez un auteur (hors blocage,
 * à vérifier à part) : publique pour tous, « abonnés » pour ses abonnés,
 * privée pour personne d'autre que l'auteur. Compte privé (migration 0045) :
 * rien du tout pour qui n'est pas un abonné accepté — liste vide, et
 * l'appelant ne lit alors aucune publication. */
export function visiblePrivacies(isOwner: boolean, follows: boolean, isPrivate = false): PrivacyLevel[] {
  if (isOwner) return ["public", "followers", "private"];
  if (follows) return ["public", "followers"];
  return isPrivate ? [] : ["public"];
}

/** Publications montrables (lot 5, modération) : une publication masquée
 * disparaît partout — fil, profils, détail, liens partagés, commentaires,
 * « j'aime », pièces taguées — y compris pour son auteur, informé par une
 * notification. Seuls l'export de ses données et la modération la voient. */
export function shownPosts<Columns extends string>(fastify: FastifyInstance, columns: Columns, options?: { count: "exact"; head: true }) {
  return fastify.supabaseAdmin.from("posts").select(columns, options).is("hidden_at", null);
}

/** Une publication précise est-elle visible par ce visiteur ? À appeler sur
 * une publication lue avec `shownPosts` (jamais une publication masquée).
 * La règle est celle de lib/audience.ts (blocage, compte privé, abonnement) ;
 * une lecture impossible relève DatabaseReadError, jamais « visible ». */
export async function canViewPost(
  fastify: FastifyInstance,
  viewerId: string,
  post: { user_id: string; privacy: PrivacyLevel }
): Promise<boolean> {
  if (post.user_id === viewerId) return true;
  // Ni les suspensions ni les demandes en attente ne changent la réponse : non lues.
  return postVisibleTo(await readAudienceOf(fastify, viewerId, post.user_id, { suspended: false, requested: false }), post.privacy);
}

const postRefSchema = z.object({ id: z.guid(), user_id: z.guid(), privacy: z.enum(PRIVACY_LEVELS) });
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
