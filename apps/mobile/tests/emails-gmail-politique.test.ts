import { describe, expect, it } from "vitest";
import { ACCEPTED_CONSENT_VERSIONS, LEGAL_DOCUMENT_VERSIONS } from "@monapp/shared-types";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import type { LegalDocument } from "../src/legal/types";

// Lot « e-mails » : les e-mails du compte (confirmation, mot de passe oublié,
// changement d'adresse) partent par Gmail, réglé dans Supabase (SMTP). La
// politique cite Gmail dans les prestataires et dans les transferts, en
// français et en anglais, sans nouvelle version ni nouvelle acceptation.
const section = (doc: LegalDocument, title: string) => {
  const found = doc.sections.find((s) => s.title === title);
  expect(found, title).toBeDefined();
  return found!.blocks.flat();
};

const GMAIL_FR = "Gmail (Google LLC, États-Unis) : les e-mails liés à votre compte (confirmation de l'inscription, mot de passe oublié, changement d'adresse) sont envoyés par le service Gmail de Google, qui reçoit pour cela votre adresse e-mail et le contenu du message.";
const GMAIL_EN = "Gmail (Google LLC, United States): emails about your account (sign-up confirmation, forgotten password, change of address) are sent through Google's Gmail service, which receives for this your email address and the content of the message.";

describe("politique de confidentialité : e-mails du compte envoyés par Gmail", () => {
  it("ni nouvelle version ni nouvelle acceptation", () => {
    expect(LEGAL_DOCUMENT_VERSIONS.privacy_policy).toBe("projet-2026-11-05");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy.at(-1)).toBe("projet-2026-11-05");
  });

  it("permis : Gmail est cité une fois dans les prestataires et une fois dans les transferts, avec une réserve à faire vérifier", () => {
    const cases = [
      { doc: privacyPolicy, providers: "Nos prestataires et les services tiers", transfers: "Transferts hors de l'Union européenne", sentence: GMAIL_FR, marker: "[À vérifier : société de Google" },
      { doc: privacyPolicyEn, providers: "Our providers and third-party services", transfers: "Transfers outside the European Union", sentence: GMAIL_EN, marker: "[To be verified: which Google company" },
    ];
    for (const c of cases) {
      const providers = section(c.doc, c.providers).filter((b) => b.startsWith("Gmail ("));
      expect(providers).toHaveLength(1);
      expect(providers[0]).toContain(c.sentence);
      expect(providers[0]).toContain(c.marker);
      expect(section(c.doc, c.transfers).filter((b) => b.includes("Gmail (Google)"))).toHaveLength(1);
    }
  });

  it("refusé : Gmail ne reçoit rien d'autre que l'adresse et le message (ni mot de passe, ni contenu de l'app)", () => {
    for (const doc of [privacyPolicy, privacyPolicyEn]) {
      const all = doc.sections.flatMap((s) => s.blocks.flat());
      const gmail = all.filter((b) => b.includes("Gmail"));
      expect(gmail).toHaveLength(2);
      for (const b of gmail) {
        expect(b).not.toMatch(/mot de passe de votre compte|your account password|photos?|images?|recherches|searches|messages privés|private messages/i);
      }
    }
  });
});
