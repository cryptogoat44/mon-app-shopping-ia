// Corrections proposées sur l'écran Résultat (lot 4 ter). Avec des résultats :
// derrière un seul lien discret, « Ce n'est pas la bonne pièce ? ». Sans
// résultat : deux actions au plus, la plus utile d'abord. « Réessayer sans le
// texte » a été retiré au petit lot (décision du fondateur, 2026-10-25) : les
// mots ne partent plus avec l'image, il relancerait la même recherche.
// Logique pure, testée.
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

/** Ce que propose « Ce n'est pas la bonne pièce ? » sous des résultats. Prix
 * d'abord : la pièce cherchée peut être repliée tout en bas, sans prix (le
 * rang 1 de Google parfois) ; la voir est gratuit, alors que chaque
 * correction lance une nouvelle recherche, comptée. Ces propositions passent
 * donc en premier, dès que la section « Sans prix » n'est pas vide (relecture,
 * ORD-5). Sans correction possible (résultat rouvert), rien ne change : pas
 * de lien. */
export function successSheetActions(corrections: Correction[], withoutPriceCount: number): ("show_without_price" | Correction)[] {
  if (corrections.length === 0 || withoutPriceCount === 0) return corrections;
  return ["show_without_price", ...corrections];
}

const LIMIT_REASONS: readonly SpotFailReason[] = ["rate_limited", "capacity_day", "capacity_month", "capacity_user"];

/** Après une recherche sans résultat ou qui n'a pas abouti. */
export function failureCorrections(reason: SpotFailReason, context: CorrectionContext): Correction[] {
  // Limite atteinte (personne ou service entier) : rien à proposer, un nouvel essai serait refusé.
  if (LIMIT_REASONS.includes(reason)) return [];
  // Encore en cours : rien à corriger, une autre recherche serait payée pour rien (lot recherche coupée).
  if (reason === "running") return [];
  if (reason === "needs_photo" || !context.hasDraft) return context.fromLink ? ["add_video"] : [];
  // Panne : réessayer d'abord ; l'image reste la bonne.
  if (reason === "technical") return ["retry", context.hasVideo ? "choose_myself" : "reframe"];
  // Rien trouvé : une autre image vaut mieux qu'un nouvel essai à l'identique.
  if (!context.hasVideo) return ["reframe"];
  return [context.remainingMoments > 0 ? "try_another" : "reframe", "choose_myself"];
}
