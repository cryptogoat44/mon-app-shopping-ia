import type { FastifyRequest } from "fastify";
import type { SearchLocale } from "../services/visualSearch.js";

// Langue de l'utilisateur, transmise par l'app dans l'en-tête Accept-Language
// (lot 3) : « fr », « en » ou « en-GB » (langue du profil, suivie de la région
// de l'appareil pour l'anglais). Sans en-tête exploitable : français.

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
 * fourni, sinon les États-Unis. */
export function searchLocaleFor(request: Pick<FastifyRequest, "headers">): SearchLocale {
  if (requestLocale(request) === "fr") return { hl: "fr", country: "fr" };
  const region = firstTag(request).split("-")[1]?.toLowerCase();
  return { hl: "en", country: region && /^[a-z]{2}$/.test(region) ? region : "us" };
}
