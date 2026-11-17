// Lien vidéo sans prix (décision du fondateur du 17 novembre 2026,
// « Automatique (Recommandé) ») : pour une recherche partie d'un moment d'une
// vidéo TikTok ou Instagram, quand rien n'affiche de prix, l'écran Résultat
// lance de lui-même la recherche « Que cherchez-vous ? » avec la description
// tapée par la personne — la même que le bouton « Chercher » — sans aucun
// geste (1 crédit SerpApi de plus, dans les limites existantes).
// - Jamais pour une photo ni une vidéo du téléphone : seulement un brouillon
//   marqué par video-link-run.ts (textSearchIfNoPrice).
// - Seulement sur le résultat qui vient d'être calculé (son brouillon est
//   encore en mémoire) : jamais rouvert depuis l'historique, après un
//   rechargement de la page, ni sur un second écran Résultat.
// - Après l'issue de la recherche visuelle ET des boutiques (jamais pendant
//   leur attente) ; voie C coupée (complément absent) ou plafond atteint
//   pour les boutiques (« no_capacity ») : rien n'est tenté.
// - Aucune proposition, nulle part, avec un prix — boutiques arrivées après
//   le premier affichage comprises : un seul prix, et rien n'est dépensé.
// - Une seule fois par recherche dans la session (claimAutoTextSearch) ; le
//   serveur, lui, ne la fait qu'une fois quoi qu'il arrive (text_requested_at).
// Logique pure, testée. Imports relatifs : fichier testé par vitest.
import type { SpotResult } from "../api/types";
import { noPriceAnywhere } from "./price-first";
import { allPieces } from "./result-sections";
import type { SpotDraft } from "./spot-draft";

/** Les mots de la recherche automatique : la description gardée dans le
 * brouillon d'un lien vidéo, pour le résultat qui vient d'être calculé
 * (`fromLaunch`). null : rien ne partira de soi-même. */
export function autoTextSearchWords(fromLaunch: boolean, draft: SpotDraft | null): string | null {
  if (!fromLaunch || draft?.textSearchIfNoPrice !== true) return null;
  return draft.words?.trim() || null;
}

/** Aucune proposition de l'écran n'a de prix. noPriceAnywhere, sur toutes
 * les propositions : contrairement à l'affichage (où des boutiques arrivées
 * tard ne replient rien), un prix arrivé tard compte ici. */
export function noPriceAtAll(result: Pick<SpotResult, "pieces" | "complement">): boolean {
  return noPriceAnywhere({ pieces: allPieces(result) });
}

/** Le résultat appelle-t-il la recherche automatique maintenant ? Terminé
 * (ou « rien trouvé », jamais une panne ni un plafond), boutiques plus
 * attendues, recherche avec les mots pas encore faite, et aucun prix. */
export function autoTextSearchDue(result: SpotResult | null): boolean {
  if (!result?.searchId || !result.complement) return false;
  if (result.status === "failed" && result.failReason !== "no_match") return false;
  if (result.complement.pending) return false;
  // Plafond ou limite atteints pour les boutiques : le serveur refuserait, rien n'est tenté.
  if (result.complement.status === "no_capacity") return false;
  if (result.complement.textStatus != null || result.complement.words.length > 0) return false;
  return noPriceAtAll(result);
}

// Recherches déjà lancées d'elles-mêmes dans la session (50 au plus en mémoire).
const claimed = new Set<string>();
const CLAIMED_MAX = 50;

/** Une seule fois par recherche, quoi qu'il arrive à l'écran (nouveau rendu,
 * écran retiré puis rouvert, second écran Résultat) : true la première fois
 * seulement — c'est alors à l'appelant de la lancer. */
export function claimAutoTextSearch(searchId: string): boolean {
  if (claimed.has(searchId)) return false;
  claimed.add(searchId);
  if (claimed.size > CLAIMED_MAX) {
    const oldest = claimed.values().next().value;
    if (oldest !== undefined) claimed.delete(oldest);
  }
  return true;
}

/** Tests seulement : oublie les recherches déjà lancées. */
export function forgetAutoTextSearches(): void {
  claimed.clear();
}
