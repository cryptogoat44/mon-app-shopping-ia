// Corrections proposées sur l'écran Résultat (lot 4 ter). Avec des résultats :
// derrière un seul lien discret, « Ce n'est pas la bonne pièce ? ». Sans
// résultat : deux actions au plus, la plus utile d'abord. Logique pure, testée.
import type { SpotFailReason } from "../api/types";

export type Correction = "reframe" | "try_another" | "choose_myself" | "retry" | "add_video";

export interface CorrectionContext {
  /** Image de la recherche encore en mémoire : elle peut être recadrée. */
  hasDraft: boolean;
  /** Vidéo encore ouverte : autres moments, choix de l'image au curseur. */
  hasVideo: boolean;
  /** Moments proposés par l'IA, pas encore essayés. */
  remainingMoments: number;
  /** Ancienne recherche par lien (analyse de la couverture, désactivée). */
  fromLink: boolean;
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

/** Après une recherche sans résultat ou qui n'a pas abouti. */
export function failureCorrections(reason: SpotFailReason, context: CorrectionContext): Correction[] {
  if (reason === "rate_limited") return [];
  if (reason === "needs_photo" || !context.hasDraft) return context.fromLink ? ["add_video"] : [];
  // Panne : réessayer d'abord ; l'image reste la bonne.
  if (reason === "technical") return ["retry", context.hasVideo ? "choose_myself" : "reframe"];
  // Rien trouvé : une autre image vaut mieux qu'un nouvel essai à l'identique.
  if (!context.hasVideo) return ["reframe"];
  return [context.remainingMoments > 0 ? "try_another" : "reframe", "choose_myself"];
}
