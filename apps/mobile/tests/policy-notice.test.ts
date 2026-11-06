import { describe, expect, it } from "vitest";
import { ACCEPTED_CONSENT_VERSIONS, CONSENT_VERSIONS, LEGAL_DOCUMENT_VERSIONS, POLICY_UPDATE_NOTICE } from "@monapp/shared-types";
import { parseSeenNotices, seenNoticesKey, shouldShowNotice } from "../src/lib/policy-notice";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import { fr as frCatalog } from "../src/i18n/fr";
import { en as enCatalog } from "../src/i18n/en";

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
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-09-30");
    // L'acceptation de la version précédente reste valable.
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-09-25");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain(LEGAL_DOCUMENT_VERSIONS.privacy_policy);
  });

  // Les versions du 2026-09-30-b au 2026-10-27 ont été publiées sans message ;
  // depuis la version « projet-2026-11-05 », le message de la voie C est
  // montré une fois à tous ces comptes (test plus bas).
  it("lot 3bis (identifiant d'installation des rapports de plantage) : simple information, sans nouvelle acceptation", () => {
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-10-05");
    expect(JSON.stringify(privacyPolicy)).toContain("identifiant d'installation pseudonyme");
    expect(JSON.stringify(privacyPolicyEn)).toContain("pseudonymous installation identifier");
    // L'acceptation de la version précédente (lot 3) reste valable.
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-09-30-b");
  });

  it("lot 4 (vidéo lue seulement sur l'appareil) : simple information, sans nouvelle acceptation", () => {
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-10-05-b");
    expect(JSON.stringify(privacyPolicy)).toContain("la vidéo n'est jamais envoyée à nos serveurs ni conservée");
    expect(JSON.stringify(privacyPolicyEn)).toContain("the video is never sent to our servers nor kept");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-10-05");
  });

  it("lot 4, temps 1 bis (analyse automatique) : Anthropic nommé, consentement propre à la fonction ; la politique reste une simple information", () => {
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-10-06");
    expect(JSON.stringify(privacyPolicy)).toContain("Anthropic (Anthropic, PBC, États-Unis)");
    expect(JSON.stringify(privacyPolicyEn)).toContain("Anthropic (Anthropic, PBC, United States)");
    expect(JSON.stringify(privacyPolicy)).toContain("Accepter ou retirer l'analyse automatique des vidéos");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-10-05-b");
    expect(ACCEPTED_CONSENT_VERSIONS.analyse_video_ia).toEqual([CONSENT_VERSIONS.analyse_video_ia]);
  });

  it("petit lot (mots retirés de la recherche par image) : simple information, sans nouvelle acceptation", () => {
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-10-25");
    const fr = JSON.stringify(privacyPolicy);
    const en = JSON.stringify(privacyPolicyEn);
    expect(fr).toContain("Ces images et votre description ne sont jamais enregistrées par Spotto");
    expect(en).toContain("These frames and your description are never saved by Spotto");
    // Plus aucun texte envoyé à SerpApi ni à Google avec l'image.
    expect(fr).not.toContain("le texte éventuellement ajouté");
    expect(en).not.toContain("any text you added");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain("projet-2026-10-06");
  });

  // Petit lot 2 (décision du fondateur du 2026-10-27) : les mots d'une photo trient les propositions.
  it("petit lot 2 (mots qui trient) : simple information, sans nouvelle acceptation", () => {
    const fr = JSON.stringify(privacyPolicy);
    const en = JSON.stringify(privacyPolicyEn);
    // Phrase réécrite le 2026-11-05 (voie C) : sous une photo, les mots ne font toujours que trier.
    expect(fr).toContain(
      "Sous une photo, les mots que vous tapez servent seulement à trier les propositions : notre serveur ne les envoie pas avec l'image à la recherche visuelle, et ne les enregistre pas."
    );
    expect(en).toContain(
      "Under a photo, the words you type are only used to sort the suggestions: our server does not send them with the image to the visual search, and does not save them."
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
  });
});

// Lot politique exacte (2026-11-05) : la voie C décrite dans la politique,
// simple information AVEC le court message promis par « Modifications ».
describe("version « projet-2026-11-05 » (voie C) : simple information, avec message", () => {
  const current = LEGAL_DOCUMENT_VERSIONS.privacy_policy;
  const earlier = ACCEPTED_CONSENT_VERSIONS.privacy_policy.filter((version) => version !== current);

  it("nouvelle version datée, sans nouvelle acceptation : toutes les versions déjà acceptées restent valables", () => {
    expect(current).toBe("projet-2026-11-05");
    expect(CONSENT_VERSIONS.privacy_policy).toBe(current);
    expect(earlier).toEqual([
      "projet-2026-09-25",
      "projet-2026-09-29",
      "projet-2026-09-30",
      "projet-2026-09-30-b",
      "projet-2026-10-05",
      "projet-2026-10-05-b",
      "projet-2026-10-06",
      "projet-2026-10-25",
      "projet-2026-10-27",
    ]);
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy).toContain(current);
    // Les conditions d'utilisation ne changent pas.
    expect(LEGAL_DOCUMENT_VERSIONS.terms).toBe("projet-2026-09-25");
    expect(ACCEPTED_CONSENT_VERSIONS.terms).toEqual(["projet-2026-09-25"]);
  });

  it("le message est nouveau : seule la version en vigueur le contient déjà", () => {
    expect(POLICY_UPDATE_NOTICE.document).toBe("privacy_policy");
    expect(POLICY_UPDATE_NOTICE.id).toBe("politique-2026-11-05-boutiques-et-mots");
    expect(POLICY_UPDATE_NOTICE.alreadyCovered).toEqual([current]);
  });

  it("montré une fois à chaque personne déjà inscrite, même si elle avait vu l'information précédente", () => {
    for (const version of earlier) {
      expect(shouldShowNotice(accepted(version), [], POLICY_UPDATE_NOTICE), version).toBe(true);
      expect(shouldShowNotice(accepted(version), ["politique-2026-09-30-erreurs-statistiques"], POLICY_UPDATE_NOTICE), version).toBe(true);
      // Lu ou fermé : plus jamais sur cet appareil.
      expect(shouldShowNotice(accepted(version), ["politique-2026-09-30-erreurs-statistiques", POLICY_UPDATE_NOTICE.id], POLICY_UPDATE_NOTICE), version).toBe(false);
    }
  });

  it("jamais montré à qui accepte la version en vigueur (nouvelle inscription)", () => {
    expect(shouldShowNotice(accepted(current), [], POLICY_UPDATE_NOTICE)).toBe(false);
  });

  it("texte du message, en français et en anglais : autres boutiques, vos mots, une IA lit les titres, jamais la photo", () => {
    expect(frCatalog.legal.updateNotice).toBe(
      "Notre politique de confidentialité a été mise à jour : elle décrit les nouvelles recherches dans d'autres boutiques et avec vos mots. Une IA lit les titres des résultats, jamais votre photo."
    );
    expect(enCatalog.legal.updateNotice).toBe(
      "Our privacy policy has been updated: it describes the new searches at other shops and with your words. An AI reads the titles of the results, never your photo."
    );
    // Le lien du message mène à la politique.
    expect(frCatalog.legal.updateNoticeRead).toBe("Lire la politique");
    expect(enCatalog.legal.updateNoticeRead).toBe("Read the policy");
    // L'ancien message (serveur en Europe) n'est plus montré.
    expect(frCatalog.legal.updateNotice).not.toContain("Europe");
    expect(enCatalog.legal.updateNotice).not.toContain("Europe");
  });

  it("la politique promet toujours ce court message pour une simple information", () => {
    expect(JSON.stringify(privacyPolicy)).toContain("Lorsqu'il s'agit d'une simple information (par exemple un changement du lieu d'hébergement), un court message vous en informe, avec un lien vers cette page.");
    expect(JSON.stringify(privacyPolicyEn)).toContain("When it is simply for your information (for example a change of hosting location), a short message lets you know, with a link to this page.");
  });
});
