import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTACT_SUBJECT, contactEmail, contactMailto } from "../src/lib/contact";
import { readPublisher } from "../src/legal/publisher";

// « Nous contacter » : l'adresse de l'éditeur (EXPO_PUBLIC_PUBLISHER_EMAIL),
// ou rien — jamais un champ à compléter ni un lien cassé. Adresses fictives
// uniquement (dépôt public).
const EMAIL = "contact@exemple-factice.invalid";

describe("adresse de contact", () => {
  it("adresse réelle : gardée, sans les espaces autour", () => {
    expect(contactEmail(EMAIL)).toBe(EMAIL);
    expect(contactEmail(`  ${EMAIL}\n`)).toBe(EMAIL);
    expect(contactEmail("prenom.nom+spotto@aide.exemple-factice.invalid")).toBe("prenom.nom+spotto@aide.exemple-factice.invalid");
    // La même valeur que celle des documents juridiques.
    expect(contactEmail(readPublisher({ email: ` ${EMAIL} ` }).email)).toBe(EMAIL);
  });

  it("lien mailto avec l'objet encodé", () => {
    expect(CONTACT_SUBJECT).toBe("Spotto — contact");
    expect(contactMailto(EMAIL)).toBe("mailto:contact@exemple-factice.invalid?subject=Spotto%20%E2%80%94%20contact");
    // « & », « ? » et « # » restent dans l'objet, sans casser le lien.
    expect(contactMailto(EMAIL, "Question & suite ? #1")).toBe("mailto:contact@exemple-factice.invalid?subject=Question%20%26%20suite%20%3F%20%231");
  });

  it("variable absente ou vide : aucune adresse", () => {
    expect(contactEmail(undefined)).toBeNull();
    expect(contactEmail(null)).toBeNull();
    expect(contactEmail("")).toBeNull();
    expect(contactEmail("   ")).toBeNull();
  });

  it("champ « À compléter » des documents juridiques : aucune adresse", () => {
    expect(contactEmail(readPublisher({}).email)).toBeNull();
    expect(contactEmail(readPublisher({ email: "  " }, "en").email)).toBeNull();
    expect(contactEmail("[À compléter : adresse e-mail de contact]")).toBeNull();
  });

  it("adresse mal formée : aucune adresse", () => {
    for (const malformed of [
      "contact",
      "contact@",
      "@exemple-factice.invalid",
      "contact@exemple-factice",
      "contact@exemple-factice.i",
      "contact@.invalid",
      "contact@@exemple-factice.invalid",
      "contact @exemple-factice.invalid",
      ".contact@exemple-factice.invalid",
      "contact..aide@exemple-factice.invalid",
      "mailto:contact@exemple-factice.invalid",
      // Plusieurs adresses, ou des champs glissés dans le lien.
      "contact@exemple-factice.invalid, autre@exemple-factice.invalid",
      "contact@exemple-factice.invalid?cc=autre@exemple-factice.invalid",
      "contact@exemple-factice.invalid&bcc=autre@exemple-factice.invalid",
      "contact@exemple-factice.invalid#suite",
    ]) {
      expect(contactEmail(malformed), malformed).toBeNull();
    }
  });

  it("aucune adresse écrite dans le code de l'entrée (dépôt public)", () => {
    for (const file of ["../src/lib/contact.ts", "../src/components/contact-entry.tsx"]) {
      expect(readFileSync(join(__dirname, file), "utf8"), file).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    }
  });
});
