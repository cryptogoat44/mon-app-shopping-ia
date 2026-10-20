// Réglages de Google Lens (SerpApi), sans dépendance : partagés par le
// serveur (visualSearch.ts) et par l'outil d'essai de l'étape 2 du lot 4 ter
// (scripts/essai-photo.ts), qui compare les réglages actuels et précédents.
//
// Historique :
// - 2026-09-22 : "products" adopté, comparé à "type=all" sur un cas réel (part
//   de résultats avec un vrai prix marchand de 16/60 à 20/60, réseaux sociaux
//   de 11/60 à 0/60), avec la localisation ci-dessous — sans elle, le premier
//   résultat était une mauvaise marque (docs/journal-decisions.md) ;
// - 2026-10-09 : SerpApi abandonne "products", Google ayant retiré cet onglet
//   de Google Lens : « Requests using it now return an error » ;
// - 2026-10-21 : "visual_matches" retenu par le fondateur. D'après la
//   documentation de SerpApi, il renvoie les mêmes champs (titre, lien,
//   marchand, prix, image) et accepte le texte ; il n'écarte plus lui-même les
//   réseaux sociaux : les filtres du serveur le font (services/matchFilters.ts).

export interface SearchLocale {
  /** Code pays à deux lettres (ex. "fr", "us") — paramètre `country` de SerpApi. */
  country: string;
  /** Code langue (ex. "fr", "en") — paramètre `hl` de SerpApi. */
  hl: string;
}

/** Réglages d'un appel à Google Lens. */
export interface LensSettings {
  /** "products" : seulement les résultats que Google classe « produit » (prix, lien
   * marchand) — ABANDONNÉ par SerpApi le 2026-10-09 (« Requests using it now return
   * an error ») ; "visual_matches" : la rubrique des correspondances visuelles, mêmes
   * champs ; "all" : toutes les rubriques. */
  type: "products" | "visual_matches" | "all";
  /** null : sans localisation (comme avant le 2026-09-22). */
  locale: SearchLocale | null;
}

/** Localisation par défaut (français) ; la route de recherche transmet
 * celle de l'utilisateur — voir lib/locale.ts (lot 3). */
export const DEFAULT_LOCALE: SearchLocale = { country: "fr", hl: "fr" };

/** Réglages de l'app. */
export const CURRENT_LENS_SETTINGS: LensSettings = { type: "visual_matches", locale: DEFAULT_LOCALE };

/** Réglages d'avant le 2026-09-22 : type « all », sans localisation. */
export const PREVIOUS_LENS_SETTINGS: LensSettings = { type: "all", locale: null };
