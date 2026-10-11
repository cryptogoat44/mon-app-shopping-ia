import { afterEach, describe, expect, it } from "vitest";
import { parseSearchCapacityError } from "@monapp/shared-types";
import { en } from "../src/i18n/en";
import { fr } from "../src/i18n/fr";
import { setActiveLocale } from "../src/i18n";
import { capacityFailure, capacityMonthTip } from "../src/lib/spot-capacity";

// Lot 4 quater : plafond des recherches (jour et mois pour tout le service,
// part de la personne). Réponse du serveur lue sans lui faire confiance ;
// textes du fondateur (2026-10-08) ; pour le mois, la date du prochain
// renouvellement de SerpApi, dans la langue de l'app (décision du 2026-10-11).

afterEach(() => setActiveLocale("fr"));

describe("réponse « plafond atteint » du serveur", () => {
  it("lit le plafond en cause, et pour le mois seulement une vraie date de reprise ; le reste n'en est pas un", () => {
    expect(parseSearchCapacityError({ error: "search_capacity_month", message: "…", resumesOn: "2026-11-03" })).toEqual({ limit: "month", resumesOn: "2026-11-03" });
    expect(parseSearchCapacityError({ error: "search_capacity_month", resumesOn: "2026-02-30" })).toEqual({ limit: "month", resumesOn: null });
    expect(parseSearchCapacityError({ error: "search_capacity_month", resumesOn: "3 novembre" })).toEqual({ limit: "month", resumesOn: null });
    expect(parseSearchCapacityError({ error: "search_capacity_day", resumesOn: "2026-11-03" })).toEqual({ limit: "day", resumesOn: null });
    expect(parseSearchCapacityError({ error: "search_capacity_user", message: "…" })).toEqual({ limit: "user", resumesOn: null });
    expect(parseSearchCapacityError({ error: "rate_limited", message: "…" })).toBeNull();
    expect(parseSearchCapacityError("search_capacity_day")).toBeNull();
    expect(parseSearchCapacityError(null)).toBeNull();
  });

  it("donne le motif d'échec de l'écran Résultat", () => {
    expect(capacityFailure({ error: "search_capacity_month", resumesOn: "2026-11-03" })).toEqual({ reason: "capacity_month", resumesOn: "2026-11-03" });
    expect(capacityFailure({ error: "search_capacity_user" })).toEqual({ reason: "capacity_user", resumesOn: null });
    expect(capacityFailure({ error: "rate_limited" })).toBeNull();
  });
});

describe("textes de l'écran Résultat (décisions du fondateur)", () => {
  it("mois : « Réessayez à partir du 3 novembre. », « 1er » le premier du mois ; en anglais « from November 3 »", () => {
    expect(capacityMonthTip("2026-11-03", "fr")).toBe("Réessayez à partir du 3 novembre.");
    expect(capacityMonthTip("2026-12-01", "fr")).toBe("Réessayez à partir du 1er décembre.");
    setActiveLocale("en");
    expect(capacityMonthTip("2026-11-03", "en")).toBe("Please try again from November 3.");
    expect(capacityMonthTip("2026-12-01", "en")).toBe("Please try again from December 1.");
  });

  it("mois sans date connue : « Réessayez dans quelques jours. »", () => {
    expect(capacityMonthTip(null, "fr")).toBe("Réessayez dans quelques jours.");
    setActiveLocale("en");
    expect(capacityMonthTip(undefined, "en")).toBe("Please try again in a few days.");
  });

  it("jour et part de la personne : les textes du fondateur, sans date", () => {
    const r = fr.result;
    expect([r.capacityDayTitle, r.capacityDayTip]).toEqual(["Le service de recherche est très sollicité aujourd'hui.", "Réessayez demain."]);
    expect(r.capacityMonthTitle).toBe("Le service de recherche a atteint sa limite mensuelle.");
    expect([r.capacityUserTitle, r.capacityUserTip]).toEqual(["Vous avez atteint votre limite de recherches pour aujourd'hui.", "Réessayez demain."]);
    expect(en.result.capacityUserTitle).toBe("You've reached your search limit for today.");
    const textes = [fr.result, en.result].flatMap((c) => [c.capacityDayTitle, c.capacityDayTip, c.capacityMonthTitle, c.capacityMonthLater, c.capacityUserTitle, c.capacityUserTip]);
    for (const texte of textes) expect(texte).not.toMatch(/\d/);
  });
});
