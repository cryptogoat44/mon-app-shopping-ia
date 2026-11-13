import type { FastifyRequest } from "fastify";
import { searchCountryOfRegion } from "@monapp/shared-types";
import type { SearchLocale } from "../services/lensSettings.js";

// Langue de l'utilisateur, transmise par l'app dans l'en-tête Accept-Language
// (lot 3) : « fr », « en » ou « en-GB » (langue choisie dans l'app sur cet
// appareil — pas celle enregistrée dans le profil —, suivie de la région de
// l'appareil pour l'anglais). Sans en-tête exploitable : français.

export type Locale = "fr" | "en";

function firstTag(request: Pick<FastifyRequest, "headers">): string {
  const header = request.headers["accept-language"];
  return (Array.isArray(header) ? header[0] : header)?.split(",")[0]?.split(";")[0]?.trim() ?? "";
}

export function requestLocale(request: Pick<FastifyRequest, "headers">): Locale {
  const language = firstTag(request).toLowerCase().split("-")[0];
  return language === "en" ? "en" : "fr";
}

/** Paramètres hl et country de la recherche visuelle. Français : toujours
 * fr/fr (réglage validé au Lot S). Anglais : pays de l'appareil s'il est
 * l'un des pays pris en charge (SEARCH_COUNTRIES : France, Royaume-Uni,
 * Suisse, États-Unis), sinon les États-Unis. Revue de sécurité (lot
 * « durcissement des alertes ») : avant, n'importe quelles deux lettres
 * (« en-NZ ») devenaient le pays de la recherche, et celui des observations
 * de prix des alertes. */
export function searchLocaleFor(request: Pick<FastifyRequest, "headers">): SearchLocale {
  if (requestLocale(request) === "fr") return { hl: "fr", country: "fr" };
  return { hl: "en", country: searchCountryOfRegion(firstTag(request).split("-")[1]) };
}
