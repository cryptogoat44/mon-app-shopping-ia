// « Boutique à l'étranger » (lot « premier essai ») : un prix dans une autre
// devise que celle du pays de la recherche. Aucune conversion (décision déjà
// prise) : la proposition est seulement signalée. Imports relatifs : fichier
// testé par vitest.

// Devise du pays, telle que Google Lens l'écrit (symbole ou code) : LA table
// de packages/shared-types (isCountryCurrency), la même que le serveur
// (services/lensMeasure.ts) et les alertes prix ; jamais une copie ici.
import { isCountryCurrency, searchCountryOfRegion } from "@monapp/shared-types";

/** Pays de la recherche visuelle, lu dans l'en-tête Accept-Language que l'app
 * envoie (i18n/index.ts), comme le fait le serveur (lib/locale.ts) : français
 * → France ; anglais → région de l'appareil si la recherche la prend en
 * charge (France, Royaume-Uni, Suisse, États-Unis : SEARCH_COUNTRIES), sinon
 * États-Unis. */
export function searchCountryFrom(acceptLanguage: string): string {
  const [language, region] = acceptLanguage.toLowerCase().split("-");
  if (language !== "en") return "fr";
  return searchCountryOfRegion(region);
}

/** Prix affiché dans une devise étrangère au pays de la recherche. Sans prix,
 * sans devise, ou pour un pays dont la devise n'est pas connue ici : rien à
 * signaler. La base complète la devise par des espaces (« €  », char(3)). */
export function isForeignPrice(price: number | null, currency: string | null, country: string): boolean {
  const code = currency?.trim();
  if (price === null || !code) return false;
  return isCountryCurrency(code, country) === false;
}
