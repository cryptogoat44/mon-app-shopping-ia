// Bouton « Résultat incohérent » (fiabilité des résultats, 2026-10-15) :
// libellés lus dans la langue active AU MOMENT DE L'APPEL (voir
// moderation-labels.ts), et message d'erreur à montrer.
import { MATCH_FEEDBACK_REASONS, type MatchFeedbackReason } from "@monapp/shared-types";
import { t } from "../i18n";
import { ApiError } from "./api-error";

export function feedbackReasonLabel(reason: MatchFeedbackReason): string {
  return t.result.feedbackReasons[reason];
}

/** Les cinq motifs, dans l'ordre de l'écran, avec leur libellé du moment. */
export function feedbackReasonChoices(): { reason: MatchFeedbackReason; label: string }[] {
  return MATCH_FEEDBACK_REASONS.map((reason) => ({ reason, label: feedbackReasonLabel(reason) }));
}

/** Refus du serveur (limite du jour, proposition introuvable) : son message,
 * déjà dans la langue de l'app. Panne ou connexion : le texte de repli. */
export function feedbackErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.status < 500 ? error.message : fallback;
}
