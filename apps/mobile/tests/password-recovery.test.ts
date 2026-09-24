import { describe, expect, it } from "vitest";
import { newPasswordProblem, parseRecoveryUrl } from "../src/lib/password-recovery";

describe("lien de réinitialisation du mot de passe", () => {
  it("lit les jetons d'une session de réinitialisation", () => {
    expect(
      parseRecoveryUrl("https://site.example/nouveau-mot-de-passe#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=recovery")
    ).toEqual({ kind: "tokens", accessToken: "abc", refreshToken: "def" });
  });

  it("ignore des jetons qui ne viennent pas d'une réinitialisation", () => {
    expect(parseRecoveryUrl("https://site.example/x#access_token=abc&refresh_token=def&type=signup")).toEqual({ kind: "none" });
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
