// Préférences d'affichage de l'appareil (lot 3) : langue et apparence.
// Fonctions pures, testées. Imports de types seulement : fichier testé par vitest.
import type { ColorScheme } from "../theme/tokens";

export const LOCALES = ["fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const LOCALE_STORAGE_KEY = "spotto.langue";
export const THEME_STORAGE_KEY = "spotto.apparence";

export function parseLocale(value: unknown): Locale | null {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value) ? (value as Locale) : null;
}

export function parseThemePreference(value: unknown): ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value)
    ? (value as ThemePreference)
    : "system";
}

/** Langue de l'appareil si elle est prise en charge (la première de la liste), sinon l'anglais. */
export function detectLocale(deviceLanguages: readonly (string | null | undefined)[]): Locale {
  const first = deviceLanguages.find((code) => typeof code === "string" && code.length > 0);
  return parseLocale(first?.toLowerCase().split(/[-_]/)[0]) ?? "en";
}

/** Thème effectif : « Système » suit l'appareil (clair si l'appareil ne dit rien). */
export function resolveScheme(preference: ThemePreference, system: string | null | undefined): ColorScheme {
  if (preference === "light" || preference === "dark") return preference;
  return system === "dark" ? "dark" : "light";
}
