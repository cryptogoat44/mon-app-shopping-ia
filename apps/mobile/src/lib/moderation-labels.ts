// Libellés de la modération (lot 5), lus dans la langue active AU MOMENT DE
// L'APPEL. Un tableau calculé au chargement d'un module reste dans la langue
// de démarrage : c'était le cas des motifs du menu de signalement, restés en
// français après le passage à l'anglais (corrigé, voir tests).
import {
  REPORT_REASONS,
  type AppNotification,
  type ModerationActionType,
  type ModerationItem,
  type ModerationNotice,
  type ModerationReason,
  type ReportReason,
} from "@monapp/shared-types";
import { t } from "../i18n";

/** Le motif le plus signalé d'un contenu (le premier de la liste en cas d'égalité) : choix proposé par défaut. */
export function mostReportedReason(reasons: ModerationItem["reasons"]): ReportReason {
  return REPORT_REASONS.reduce((best, reason) => ((reasons[reason] ?? 0) > (reasons[best] ?? 0) ? reason : best), REPORT_REASONS[0]);
}

/** « Spam × 2 · Harcèlement × 1 », dans l'ordre de la liste des motifs. */
export function reasonsSummary(reasons: ModerationItem["reasons"]): string {
  return REPORT_REASONS.filter((reason) => (reasons[reason] ?? 0) > 0)
    .map((reason) => `${reportReasonLabel(reason)} × ${reasons[reason] ?? 0}`)
    .join(" · ");
}

export function reportReasonLabel(reason: ReportReason): string {
  const labels: Record<ReportReason, string> = {
    spam: t.moderation.reasonSpam,
    inappropriate: t.moderation.reasonInappropriate,
    harassment: t.moderation.reasonHarassment,
    other: t.moderation.reasonOther,
  };
  return labels[reason];
}

/** Motif d'une décision : celui d'un signalement, ou le motif neutre du
 * retrait d'une image copiée (lot 5, partie B). */
export function moderationReasonLabel(reason: ModerationReason): string {
  return reason === "image_rights" ? t.moderation.reasonImageRights : reportReasonLabel(reason);
}

export function moderationActionLabel(action: ModerationActionType): string {
  return t.moderationQueue.actions[action];
}

function noticeSentence({ action, targetType }: ModerationNotice): string {
  const comment = targetType === "comment";
  // Lot 5, partie B : l'image copiée d'une envie partagée.
  if (action === "remove_image") {
    return targetType === "piece" ? t.notifications.moderationImageRemovedPiece : t.notifications.moderationImageRemovedPost;
  }
  // Lot 5 : une pièce envoyée à une personne.
  if (targetType === "piece" && (action === "hide" || action === "restore")) {
    return action === "hide" ? t.notifications.moderationHiddenPiece : t.notifications.moderationRestoredPiece;
  }
  switch (action) {
    case "hide":
      return comment ? t.notifications.moderationHiddenComment : t.notifications.moderationHiddenPost;
    case "restore":
      return comment ? t.notifications.moderationRestoredComment : t.notifications.moderationRestoredPost;
    case "suspend":
      return t.notifications.moderationSuspended;
    case "unsuspend":
      return t.notifications.moderationUnsuspended;
    default:
      return t.notifications.moderationOther;
  }
}

/** Ce que lit la personne concernée : la décision, son motif et la précision
 * éventuelle — jamais qui l'a prise. */
export function moderationNoticeLines(notice: ModerationNotice | null): string[] {
  if (!notice) return [t.notifications.moderationOther];
  const lines = [noticeSentence(notice)];
  if (notice.reason) lines.push(t.notifications.moderationReason(moderationReasonLabel(notice.reason)));
  if (notice.note) lines.push(t.notifications.moderationNote(t.common.quoted(notice.note)));
  return lines;
}

/** Notification sans auteur (modération, signalement traité) : ses lignes de texte ; null pour les autres. */
export function systemNotificationLines(notification: AppNotification): string[] | null {
  if (notification.type === "report_handled") {
    return [notification.reportedType ? t.notifications.reportHandledAbout[notification.reportedType] : t.notifications.reportHandled];
  }
  if (notification.type === "moderation") return moderationNoticeLines(notification.moderation);
  return null;
}
