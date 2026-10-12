import { describe, expect, it } from "vitest";
import { env } from "../src/env.js";
import { PLAFOND_SERPAPI_PARCOURS } from "../scripts/lib/plafond-parcours.js";

// Lot 4 quater : les serveurs locaux des vérifications à l'écran ne peuvent
// rien dépenser (clé SerpApi invalide ou simulée) ; tous leurs plafonds de
// recherches sont relevés. Oubli trouvé en relisant (2026-10-08) : la part de
// chaque personne n'était pas relevée — un parcours iPhone, qui fait plus de
// 8 recherches avec le même compte, aurait été bloqué à tort.
describe("plafonds des serveurs de vérification", () => {
  it("chaque plafond de recherches du serveur est relevé, très haut", () => {
    const plafondsDuServeur = Object.keys(env).filter((cle) => /^SERPAPI_.*_CAP$/.test(cle)).sort();
    expect(plafondsDuServeur).toEqual(["SERPAPI_DAILY_CAP", "SERPAPI_MONTHLY_CAP", "SERPAPI_USER_DAILY_CAP"]);
    expect(Object.keys(PLAFOND_SERPAPI_PARCOURS).sort()).toEqual(plafondsDuServeur);
    for (const valeur of Object.values(PLAFOND_SERPAPI_PARCOURS)) expect(Number(valeur)).toBeGreaterThanOrEqual(100_000);
  });
});
