import { afterEach, describe, expect, it } from "vitest";
import { setActiveLocale, t } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { parseRecoveryUrl, recoveryExchangeProblem } from "../src/lib/password-recovery";
import { parseConfirmationUrl } from "../src/lib/email-confirmation";
import { HELP_PATH, helpContactText } from "../src/lib/help";

// Chantier 3 (comptes et modération) : liens des e-mails en flux PKCE,
// page « Aide et contact », textes FR/EN.

afterEach(() => setActiveLocale("fr"));

const CODE = "0b6f3c1e-8f6a-4c2d-9d1e-7a1b2c3d4e5f";

describe("mot de passe oublié en flux PKCE (point 13)", () => {
  it("lit le code du lien, sur le site comme sur l'iPhone", () => {
    expect(parseRecoveryUrl(`https://site.example/nouveau-mot-de-passe?code=${CODE}`)).toEqual({ kind: "code", code: CODE });
    expect(parseRecoveryUrl(`spotto://nouveau-mot-de-passe?code=${CODE}`)).toEqual({ kind: "code", code: CODE });
  });

  it("une erreur passe avant le code (lien expiré)", () => {
    expect(parseRecoveryUrl(`https://site.example/nouveau-mot-de-passe?error=access_denied&error_code=otp_expired&code=${CODE}`)).toEqual({
      kind: "error",
      code: "otp_expired",
    });
  });

  it("refuse un code mal formé", () => {
    expect(parseRecoveryUrl("https://site.example/nouveau-mot-de-passe?code=a%20b")).toEqual({ kind: "none" });
    expect(parseRecoveryUrl("https://site.example/nouveau-mot-de-passe?code=")).toEqual({ kind: "none" });
  });

  it("ne lit plus les anciens liens (jetons dans la partie « # »), sauf pour la base d'essai", () => {
    const link = "https://site.example/nouveau-mot-de-passe#access_token=abc&refresh_token=def&type=recovery";
    expect(parseRecoveryUrl(link)).toEqual({ kind: "none" });
    expect(parseRecoveryUrl(link, { testLinks: true })).toEqual({ kind: "tokens", accessToken: "abc", refreshToken: "def" });
  });

  it("explique un lien ouvert sur un autre appareil que celui de la demande", () => {
    expect(recoveryExchangeProblem({ code: "pkce_code_verifier_not_found" })).toBe("other_device");
    expect(recoveryExchangeProblem({ name: "AuthPKCECodeVerifierMissingError" })).toBe("other_device");
    expect(recoveryExchangeProblem({ code: "flow_state_expired" })).toBe("expired");
    expect(recoveryExchangeProblem(null)).toBe("expired");
  });
});

describe("lien de confirmation ouvert sur le site", () => {
  it("lit le code, hors de la page du nouveau mot de passe", () => {
    expect(parseConfirmationUrl(`https://site.example/?code=${CODE}`)).toEqual({ kind: "code", code: CODE });
    expect(parseConfirmationUrl(`https://site.example/nouveau-mot-de-passe?code=${CODE}`)).toEqual({ kind: "none" });
  });

  it("une erreur, une adresse sans code ou illisible : rien à échanger", () => {
    expect(parseConfirmationUrl("https://site.example/?error=access_denied&error_code=otp_expired")).toEqual({ kind: "error" });
    expect(parseConfirmationUrl("https://site.example/#error=access_denied")).toEqual({ kind: "error" });
    expect(parseConfirmationUrl("https://site.example/feed")).toEqual({ kind: "none" });
    expect(parseConfirmationUrl("pas une adresse")).toEqual({ kind: "none" });
    expect(parseConfirmationUrl(null)).toEqual({ kind: "none" });
  });
});

describe("page « Aide et contact »", () => {
  it("a une adresse publique fixe (adresse d'assistance de l'App Store)", () => {
    expect(HELP_PATH).toBe("/aide");
  });

  it("montre l'adresse de contact, ou l'emplacement à compléter dans la langue active", () => {
    const placeholders = { fr: "[À compléter : adresse e-mail de contact]", en: "[To be completed: contact email address]" };
    expect(helpContactText("fr", "contact@exemple.fr", placeholders)).toBe("contact@exemple.fr");
    expect(helpContactText("fr", null, placeholders)).toBe(placeholders.fr);
    expect(helpContactText("en", null, placeholders)).toBe(placeholders.en);
  });

  it("a les mêmes questions en français et en anglais", () => {
    expect(en.help.faq).toHaveLength(fr.help.faq.length);
    setActiveLocale("en");
    expect(t.help.title).toBe("Help and contact");
    setActiveLocale("fr");
    expect(t.help.title).toBe("Aide et contact");
  });

  it("vouvoie en français", () => {
    const texts = [
      ...fr.help.faq.flatMap((item) => [item.q, item.a]),
      fr.help.intro,
      fr.help.contactBody,
      ...Object.values(fr.accountSafety),
    ];
    for (const text of texts) expect(text, text).not.toMatch(/\b(tu|te|toi|ton|ta|tes)\b/i);
  });
});
