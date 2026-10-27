import { describe, expect, it } from "vitest";
import { ACCEPTED_CONSENT_VERSIONS, CONSENT_VERSIONS, LEGAL_DOCUMENT_VERSIONS, POLICY_UPDATE_NOTICE } from "@monapp/shared-types";
import { parseSeenNotices, seenNoticesKey, shouldShowNotice } from "../src/lib/policy-notice";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";

const notice = { id: "info-test", document: "privacy_policy" as const, alreadyCovered: ["v2", "v3"] };
const accepted = (version: string | null) => [{ type: "privacy_policy" as const, grantedAt: "2026-09-25T10:00:00Z", decidedAt: "2026-09-25T10:00:00Z", version, isCurrent: true }];

describe("information de mise à jour (sans nouvelle acceptation)", () => {
  it("montrée une fois à qui a accepté une version antérieure", () => {
    expect(shouldShowNotice(accepted("v1"), [], notice)).toBe(true);
    expect(shouldShowNotice(accepted("v1"), ["info-test"], notice)).toBe(false);
  });

  it("jamais montrée à qui a déjà accepté la nouvelle version (compte récent)", () => {
    expect(shouldShowNotice(accepted("v2"), [], notice)).toBe(false);
    // Version suivante, elle aussi porteuse de l'information (lot 3).
    expect(shouldShowNotice(accepted("v3"), [], notice)).toBe(false);
  });

  it("montrée aussi à un compte sans version enregistrée", () => {
    expect(shouldShowNotice(accepted(null), [], notice)).toBe(true);
    expect(shouldShowNotice([], [], notice)).toBe(true);
  });

  it("lit sans erreur une mémoire absente ou abîmée, et sépare les comptes", () => {
    expect(parseSeenNotices(null)).toEqual([]);
    expect(parseSeenNotices("pas du json")).toEqual([]);
    expect(parseSeenNotices('{"a":1}')).toEqual([]);
    expect(parseSeenNotices('["a",2,"b"]')).toEqual(["a", "b"]);
    expect(seenNoticesKey("u1")).not.toBe(seenNoticesKey("u2"));
  });

  it("la mise à jour « serveur en Europe » ne demande pas de nouvelle acceptation", () => {
    expect(POLICY_UPDATE_NOTICE.alreadyCovered).toContain(LEGAL_DOCUMENT_VERSIONS.privacy_policy);
    // Lot 3 (langue et thème sur l'appareil) : simple information, sans nouveau message.
    expect(POLICY_UPDATE_NOTICE.alreadyCovered).toContain("projet-2026-09-30");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-09-30");
    // L'acceptation de la version précédente reste valable.
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-09-25");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain(LEGAL_DOCUMENT_VERSIONS.privacy_policy);
  });

  it("lot 3bis (identifiant d'installation des rapports de plantage) : simple information, ni nouvelle acceptation ni message", () => {
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-10-05");
    expect(JSON.stringify(privacyPolicy)).toContain("identifiant d'installation pseudonyme");
    expect(JSON.stringify(privacyPolicyEn)).toContain("pseudonymous installation identifier");
    // L'acceptation de la version précédente (lot 3) reste valable, sans message.
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-09-30-b");
    expect(shouldShowNotice(accepted("projet-2026-09-30-b"), [], POLICY_UPDATE_NOTICE)).toBe(false);
    expect(shouldShowNotice(accepted("projet-2026-10-05"), [], POLICY_UPDATE_NOTICE)).toBe(false);
  });

  it("lot 4 (vidéo lue seulement sur l'appareil) : simple information, ni nouvelle acceptation ni message", () => {
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-10-05-b");
    expect(JSON.stringify(privacyPolicy)).toContain("la vidéo n'est jamais envoyée à nos serveurs ni conservée");
    expect(JSON.stringify(privacyPolicyEn)).toContain("the video is never sent to our servers nor kept");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-10-05");
    expect(shouldShowNotice(accepted("projet-2026-10-05"), [], POLICY_UPDATE_NOTICE)).toBe(false);
    expect(shouldShowNotice(accepted("projet-2026-10-05-b"), [], POLICY_UPDATE_NOTICE)).toBe(false);
  });

  it("lot 4, temps 1 bis (analyse automatique) : Anthropic nommé, consentement propre à la fonction ; la politique reste une simple information", () => {
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-10-06");
    expect(JSON.stringify(privacyPolicy)).toContain("Anthropic (Anthropic, PBC, États-Unis)");
    expect(JSON.stringify(privacyPolicyEn)).toContain("Anthropic (Anthropic, PBC, United States)");
    expect(JSON.stringify(privacyPolicy)).toContain("Accepter ou retirer l'analyse automatique des vidéos");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-10-05-b");
    expect(ACCEPTED_CONSENT_VERSIONS.analyse_video_ia).toEqual([CONSENT_VERSIONS.analyse_video_ia]);
    expect(shouldShowNotice(accepted("projet-2026-10-05-b"), [], POLICY_UPDATE_NOTICE)).toBe(false);
  });

  it("petit lot (mots retirés de la recherche par image) : simple information, ni nouvelle acceptation ni message", () => {
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-10-25");
    const fr = JSON.stringify(privacyPolicy);
    const en = JSON.stringify(privacyPolicyEn);
    expect(fr).toContain("Ces images et votre description ne sont jamais enregistrées par Spotto");
    expect(en).toContain("These frames and your description are never saved by Spotto");
    // Plus aucun texte envoyé à SerpApi ni à Google avec l'image.
    expect(fr).not.toContain("le texte éventuellement ajouté");
    expect(en).not.toContain("any text you added");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-10-06");
    expect(shouldShowNotice(accepted("projet-2026-10-06"), [], POLICY_UPDATE_NOTICE)).toBe(false);
    expect(shouldShowNotice(accepted("projet-2026-10-25"), [], POLICY_UPDATE_NOTICE)).toBe(false);
  });

  // Petit lot 2 (décision du fondateur du 2026-10-27) : les mots d'une photo trient les propositions.
  it("petit lot 2 (mots qui trient) : simple information, ni nouvelle acceptation ni message", () => {
    expect(LEGAL_DOCUMENT_VERSIONS.privacy_policy).toBe("projet-2026-10-27");
    const fr = JSON.stringify(privacyPolicy);
    const en = JSON.stringify(privacyPolicyEn);
    expect(fr).toContain(
      "Les mots que vous tapez ne sont envoyés ni à SerpApi ni à Google, et ne sont pas enregistrés avec la recherche : sous une photo, notre serveur s'en sert seulement pour trier les propositions."
    );
    expect(en).toContain(
      "The words you type are sent neither to SerpApi nor to Google, and are not saved with the search: under a photo, our server only uses them to sort the suggestions."
    );
    // Les anciennes recherches et leur texte : la durée renvoie à « Combien de temps ».
    expect(fr).toContain("Les recherches faites jusqu'au 27 octobre 2026 gardent le texte que vous aviez éventuellement ajouté, jusqu'à leur suppression (voir « Combien de temps »).");
    expect(en).toContain("Searches made up to 27 October 2026 keep any text you had added, until they are deleted (see “How long”).");
    expect(fr).not.toContain("ne partent plus avec l'image");
    expect(en).not.toContain("no longer sent with the image");
    // La vidéo avec l'IA : la description part vers Anthropic, jamais enregistrée (inchangé).
    expect(fr).toContain("les envoie avec votre description à notre serveur, qui les transmet à Anthropic");
    expect(en).toContain("These frames and your description are never saved by Spotto");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-10-27");
    expect(shouldShowNotice(accepted("projet-2026-10-25"), [], POLICY_UPDATE_NOTICE)).toBe(false);
    expect(shouldShowNotice(accepted("projet-2026-10-27"), [], POLICY_UPDATE_NOTICE)).toBe(false);
  });
});
