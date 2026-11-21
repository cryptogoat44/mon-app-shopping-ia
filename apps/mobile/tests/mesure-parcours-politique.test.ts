import { describe, expect, it } from "vitest";
import { ACCEPTED_CONSENT_VERSIONS, LEGAL_DOCUMENT_VERSIONS } from "@monapp/shared-types";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import type { LegalDocument } from "../src/legal/types";

// Lot « mesure du parcours » : la politique énumère ce que disent les
// statistiques d'usage ; elle dit aussi les étapes du parcours et les temps
// d'attente, en français comme en anglais, sans nouvelle version ni nouvelle
// acceptation (consigne du fondateur, comme les lots du 2026-11-15 et 17).
const section = (doc: LegalDocument, title: string) => {
  const found = doc.sections.find((s) => s.title === title);
  expect(found, title).toBeDefined();
  return found!.blocks.flat().join("\n");
};

describe("politique de confidentialité : étapes du parcours et temps d'attente", () => {
  it("ni nouvelle version ni nouvelle acceptation", () => {
    expect(LEGAL_DOCUMENT_VERSIONS.privacy_policy).toBe("projet-2026-11-05");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy.at(-1)).toBe("projet-2026-11-05");
  });

  it("la phrase des statistiques d'usage le dit, en français et en anglais, et le reste de la phrase ne change pas", () => {
    const fr = section(privacyPolicy, "Les données que nous utilisons");
    const en = section(privacyPolicyEn, "The data we use");
    expect(fr).toContain(
      "Des statistiques d'usage, SEULEMENT si vous l'acceptez (case facultative, décochée par défaut) : les actions que vous faites dans l'app (par exemple lancer une recherche, ajouter une pièce, publier, commenter, suivre un compte), les étapes du parcours et les temps d'attente, avec le seul identifiant interne de votre compte et quelques précisions choisies à l'avance (catégorie, visibilité choisie, nombre de résultats…). Jamais votre nom, votre e-mail, les mots que vous tapez, le texte de vos commentaires ou légendes, ni les adresses de vos images."
    );
    expect(en).toContain(
      "Usage statistics, ONLY if you agree (optional box, unticked by default): the actions you take in the app (for example starting a search, adding a piece, publishing, commenting, following an account), the steps of the journey and waiting times, with only the internal identifier of your account and a few predefined details (category, chosen visibility, number of results…). Never your name, email address, the words you type, the text of your comments or captions, or the addresses of your images."
    );
  });
});
