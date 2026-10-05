import { describe, expect, it } from "vitest";
import { ACCEPTED_CONSENT_VERSIONS, LEGAL_DOCUMENT_VERSIONS, POLICY_UPDATE_NOTICE } from "@monapp/shared-types";
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
    expect(LEGAL_DOCUMENT_VERSIONS.privacy_policy).toBe("projet-2026-10-05-b");
    expect(JSON.stringify(privacyPolicy)).toContain("la vidéo n'est jamais envoyée à nos serveurs ni conservée");
    expect(JSON.stringify(privacyPolicyEn)).toContain("the video is never sent to our servers nor kept");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-10-05");
    expect(shouldShowNotice(accepted("projet-2026-10-05"), [], POLICY_UPDATE_NOTICE)).toBe(false);
    expect(shouldShowNotice(accepted("projet-2026-10-05-b"), [], POLICY_UPDATE_NOTICE)).toBe(false);
  });
});
