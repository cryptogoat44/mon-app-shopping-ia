import { afterEach, describe, expect, it } from "vitest";
import { forgetSignupConsents, hasSignupConsents, rememberSignupConsents } from "../src/lib/signup-consents";

describe("cases cochées à l'inscription (Dernière étape)", () => {
  afterEach(() => forgetSignupConsents());

  it("par défaut, rien n'est considéré comme coché : les cases seront demandées", () => {
    expect(hasSignupConsents("a@example.com")).toBe(false);
    expect(hasSignupConsents(null)).toBe(false);
    expect(hasSignupConsents(undefined)).toBe(false);
  });

  it("reconnaît l'inscription qui vient d'avoir lieu, pour le même e-mail seulement", () => {
    rememberSignupConsents("  Camille@Example.com ");
    expect(hasSignupConsents("camille@example.com")).toBe(true);
    expect(hasSignupConsents("autre@example.com")).toBe(false);
  });

  it("ne sert qu'une fois", () => {
    rememberSignupConsents("camille@example.com");
    forgetSignupConsents();
    expect(hasSignupConsents("camille@example.com")).toBe(false);
  });
});
