// Réglages de Google Lens (SerpApi), sans dépendance : partagés par le
// serveur (visualSearch.ts) et par l'outil d'essai de l'étape 2 du lot 4 ter
// (scripts/essai-photo.ts), qui compare les réglages actuels et précédents.
//
// Comparée empiriquement à "type=all" (le comportement précédent) avant
// d'être adoptée : sur un cas de test réel, "products" a fait passer la
// part de résultats avec un vrai prix marchand de 16/60 à 20/60 et a
// éliminé tous les résultats de réseaux sociaux (11/60 → 0/60), à
// condition d'être combiné à la localisation ci-dessous — sans elle, le
// premier résultat était une mauvaise marque. Voir docs/journal-decisions.md,
// 2026-09-22.

export interface SearchLocale {
  /** Code pays à deux lettres (ex. "fr", "us") — paramètre `country` de SerpApi. */
  country: string;
  /** Code langue (ex. "fr", "en") — paramètre `hl` de SerpApi. */
  hl: string;
}

/** Réglages d'un appel à Google Lens. */
export interface LensSettings {
  /** "products" : seulement les résultats que Google classe « produit » (prix, lien marchand). */
  type: "products" | "all";
  /** null : sans localisation (comme avant le 2026-09-22). */
  locale: SearchLocale | null;
}

/** Localisation par défaut (français) ; la route de recherche transmet
 * celle de l'utilisateur — voir lib/locale.ts (lot 3). */
export const DEFAULT_LOCALE: SearchLocale = { country: "fr", hl: "fr" };

/** Réglages de l'app. */
export const CURRENT_LENS_SETTINGS: LensSettings = { type: "products", locale: DEFAULT_LOCALE };

/** Réglages d'avant le 2026-09-22 : type « all », sans localisation. */
export const PREVIOUS_LENS_SETTINGS: LensSettings = { type: "all", locale: null };
