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
  type ModerationPreview,
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

type HideableKind = Exclude<ModerationPreview["kind"], "user" | "missing">;

/** « Masquer … » et « Rétablir … » selon le contenu signalé. */
export function hideRestoreLabels(kind: HideableKind): { hide: string; restore: string } {
  const q = t.moderationQueue;
  const labels: Record<HideableKind, { hide: string; restore: string }> = {
    post: { hide: q.hidePost, restore: q.restorePost },
    comment: { hide: q.hideComment, restore: q.restoreComment },
    piece: { hide: q.hidePiece, restore: q.restorePiece },
    message: { hide: q.hideMessage, restore: q.restoreMessage },
    collection: { hide: q.hideCollection, restore: q.restoreCollection },
  };
  return labels[kind];
}

/** Lot modération des collections : ce que l'administrateur lit d'une
 * collection signalée — son nom, qui la voit, ses dernières envies (titre,
 * copie de l'image, « Image retirée »), et pour chacune encore en place le
 * libellé du bouton qui retire la copie. */
export function collectionPreviewView(preview: Extract<ModerationPreview, { kind: "collection" }>) {
  const q = t.moderationQueue;
  return {
    name: preview.name,
    visibility: q.collectionVisibility[preview.visibility],
    itemsTitle: preview.items.length > 0 ? q.collectionItems(preview.items.length, preview.itemCount) : q.collectionEmpty,
    items: preview.items.map((item) => ({
      id: item.id,
      title: item.title,
      imageUrl: item.imageUrl,
      removedLabel: item.imageRemoved ? q.imageRemoved : null,
      removeLabel: item.canRemoveImage ? q.removeItemImageLabel(item.title) : null,
    })),
  };
}

function noticeSentence({ action, targetType }: ModerationNotice): string {
  const comment = targetType === "comment";
  // Lot 5, partie B : l'image copiée d'une envie partagée ; lot modération
  // des collections : celle d'une envie d'une collection montrée aux amis.
  if (action === "remove_image") {
    if (targetType === "collection") return t.notifications.moderationImageRemovedCollection;
    return targetType === "piece" ? t.notifications.moderationImageRemovedPiece : t.notifications.moderationImageRemovedPost;
  }
  // Lot modération des collections : une collection montrée aux amis.
  if (targetType === "collection" && (action === "hide" || action === "restore")) {
    return action === "hide" ? t.notifications.moderationHiddenCollection : t.notifications.moderationRestoredCollection;
  }
  // Lot 5 : une pièce envoyée à une personne.
  if (targetType === "piece" && (action === "hide" || action === "restore")) {
    return action === "hide" ? t.notifications.moderationHiddenPiece : t.notifications.moderationRestoredPiece;
  }
  // Lot messages : un message envoyé.
  if (targetType === "message" && (action === "hide" || action === "restore")) {
    return action === "hide" ? t.notifications.moderationHiddenMessage : t.notifications.moderationRestoredMessage;
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
