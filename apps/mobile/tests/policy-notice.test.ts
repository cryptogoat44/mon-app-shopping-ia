import { describe, expect, it } from "vitest";
import { ACCEPTED_CONSENT_VERSIONS, LEGAL_DOCUMENT_VERSIONS, POLICY_UPDATE_NOTICE } from "@monapp/shared-types";
import { parseSeenNotices, seenNoticesKey, shouldShowNotice } from "../src/lib/policy-notice";

const notice = { id: "info-test", document: "privacy_policy" as const, version: "v2" };
const accepted = (version: string | null) => [{ type: "privacy_policy" as const, grantedAt: "2026-09-25T10:00:00Z", version, isCurrent: true }];

describe("information de mise à jour (sans nouvelle acceptation)", () => {
  it("montrée une fois à qui a accepté une version antérieure", () => {
    expect(shouldShowNotice(accepted("v1"), [], notice)).toBe(true);
    expect(shouldShowNotice(accepted("v1"), ["info-test"], notice)).toBe(false);
  });

  it("jamais montrée à qui a déjà accepté la nouvelle version (compte récent)", () => {
    expect(shouldShowNotice(accepted("v2"), [], notice)).toBe(false);
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
    expect(POLICY_UPDATE_NOTICE.version).toBe(LEGAL_DOCUMENT_VERSIONS.privacy_policy);
    // L'acceptation de la version précédente reste valable.
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-09-25");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain(LEGAL_DOCUMENT_VERSIONS.privacy_policy);
  });
});
