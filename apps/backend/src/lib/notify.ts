import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { NotificationType } from "@monapp/shared-types";
import { readAudienceOf } from "./audience.js";
import { findViewablePost } from "./visibility.js";

// Notifications de l'onglet Activité écrites par les membres (abonnement,
// « j'aime », commentaire, demande d'abonnement…) : UN seul endroit pour les
// règles communes, puis l'écriture.
//   - jamais à soi-même ;
//   - jamais entre deux comptes en blocage, dans un sens ou dans l'autre ;
//   - quand la notification parle d'une publication, jamais à un membre qui
//     ne peut pas voir cette publication MAINTENANT (masquée, compte passé en
//     privé, abonnement retiré…) : elle lui apprendrait qu'elle existe ;
//   - `oncePerPost` : au plus une notification de ce type, de cet auteur,
//     pour cette publication (aimer / ne plus aimer en boucle n'en crée qu'une).
// Une notification n'empêche jamais l'action qui la provoque : une règle non
// lisible ou une écriture refusée (par exemple un type que la base ne connaît
// pas encore) est journalisée, sans identifiant, et la fonction rend false.

/** Types écrits par cette fonction (ceux de la modération ont leurs propres chemins). */
export type MemberNotificationType = Exclude<NotificationType, "moderation" | "report_handled" | "piece_received">;

export interface NotifyInput {
  recipientId: string;
  actorId: string;
  type: MemberNotificationType;
  postId?: string;
  commentId?: string;
  oncePerPost?: boolean;
}

/** Écrit la notification si les règles le permettent. Rend true seulement
 * quand une ligne a été créée. Ne relève jamais d'erreur. */
export async function notify(fastify: FastifyInstance, log: FastifyBaseLogger, input: NotifyInput): Promise<boolean> {
  const { recipientId, actorId, type, postId, commentId } = input;
  if (recipientId === actorId) return false;
  try {
    const link = await readAudienceOf(fastify, recipientId, actorId, { suspended: false, requested: false });
    if (link.blocked) return false;
    if (postId !== undefined && (await findViewablePost(fastify, recipientId, postId)) === null) return false;

    const db = fastify.supabaseAdmin;
    if (input.oncePerPost && postId !== undefined) {
      const existing = await db.from("notifications").select("id").eq("user_id", recipientId).eq("type", type).eq("post_id", postId).eq("actor_id", actorId).limit(1);
      if (existing.error) {
        log.warn({ type }, "Notification non créée : lecture impossible");
        return false;
      }
      if (Array.isArray(existing.data) && existing.data.length > 0) return false;
    }
    const { error } = await db.from("notifications").insert({
      user_id: recipientId,
      actor_id: actorId,
      type,
      ...(postId !== undefined ? { post_id: postId } : {}),
      ...(commentId !== undefined ? { comment_id: commentId } : {}),
    });
    if (error) {
      log.warn({ type, code: (error as { code?: string }).code ?? null }, "Notification non créée : écriture refusée");
      return false;
    }
    return true;
  } catch {
    log.warn({ type }, "Notification non créée : règles illisibles");
    return false;
  }
}
