import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGAL_DOCUMENT_VERSIONS } from "@monapp/shared-types";
import { consentFor, formatLongDate, parseLegalVersion, pendingConsents, splitPlaceholders } from "../src/lib/legal";
import { termsOfUse } from "../src/legal/conditions";
import { privacyPolicy } from "../src/legal/confidentialite";
import { PUBLISHER, readPublisher } from "../src/legal/publisher";

describe("documents juridiques", () => {
  it("lit la version d'un projet", () => {
    expect(parseLegalVersion("projet-2026-09-25")).toEqual({ isDraft: true, day: "2026-09-25" });
    expect(parseLegalVersion("2027-01-10")).toEqual({ isDraft: false, day: "2027-01-10" });
    expect(formatLongDate("2026-09-25")).toBe("25 septembre 2026");
  });

  it("isole les champs à compléter, à décider ou à vérifier", () => {
    expect(splitPlaceholders("Édité par [À compléter : nom]. Âge : [À décider : 15 ans].")).toEqual([
      { text: "Édité par ", placeholder: false },
      { text: "[À compléter : nom]", placeholder: true },
      { text: ". Âge : ", placeholder: false },
      { text: "[À décider : 15 ans]", placeholder: true },
      { text: ".", placeholder: false },
    ]);
    expect(splitPlaceholders("Aucun champ.")).toEqual([{ text: "Aucun champ.", placeholder: false }]);
  });

  it("retrouve le statut d'un document", () => {
    const statuses = [{ type: "terms" as const, grantedAt: "2026-09-25T10:00:00Z", version: "v", isCurrent: false }];
    expect(consentFor(statuses, "terms")?.version).toBe("v");
    expect(consentFor(statuses, "privacy_policy")).toBeNull();
  });

  it("les conditions se confirment avec la déclaration d'âge", () => {
    const status = (type: "terms" | "privacy_policy" | "age_declaration", isCurrent: boolean) => ({
      type,
      grantedAt: "2026-09-25T10:00:00Z",
      version: "v",
      isCurrent,
    });
    expect(pendingConsents([], "terms")).toEqual(["terms", "age_declaration"]);
    expect(pendingConsents([status("terms", true)], "terms")).toEqual(["age_declaration"]);
    expect(pendingConsents([status("terms", true), status("age_declaration", true)], "terms")).toEqual([]);
    expect(pendingConsents([status("terms", false), status("age_declaration", true)], "terms")).toEqual(["terms"]);
    // La politique de confidentialité ne demande pas l'âge.
    expect(pendingConsents([], "privacy_policy")).toEqual(["privacy_policy"]);
  });

  it("les deux documents sont des projets, datés, et correspondent aux versions en vigueur", () => {
    for (const doc of [termsOfUse, privacyPolicy]) {
      const version = parseLegalVersion(LEGAL_DOCUMENT_VERSIONS[doc.type]);
      expect(version.isDraft).toBe(true);
      expect(version.day).not.toBeNull();
      expect(doc.sections.length).toBeGreaterThan(5);
    }
  });

  it("identité de l'éditeur : « À compléter » si une variable manque ou est vide, jamais d'erreur", () => {
    expect(readPublisher({})).toEqual({
      name: "[À compléter : nom de l'éditeur]",
      status: "[À compléter : statut de l'éditeur]",
      address: "[À compléter : adresse postale]",
      email: "[À compléter : adresse e-mail de contact]",
      phone: "[À compléter : numéro de téléphone]",
    });
    const filled = readPublisher({ name: " Nom Exemple ", address: "   ", email: "contact@example.com" });
    expect(filled.name).toBe("Nom Exemple");
    expect(filled.address).toBe("[À compléter : adresse postale]");
    expect(filled.email).toBe("contact@example.com");
    // Mis en évidence à l'écran comme les autres champs à compléter.
    expect(splitPlaceholders(`Adresse : ${readPublisher({}).address}.`)[1]).toEqual({ text: "[À compléter : adresse postale]", placeholder: true });
  });

  it("aucune coordonnée personnelle dans le code des documents (dépôt public)", () => {
    const dir = join(__dirname, "../src/legal");
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
      expect(source, file).not.toMatch(/\b0[1-9](?:[ .]?\d{2}){4}\b/);
    }
  });

  it("reprend l'identité de l'éditeur d'une seule source, et vouvoie partout", () => {
    for (const doc of [termsOfUse, privacyPolicy]) {
      const text = doc.sections.flatMap((s) => [s.title, ...s.blocks.flat()]).join("\n");
      expect(text).toContain(PUBLISHER.name);
      expect(text).toContain(PUBLISHER.email);
      expect(text).toContain(PUBLISHER.address);
      expect(text).not.toMatch(/SIRET\s*:?\s*\d/);
      // Limites de mot tenant compte des lettres accentuées (« incomplètes »).
      expect(text).not.toMatch(/(?<!\p{L})(tu|ton|ta|tes|toi|te)(?!\p{L})/iu);
    }
  });
});
