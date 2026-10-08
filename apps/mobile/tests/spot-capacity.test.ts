import { afterEach, describe, expect, it } from "vitest";
import { parseSearchCapacityError } from "@monapp/shared-types";
import { setActiveLocale } from "../src/i18n";
import { capacityCopy } from "../src/lib/spot-capacity";

// Lot 4 quater : plafond global des recherches. Réponse du serveur lue sans
// lui faire confiance ; textes honnêtes (« demain » seulement pour le jour).

afterEach(() => setActiveLocale("fr"));

describe("réponse « plafond atteint » du serveur", () => {
  it("lit le motif et la date de reprise ; tout le reste est ignoré", () => {
    expect(parseSearchCapacityError({ error: "search_capacity_day", message: "…", retryAt: "2026-10-09T22:00:00.000Z" })).toEqual({
      period: "day",
      retryAt: "2026-10-09T22:00:00.000Z",
    });
    expect(parseSearchCapacityError({ error: "search_capacity_month", message: "…", retryAt: null })).toEqual({ period: "month", retryAt: null });
    expect(parseSearchCapacityError({ error: "search_capacity_month", retryAt: "pas une date" })).toEqual({ period: "month", retryAt: null });
    expect(parseSearchCapacityError({ error: "rate_limited", message: "…" })).toBeNull();
    expect(parseSearchCapacityError("search_capacity_day")).toBeNull();
    expect(parseSearchCapacityError(null)).toBeNull();
  });
});

describe("texte de l'écran Résultat", () => {
  it("plafond du jour : le texte du fondateur", () => {
    expect(capacityCopy({ period: "day", retryAt: "2026-10-09T22:00:00.000Z" })).toEqual([
      "Le service de recherche est très sollicité aujourd'hui.",
      "Réessayez demain.",
    ]);
  });

  it("plafond des 31 jours : la date de reprise, jamais « demain » ; sans date, rien de plus que ce qui est sûr", () => {
    expect(capacityCopy({ period: "month", retryAt: "2026-11-12T10:31:00.000Z" })).toEqual([
      "Le service de recherche a atteint sa limite mensuelle.",
      "Réessayez à partir du 12 novembre 2026.",
    ]);
    expect(capacityCopy({ period: "month", retryAt: null })).toEqual(["Le service de recherche a atteint sa limite mensuelle.", "Réessayez plus tard."]);
    expect(capacityCopy(undefined)).toEqual(["Le service de recherche est très sollicité aujourd'hui.", "Réessayez plus tard."]);
  });

  it("en anglais si l'app est en anglais", () => {
    setActiveLocale("en");
    expect(capacityCopy({ period: "day", retryAt: null })).toEqual(["The search service is in very high demand today.", "Please try again tomorrow."]);
    expect(capacityCopy({ period: "month", retryAt: "2026-11-12T10:31:00.000Z" })[1]).toBe("Please try again from November 12, 2026.");
  });
});
