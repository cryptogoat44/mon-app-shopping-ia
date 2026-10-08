// Corrections proposées sur l'écran Résultat (lot 4 ter). Avec des résultats :
// derrière un seul lien discret, « Ce n'est pas la bonne pièce ? ». Sans
// résultat : deux actions au plus, la plus utile d'abord — et, si des mots
// avaient été tapés, « Réessayer sans le texte » (décision du fondateur,
// 2026-10-08 : jamais automatique, un crédit à l'initiative de la personne).
// Logique pure, testée.
import type { SpotFailReason } from "../api/types";

export type Correction = "reframe" | "try_another" | "choose_myself" | "retry" | "retry_without_text" | "add_video";

export interface CorrectionContext {
  /** Image de la recherche encore en mémoire : elle peut être recadrée. */
  hasDraft: boolean;
  /** Vidéo encore ouverte : autres moments, choix de l'image au curseur. */
  hasVideo: boolean;
  /** Moments proposés par l'IA, pas encore essayés. */
  remainingMoments: number;
  /** Ancienne recherche par lien (analyse de la couverture, désactivée). */
  fromLink: boolean;
  /** Des mots avaient été tapés (« Que cherchez-vous ? ») pour cette recherche. */
  hadQuery: boolean;
}

/** Sous des résultats ; liste vide : rien à proposer, aucun lien affiché
 * (résultat rouvert depuis « Récemment spottées », par exemple). */
export function successCorrections(context: CorrectionContext): Correction[] {
  const list: Correction[] = [];
  if (context.hasDraft) list.push("reframe");
  if (context.hasVideo && context.remainingMoments > 0) list.push("try_another");
  if (context.hasVideo) list.push("choose_myself");
  return list.length === 0 && context.fromLink ? ["add_video"] : list;
}

const LIMIT_REASONS: readonly SpotFailReason[] = ["rate_limited", "capacity_day", "capacity_month", "capacity_user"];

/** Après une recherche sans résultat ou qui n'a pas abouti. */
export function failureCorrections(reason: SpotFailReason, context: CorrectionContext): Correction[] {
  // Limite atteinte (personne ou service entier) : rien à proposer, un nouvel essai serait refusé.
  if (LIMIT_REASONS.includes(reason)) return [];
  if (reason === "needs_photo" || !context.hasDraft) return context.fromLink ? ["add_video"] : [];
  // Panne : réessayer d'abord ; l'image reste la bonne.
  if (reason === "technical") return ["retry", context.hasVideo ? "choose_myself" : "reframe"];
  // Rien trouvé : une autre image vaut mieux qu'un nouvel essai à l'identique ;
  // si des mots avaient été tapés, la même image sans eux.
  const withoutText: Correction[] = context.hadQuery ? ["retry_without_text"] : [];
  if (!context.hasVideo) return ["reframe", ...withoutText];
  return [context.remainingMoments > 0 ? "try_another" : "reframe", ...withoutText, "choose_myself"];
}
