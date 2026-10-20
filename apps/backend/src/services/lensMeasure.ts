// Mesure de chaque recherche visuelle (fiabilité des résultats, décision du
// fondateur du 2026-10-15) : des nombres et des valeurs d'une liste fermée,
// jamais d'image, de titre, d'adresse ni de texte. Rangée avec la recherche
// (migration 0025).
import type { VisualMatch } from "./visualSearch.js";

/** Rubriques de la réponse de Google Lens que la mesure relève (liste fermée,
 * d'après la documentation de SerpApi) ; toute autre rubrique compte comme « other ». */
export const LENS_SECTIONS = ["visual_matches", "related_content", "ai_overview", "organic_results"] as const;
export type LensSection = (typeof LENS_SECTIONS)[number] | "other";
// Présentes dans toute réponse, elles ne disent rien du résultat.
const TECHNICAL_KEYS = new Set(["search_metadata", "search_parameters", "search_information", "error"]);

export function sectionsOf(response: Record<string, unknown>): LensSection[] {
  const keys = Object.keys(response).filter((key) => !TECHNICAL_KEYS.has(key));
  const known = LENS_SECTIONS.filter((section) => keys.includes(section));
  const other = keys.some((key) => !(LENS_SECTIONS as readonly string[]).includes(key));
  return other ? [...known, "other"] : [...known];
}

/** État signalé par Google (« images_results_state ») : « empty » pour
 * « Fully empty », « other » pour toute autre valeur, null s'il n'en dit rien. */
export function googleStateOf(state: string | undefined): "empty" | "other" | null {
  if (state === undefined) return null;
  return /fully empty/i.test(state) ? "empty" : "other";
}

/** Ce que les filtres ont écarté (services/matchFilters.ts et visualSearch.ts). */
export interface FilterCounts {
  /** Sans titre, lien ou image, ou illisibles. */
  removedIncomplete: number;
  removedSocial: number;
  removedProfessional: number;
  /** Même page, ou même article sur le site d'un autre pays. */
  removedDuplicates: number;
}

export interface LensMeasure extends FilterCounts {
  /** Propositions renvoyées par Google Lens, lisibles ou non. */
  received: number;
  /** Gardées (30 au plus). */
  kept: number;
  keptWithPrice: number;
  /** Gardées avec un prix dans une autre devise que celle du pays ; null si
   * la devise du pays n'est pas connue ici. */
  keptOtherCurrency: number | null;
  distinctSites: number;
  sections: LensSection[];
  googleState: "empty" | "other" | null;
}

// Devise du pays de la recherche, telle que SerpApi l'écrit (symbole ou code).
const LOCAL_CURRENCIES: Record<string, readonly string[]> = {
  fr: ["€", "EUR"],
  us: ["$", "USD", "US$"],
  gb: ["£", "GBP"],
  ch: ["CHF"],
};

function siteOf(link: string): string | null {
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function measureLens(
  response: { received: number; sections: LensSection[]; googleState: "empty" | "other" | null },
  counts: FilterCounts,
  kept: VisualMatch[],
  country: string
): LensMeasure {
  const local = LOCAL_CURRENCIES[country];
  const priced = kept.filter((match) => match.priceValue !== null);
  return {
    ...counts,
    received: response.received,
    kept: kept.length,
    keptWithPrice: priced.length,
    keptOtherCurrency: local ? priced.filter((match) => match.currency !== null && !local.includes(match.currency)).length : null,
    distinctSites: new Set(kept.map((match) => siteOf(match.merchantUrl)).filter((site) => site !== null)).size,
    sections: response.sections,
    googleState: response.googleState,
  };
}
