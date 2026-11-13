import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EN_MESSAGES, localizeMessage } from "../src/lib/messages.js";
import { BRAND } from "../src/lib/brand.js";
import { COUNTRY_CURRENCIES, SEARCH_COUNTRIES } from "@monapp/shared-types";
import { requestLocale, searchLocaleFor } from "../src/lib/locale.js";
import { googleDomainFor } from "../src/services/serpapi.js";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

const withLanguage = (value?: string) => ({ headers: value ? { "accept-language": value } : {} });

describe("messages d'erreur en deux langues (lot 3)", () => {
  it("chaque message renvoyé par le serveur a sa traduction anglaise", () => {
    const missing: string[] = [];
    for (const file of sourceFiles(join(__dirname, "../src"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/message(?::|\s*=)\s*"([^"]+)"/g)) {
        if (!(match[1]! in EN_MESSAGES)) missing.push(`${file.split("/src/")[1]} : ${match[1]}`);
      }
      // Messages qui citent le nom du produit (lot « nom et identifiants
      // configurables ») : écrits `… ${BRAND} …`, jamais avec le nom en dur.
      for (const match of text.matchAll(/message(?::|\s*=)\s*`([^`]*\$\{BRAND\}[^`]*)`/g)) {
        const french = match[1]!.replaceAll("${BRAND}", BRAND);
        if (french.includes("${") || !(french in EN_MESSAGES)) missing.push(`${file.split("/src/")[1]} : ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("traduit en anglais, laisse le français tel quel", () => {
    expect(localizeMessage("Publication introuvable.", 404, "en")).toBe("Post not found.");
    expect(localizeMessage("Publication introuvable.", 404, "fr")).toBe("Publication introuvable.");
  });

  it("ne montre jamais un message technique inconnu", () => {
    expect(localizeMessage("String must contain at least 1 character(s)", 400, "fr")).toBe("Requête invalide.");
    expect(localizeMessage("String must contain at least 1 character(s)", 400, "en")).toBe("Invalid request.");
    expect(localizeMessage("connection refused", 500, "en")).toBe("Something went wrong.");
  });

  it("lit la langue de l'en-tête Accept-Language, français par défaut", () => {
    expect(requestLocale(withLanguage("en-GB"))).toBe("en");
    expect(requestLocale(withLanguage("en"))).toBe("en");
    expect(requestLocale(withLanguage("fr"))).toBe("fr");
    expect(requestLocale(withLanguage("de-DE,en;q=0.8"))).toBe("fr");
    expect(requestLocale(withLanguage())).toBe("fr");
  });

  it("choisit les paramètres de recherche visuelle (aucun appel SerpApi)", () => {
    expect(searchLocaleFor(withLanguage("fr-BE"))).toEqual({ hl: "fr", country: "fr" });
    expect(searchLocaleFor(withLanguage("en-GB"))).toEqual({ hl: "en", country: "gb" });
    expect(searchLocaleFor(withLanguage("en-419"))).toEqual({ hl: "en", country: "us" });
    expect(searchLocaleFor(withLanguage())).toEqual({ hl: "fr", country: "fr" });
  });

  // Revue de sécurité (entrees-08) : seuls les pays que la recherche prend
  // vraiment en charge ; toute autre région vaut les États-Unis.
  it("pays de la recherche : seulement la France, le Royaume-Uni, la Suisse et les États-Unis", () => {
    expect(searchLocaleFor(withLanguage("en-CH"))).toEqual({ hl: "en", country: "ch" });
    expect(searchLocaleFor(withLanguage("en-FR"))).toEqual({ hl: "en", country: "fr" });
    expect(searchLocaleFor(withLanguage("en-us"))).toEqual({ hl: "en", country: "us" });
    for (const header of ["en-NZ", "en-AU", "en-ZZ", "en-CA", "en-xx", "en-GBR", "en-G1"]) {
      expect(searchLocaleFor(withLanguage(header)), header).toEqual({ hl: "en", country: "us" });
    }
    // La liste est celle des pays dont la devise et le domaine de Google sont connus.
    expect([...SEARCH_COUNTRIES].sort()).toEqual(Object.keys(COUNTRY_CURRENCIES).sort());
    for (const country of SEARCH_COUNTRIES) expect(googleDomainFor(country), country).toMatch(/^google\./);
    expect(new Set(SEARCH_COUNTRIES.map((country) => googleDomainFor(country))).size).toBe(SEARCH_COUNTRIES.length);
  });
});
