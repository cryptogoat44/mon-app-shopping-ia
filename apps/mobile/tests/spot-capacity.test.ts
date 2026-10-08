import { describe, expect, it } from "vitest";
import { parseSearchCapacityError } from "@monapp/shared-types";
import { en } from "../src/i18n/en";
import { fr } from "../src/i18n/fr";
import { capacityFailReason } from "../src/lib/spot-capacity";

// Lot 4 quater : plafond des recherches (jour et mois pour tout le service,
// part de la personne). Réponse du serveur lue sans lui faire confiance ;
// textes du fondateur (2026-10-08), jamais de date.

describe("réponse « plafond atteint » du serveur", () => {
  it("lit le plafond en cause ; toute autre erreur, ou une réponse mal formée, n'en est pas une", () => {
    expect(parseSearchCapacityError({ error: "search_capacity_day", message: "…" })).toBe("day");
    expect(parseSearchCapacityError({ error: "search_capacity_month", message: "…" })).toBe("month");
    expect(parseSearchCapacityError({ error: "search_capacity_user", message: "…" })).toBe("user");
    expect(parseSearchCapacityError({ error: "rate_limited", message: "…" })).toBeNull();
    expect(parseSearchCapacityError("search_capacity_day")).toBeNull();
    expect(parseSearchCapacityError(null)).toBeNull();
  });

  it("donne le motif d'échec de l'écran Résultat", () => {
    expect(capacityFailReason({ error: "search_capacity_day" })).toBe("capacity_day");
    expect(capacityFailReason({ error: "search_capacity_month" })).toBe("capacity_month");
    expect(capacityFailReason({ error: "search_capacity_user" })).toBe("capacity_user");
    expect(capacityFailReason({ error: "rate_limited" })).toBeNull();
  });
});

describe("textes de l'écran Résultat (décisions du fondateur, 2026-10-08)", () => {
  it("français : jour, mois sans date, part de la personne", () => {
    const r = fr.result;
    expect([r.capacityDayTitle, r.capacityDayTip]).toEqual(["Le service de recherche est très sollicité aujourd'hui.", "Réessayez demain."]);
    expect([r.capacityMonthTitle, r.capacityMonthTip]).toEqual(["Le service de recherche a atteint sa limite mensuelle.", "Réessayez dans quelques jours."]);
    expect([r.capacityUserTitle, r.capacityUserTip]).toEqual(["Vous avez atteint votre limite de recherches pour aujourd'hui.", "Réessayez demain."]);
  });

  it("anglais, et aucune date ni aucun chiffre dans ces textes", () => {
    const r = en.result;
    expect(r.capacityMonthTip).toBe("Please try again in a few days.");
    expect(r.capacityUserTitle).toBe("You've reached your search limit for today.");
    const textes = [fr.result, en.result].flatMap((c) => [c.capacityDayTitle, c.capacityDayTip, c.capacityMonthTitle, c.capacityMonthTip, c.capacityUserTitle, c.capacityUserTip]);
    for (const texte of textes) expect(texte).not.toMatch(/\d/);
  });
});
