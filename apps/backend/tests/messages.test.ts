import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EN_MESSAGES, localizeMessage } from "../src/lib/messages.js";
import { requestLocale, searchLocaleFor } from "../src/lib/locale.js";

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
});
