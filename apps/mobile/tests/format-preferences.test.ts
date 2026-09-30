import { describe, expect, it } from "vitest";
import { formatLongDate, formatPrice, timeAgo } from "../src/lib/format";
import { detectLocale, parseLocale, parseThemePreference, resolveScheme } from "../src/lib/preferences";

// Espaces insécables des formats français ramenés à des espaces simples.
const plain = (text: string) => text.replace(/[  ]/g, " ");

describe("formats selon la langue (lot 3)", () => {
  it("écrit les dates longues dans la langue choisie", () => {
    expect(formatLongDate("2026-09-25", "fr")).toBe("25 septembre 2026");
    expect(formatLongDate("2026-09-25", "en")).toBe("September 25, 2026");
  });

  it("formate un prix sans jamais convertir la devise", () => {
    expect(plain(formatPrice(1250, "EUR", "fr"))).toBe("1 250 €");
    expect(formatPrice(1250, "EUR", "en")).toBe("€1,250");
    expect(plain(formatPrice(89.5, "USD", "fr"))).toBe("89,50 $US");
    expect(formatPrice(89.5, "USD", "en")).toBe("$89.50");
    expect(formatPrice(40, null, "en")).toBe("40");
    expect(plain(formatPrice(40, "eur?", "fr"))).toBe("40 eur?");
  });

  it("dit depuis combien de temps", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    expect(timeAgo("2026-09-30T11:59:30Z", "fr", now)).toBe("à l'instant");
    expect(timeAgo("2026-09-30T11:55:00Z", "en", now)).toBe("5 min ago");
    expect(timeAgo("2026-09-30T09:00:00Z", "fr", now)).toBe("il y a 3 h");
    expect(timeAgo("2026-09-29T12:00:00Z", "en", now)).toBe("1 day ago");
    expect(timeAgo("2026-09-27T12:00:00Z", "en", now)).toBe("3 days ago");
  });
});

describe("préférences de l'appareil (lot 3)", () => {
  it("prend la langue de l'appareil si elle est prise en charge, sinon l'anglais", () => {
    expect(detectLocale(["fr-FR", "en-US"])).toBe("fr");
    expect(detectLocale(["fr_CA"])).toBe("fr");
    expect(detectLocale(["en-US", "fr-FR"])).toBe("en");
    expect(detectLocale(["de-DE", "fr-FR"])).toBe("en");
    expect(detectLocale([null, undefined])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });

  it("n'accepte que les valeurs connues", () => {
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale("de")).toBeNull();
    expect(parseLocale(null)).toBeNull();
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("noir")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
  });

  it("« Système » suit l'appareil, le choix explicite l'emporte", () => {
    expect(resolveScheme("system", "dark")).toBe("dark");
    expect(resolveScheme("system", null)).toBe("light");
    expect(resolveScheme("light", "dark")).toBe("light");
    expect(resolveScheme("dark", "light")).toBe("dark");
  });
});
