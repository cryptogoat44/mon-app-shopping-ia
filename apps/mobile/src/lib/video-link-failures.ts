// Lot « vidéo auto » : ce qui peut empêcher l'analyse d'une vidéo à partir de
// son lien. Liste à part, sans dépendance : les statistiques d'usage
// (analytics-events.ts, catalogue fermé) n'acceptent que ces valeurs.
// Imports relatifs : fichier testé par vitest.
export const LINK_AI_FAILURES = [
  // L'accord « analyse_video_ia » est à (re)demander.
  "consent",
  "disabled",
  "invalid_link",
  "invalid_query",
  "unavailable",
  // Vidéo privée, réservée à certains comptes ou supprimée (lot « recherche confiance » : supprimée aussi).
  "private",
  // TikTok ou Instagram a refusé la demande du service vidéo (connexion exigée, accès bloqué).
  "refused",
  "too_long",
  "timeout",
  "busy",
  "no_moment",
  "user_limit",
  "global_limit",
  // Plafond des recherches du Spotter (recherche d'image) atteint.
  "search_limit",
  "rate_limited",
  "network",
] as const;

/** Chaque échec a son message, et la capture d'écran reste toujours proposée. */
export type LinkAiFailure = (typeof LINK_AI_FAILURES)[number];
