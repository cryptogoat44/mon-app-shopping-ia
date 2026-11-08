import { describe, expect, it } from "vitest";
import { commitValide, jourDeParis, prochaineEtiquette } from "../scripts/lib/etiquette-version.js";

// Étiquettes de version (lot « filets de sécurité ») : « v2026.11.06-1 », la
// date de Paris puis le numéro de la mise en ligne du jour.
describe("étiquette de version", () => {
  it("date de Paris, y compris autour de minuit et au changement d'heure", () => {
    expect(jourDeParis(new Date("2026-11-06T10:00:00Z"))).toBe("2026.11.06");
    expect(jourDeParis(new Date("2026-11-06T23:30:00Z"))).toBe("2026.11.07"); // 0 h 30 à Paris
    expect(jourDeParis(new Date("2026-07-14T22:30:00Z"))).toBe("2026.07.15"); // heure d'été : 0 h 30
    expect(jourDeParis(new Date("2026-07-14T21:30:00Z"))).toBe("2026.07.14");
  });

  it("première mise en ligne du jour : -1 ; les suivantes : le numéro suivant", () => {
    expect(prochaineEtiquette("2026.11.06", [])).toBe("v2026.11.06-1");
    expect(prochaineEtiquette("2026.11.06", ["v2026.11.05-1", "v2026.11.05-2", ""])).toBe("v2026.11.06-1");
    expect(prochaineEtiquette("2026.11.06", ["v2026.11.06-1", "v2026.11.06-2"])).toBe("v2026.11.06-3");
    expect(prochaineEtiquette("2026.11.06", ["v2026.11.06-2", "v2026.11.06-10", "v2026.11.06-9"])).toBe("v2026.11.06-11");
    // Une étiquette mal formée ne compte pas.
    expect(prochaineEtiquette("2026.11.06", ["v2026.11.06-essai", "v2026.11.06-0", "v2026.11.06-"])).toBe("v2026.11.06-1");
  });

  it("commit : 7 à 40 caractères hexadécimaux, rien d'autre", () => {
    expect(commitValide("A0212C1")).toBe("a0212c1");
    expect(commitValide("a0212c1f3b9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c")).toBe("a0212c1f3b9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c");
    for (const texte of [undefined, "", "main", "a0212c", "HEAD~1", "a0212c1;rm", "--confirmer"]) expect(commitValide(texte), String(texte)).toBeNull();
  });
});
