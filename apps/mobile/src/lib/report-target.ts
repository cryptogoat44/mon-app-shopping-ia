// Ce que signale le menu « Signaler / Bloquer » (components/report-block-menu.tsx),
// sans écran : testé à part. Un profil, une publication, un commentaire
// (lot F), une pièce reçue (lot 5), un message reçu (lot messages) ou la
// collection d'un ami (lot modération des collections).
import type { CreateReportRequest, ReportReason } from "@monapp/shared-types";
import { t } from "../i18n";

export interface ReportTarget {
  /** Le compte concerné (auteur du contenu, ou le profil lui-même). */
  userId: string;
  postId?: string;
  commentId?: string;
  pieceId?: string;
  messageId?: string;
  collectionId?: string;
}

/** La demande envoyée au serveur (POST /api/reports). */
export function reportRequest(target: ReportTarget, reason: ReportReason): CreateReportRequest {
  const { collectionId, messageId, commentId, pieceId, postId, userId } = target;
  if (collectionId) return { targetType: "collection", targetId: collectionId, reason };
  if (messageId) return { targetType: "message", targetId: messageId, reason };
  if (commentId) return { targetType: "comment", targetId: commentId, reason };
  if (pieceId) return { targetType: "piece", targetId: pieceId, reason };
  return { targetType: postId ? "post" : "user", targetId: postId ?? userId, reason };
}

/** Libellé de l'entrée « Signaler… » du menu. */
export function reportMenuLabel(target: ReportTarget): string {
  if (target.collectionId) return t.collections.report;
  if (target.messageId) return t.messages.reportMessage;
  if (target.pieceId) return t.received.report;
  if (target.postId) return t.moderation.reportPost;
  return t.moderation.reportUser;
}

/** Un contenu (pas un profil) : signalé, il ne vous est plus montré. */
export function isContentReport(target: ReportTarget): boolean {
  return Boolean(target.collectionId || target.messageId || target.commentId || target.pieceId || target.postId);
}
