import { describe, expect, it } from "vitest";
import { isTestBackend, newPasswordProblem, parseRecoveryUrl } from "../src/lib/password-recovery";

describe("lien de réinitialisation du mot de passe", () => {
  const TOKENS_LINK = "https://site.example/nouveau-mot-de-passe#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=recovery";

  // Revue de sécurité du 12 novembre 2026 (point « app-01 ») : un lien
  // fabriqué avec les jetons d'un autre compte ne connecte plus personne.
  it("en production, un lien qui porte des jetons n'ouvre aucune session : il est ignoré", () => {
    expect(parseRecoveryUrl(TOKENS_LINK)).toEqual({ kind: "none" });
    expect(parseRecoveryUrl(TOKENS_LINK, { testLinks: false })).toEqual({ kind: "none" });
    expect(parseRecoveryUrl(TOKENS_LINK.replace("https://site.example", "spotto:/"))).toEqual({ kind: "none" });
    // Le code du flux PKCE, lui, est toujours lu (seul l'appareil de la demande peut l'échanger).
    expect(parseRecoveryUrl("https://site.example/nouveau-mot-de-passe?code=abcDEF123456")).toEqual({ kind: "code", code: "abcDEF123456" });
  });

  it("base d'essai seulement : l'ancien format reste lu, pour les parcours automatiques", () => {
    expect(parseRecoveryUrl(TOKENS_LINK, { testLinks: true })).toEqual({ kind: "tokens", accessToken: "abc", refreshToken: "def" });
    expect(parseRecoveryUrl("https://site.example/x#access_token=abc&refresh_token=def&type=signup", { testLinks: true })).toEqual({ kind: "none" });
  });

  it("isTestBackend : vrai pour la base d'essai et elle seule", () => {
    expect(isTestBackend("https://sedfepcpmhilaxbrgdif.supabase.co")).toBe(true);
    expect(isTestBackend("https://selhqdqfrflsqivgxypf.supabase.co")).toBe(false);
    expect(isTestBackend("https://sedfepcpmhilaxbrgdif.supabase.co.exemple-pirate.com")).toBe(false);
    expect(isTestBackend("https://exemple.com/?x=sedfepcpmhilaxbrgdif.supabase.co")).toBe(false);
    for (const absent of [undefined, null, "", "pas une adresse"]) expect(isTestBackend(absent)).toBe(false);
  });

  it("reconnaît un lien expiré ou déjà utilisé (dans le fragment ou la requête)", () => {
    expect(parseRecoveryUrl("https://site.example/nouveau-mot-de-passe#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid")).toEqual({
      kind: "error",
      code: "otp_expired",
    });
    expect(parseRecoveryUrl("https://site.example/nouveau-mot-de-passe?error=access_denied&error_code=otp_expired")).toEqual({ kind: "error", code: "otp_expired" });
  });

  it("sans rien dans l'adresse : aucun lien", () => {
    expect(parseRecoveryUrl("https://site.example/nouveau-mot-de-passe")).toEqual({ kind: "none" });
    expect(parseRecoveryUrl(null)).toEqual({ kind: "none" });
  });

  it("vérifie le nouveau mot de passe", () => {
    expect(newPasswordProblem("court", "court")).toBe("too_short");
    expect(newPasswordProblem("assez-long-1", "assez-long-2")).toBe("mismatch");
    expect(newPasswordProblem("assez-long-1", "assez-long-1")).toBeNull();
  });
});
