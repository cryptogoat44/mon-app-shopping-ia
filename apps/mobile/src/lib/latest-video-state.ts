// Dernière vidéo de la galerie (app iPhone) : une OPTION, jamais le parcours
// par défaut (décision du fondateur, 2026-10-07). Par défaut, la vidéo se
// choisit avec le sélecteur d'iOS, qui ne demande aucune autorisation. La
// proposition automatique n'est faite qu'à qui répond « oui » à la question
// posée une fois sur Spotter (ou l'active dans Réglages) ; il faut ensuite
// l'accès COMPLET aux photos — accès limité ou refus : retour au sélecteur.
// Logique pure ici (testée) ; lecture de la galerie : latest-video.ts.

export interface LatestVideo {
  /** Identifiant dans la photothèque (« ph://… ») ; il sert aussi d'aperçu (expo-image). */
  id: string;
  durationMs: number | null;
}

/** Réponse à « Proposer automatiquement ma dernière vidéo ? », gardée sur l'appareil, par compte. */
export type LatestVideoChoice = "yes" | "no";

/** Accès de Spotto aux photos, selon iOS. */
export type GalleryAccess = "full" | "limited" | "denied" | "undetermined";

/** Ce que Spotter montre. */
export type LatestVideoState =
  /** Site, ou réponse « Non merci » : le sélecteur seulement. */
  | { kind: "off" }
  /** Pas encore de réponse : la question. */
  | { kind: "ask" }
  /** « Oui », mais sans l'accès complet : le sélecteur. */
  | { kind: "no_access"; access: "limited" | "denied" }
  /** Accès complet, mais aucune vidéo dans la galerie. */
  | { kind: "none" }
  | { kind: "ready"; video: LatestVideo };

export function latestVideoChoiceKey(userId: string): string {
  return `spotto.latest-video-choice.${userId}`;
}

export function parseLatestVideoChoice(value: string | null): LatestVideoChoice | null {
  return value === "yes" || value === "no" ? value : null;
}

/** Réponse d'iOS → accès. Seul « all » est un accès complet ; un accès
 * accordé sans précision est traité comme limité (par prudence). */
export function galleryAccessFrom(permission: { status: string; granted: boolean; accessPrivileges?: "all" | "limited" | "none" }): GalleryAccess {
  if (permission.granted) return permission.accessPrivileges === "all" ? "full" : "limited";
  return permission.status === "undetermined" ? "undetermined" : "denied";
}
