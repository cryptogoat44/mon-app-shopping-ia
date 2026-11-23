import { describe, expect, it } from "vitest";
import { ACCEPTED_CONSENT_VERSIONS, LEGAL_DOCUMENT_VERSIONS } from "@monapp/shared-types";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import type { LegalDocument } from "../src/legal/types";

// Décision du fondateur (23 novembre 2026) : pas de Gmail pour les e-mails
// du compte. Aucun service d'envoi n'est branché dans Supabase tant qu'il
// n'a pas pris un nom de domaine et un service d'envoi. La politique ne doit
// donc citer aucun service d'envoi d'e-mails : elle doit rester exactement
// vraie. Le jour où un service est branché, ce test change avec la politique
// (prestataires, transferts, durées), en français et en anglais.
const blocks = (doc: LegalDocument) => doc.sections.flatMap((s) => s.blocks.flat());

/** Les services d'envoi d'e-mails envisagés ou possibles : aucun n'est en service. */
const SERVICES_ENVOI = /\b(Gmail|SendGrid|Twilio|Brevo|Sendinblue|Resend|Postmark|Mailgun|Mailjet|Amazon SES)\b/i;

describe("politique de confidentialité : aucun service d'envoi d'e-mails tant qu'aucun n'est branché", () => {
  it("ni nouvelle version ni nouvelle acceptation", () => {
    expect(LEGAL_DOCUMENT_VERSIONS.privacy_policy).toBe("projet-2026-11-05");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy.at(-1)).toBe("projet-2026-11-05");
  });

  it("refusé : ni la version française ni la version anglaise ne cite un service d'envoi d'e-mails", () => {
    for (const doc of [privacyPolicy, privacyPolicyEn]) {
      expect(blocks(doc).filter((b) => SERVICES_ENVOI.test(b))).toEqual([]);
    }
  });

  it("refusé : aucune ligne ne parle d'une copie des e-mails gardée dans des « messages envoyés »", () => {
    for (const doc of [privacyPolicy, privacyPolicyEn]) {
      expect(blocks(doc).filter((b) => /messages envoyés|sent mail/i.test(b))).toEqual([]);
    }
  });

  it("permis : Google reste cité là où il sert vraiment (les images affichées par l'app)", () => {
    const cases = [
      { doc: privacyPolicy, text: "par Google lorsque l'app affiche leurs images" },
      { doc: privacyPolicyEn, text: "by Google when the app displays their images" },
    ];
    for (const c of cases) {
      expect(blocks(c.doc).filter((b) => b.includes(c.text)).length).toBeGreaterThan(0);
    }
  });
});
