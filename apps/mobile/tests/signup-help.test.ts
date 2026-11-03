import { afterEach, describe, expect, it } from "vitest";
import { setActiveLocale, t } from "../src/i18n";
import { authErrorKey, translateAuthError } from "../src/lib/auth-errors";
import { forgetEmail, rememberEmail, rememberedEmail } from "../src/lib/remembered-email";
import {
  RESEND_COOLDOWN_MS,
  missingFieldsText,
  missingSignUpFields,
  secondsUntil,
  serverWaitSeconds,
  signUpOutcome,
  type SignUpForm,
} from "../src/lib/signup-help";

// Lot « premier essai » : inscription sans accroc — ce qui manque quand
// « Créer mon compte » est grisé, « Renvoyer l'e-mail » avec une minute
// d'attente, le compte qui existe déjà, l'e-mail repris d'un écran à l'autre.

const empty: SignUpForm = { email: "", password: "", confirmPassword: "", ageChecked: false, consentChecked: false };
const complete: SignUpForm = { email: "camille@exemple.fr", password: "secret-123", confirmPassword: "secret-123", ageChecked: true, consentChecked: true };

afterEach(() => {
  setActiveLocale("fr");
  forgetEmail();
});

describe("« Créer mon compte » grisé : dire ce qui manque", () => {
  it("tout, dans l'ordre de l'écran, au départ ; rien une fois le formulaire rempli", () => {
    expect(missingSignUpFields(empty)).toEqual(["email", "password", "confirmPassword", "age", "consent"]);
    expect(missingSignUpFields(complete)).toEqual([]);
  });

  it("les cases à cocher seules : le cas qui n'affichait jamais aucun message", () => {
    expect(missingSignUpFields({ ...complete, ageChecked: false, consentChecked: false })).toEqual(["age", "consent"]);
  });

  it("un e-mail fait d'espaces manque encore", () => {
    expect(missingSignUpFields({ ...complete, email: "   " })).toEqual(["email"]);
  });

  it("une phrase dans la langue active, avec « et » avant le dernier élément ; rien quand tout est là", () => {
    expect(missingFieldsText(["consent"])).toBe("Pour continuer, il reste à accepter les conditions.");
    expect(missingFieldsText(["age", "consent"])).toBe("Pour continuer, il reste à certifier votre âge et accepter les conditions.");
    expect(missingFieldsText(missingSignUpFields(empty))).toBe(
      "Pour continuer, il reste à indiquer votre e-mail, choisir un mot de passe, confirmer le mot de passe, certifier votre âge et accepter les conditions."
    );
    expect(missingFieldsText([])).toBeNull();
    setActiveLocale("en");
    expect(missingFieldsText(["age", "consent"])).toBe("To continue, please confirm your age and accept the terms.");
  });

  it("la règle des 8 caractères est écrite dès le départ, dans les deux langues", () => {
    expect(t.firstTry.signUp.passwordHint).toBe("Au moins 8 caractères");
    setActiveLocale("en");
    expect(t.firstTry.signUp.passwordHint).toBe("At least 8 characters");
  });
});

describe("« Renvoyer l'e-mail » : une minute entre deux envois", () => {
  it("une minute, comme le délai de Supabase par adresse", () => {
    expect(RESEND_COOLDOWN_MS).toBe(60_000);
  });

  it("secondes restantes arrondies au-dessus ; 0 sans envoi récent ou une fois l'attente passée", () => {
    const sentAt = 1_000_000;
    expect(secondsUntil(null, sentAt)).toBe(0);
    expect(secondsUntil(sentAt + RESEND_COOLDOWN_MS, sentAt)).toBe(60);
    expect(secondsUntil(sentAt + RESEND_COOLDOWN_MS, sentAt + 59_001)).toBe(1);
    expect(secondsUntil(sentAt + RESEND_COOLDOWN_MS, sentAt + 60_000)).toBe(0);
    expect(secondsUntil(sentAt + RESEND_COOLDOWN_MS, sentAt + 90_000)).toBe(0);
  });

  it("refus « trop tôt » de Supabase : l'attente qu'il impose ; tout autre refus : null", () => {
    expect(serverWaitSeconds("For security purposes, you can only request this after 42 seconds.")).toBe(42);
    expect(serverWaitSeconds("For security purposes, you can only request this after 1 second.")).toBe(1);
    expect(serverWaitSeconds("Email rate limit exceeded")).toBeNull();
    expect(serverWaitSeconds("Network request failed")).toBeNull();
  });

  it("libellé du bouton pendant l'attente (espace insécable avant « s »)", () => {
    expect(t.firstTry.signUp.resendIn(42)).toBe("Renvoyer l'e-mail dans 42\u00a0s");
    setActiveLocale("en");
    expect(t.firstTry.signUp.resendIn(42)).toBe("Resend the email in 42\u00a0s");
  });
});

describe("réponse de Supabase à l'inscription", () => {
  const identity = { identity_id: "i1", provider: "email" };

  it("session ouverte (confirmation par e-mail coupée) : connecté", () => {
    expect(signUpOutcome({ session: { access_token: "jeton" }, user: { identities: [identity] } })).toBe("signed_in");
  });

  it("nouveau compte, sans session : l'e-mail de confirmation est parti", () => {
    expect(signUpOutcome({ session: null, user: { identities: [identity] } })).toBe("confirmation_sent");
  });

  it("compte factice sans identité : l'adresse a déjà un compte, aucun e-mail ne partira", () => {
    expect(signUpOutcome({ session: null, user: { identities: [] } })).toBe("already_registered");
  });

  it("identités absentes ou compte absent : prudence, on attend l'e-mail comme avant", () => {
    expect(signUpOutcome({ session: null, user: {} })).toBe("confirmation_sent");
    expect(signUpOutcome({ session: null, user: { identities: null } })).toBe("confirmation_sent");
    expect(signUpOutcome({ session: null, user: null })).toBe("confirmation_sent");
  });
});

describe("erreurs de Supabase reconnues", () => {
  it("« e-mail non confirmé » et « compte existant » : reconnus, pour proposer la suite", () => {
    expect(authErrorKey("Email not confirmed")).toBe("emailNotConfirmed");
    expect(authErrorKey("User already registered")).toBe("alreadyRegistered");
    expect(authErrorKey("Something unexpected")).toBeNull();
  });

  it("traduction inchangée : le cas connu, sinon le message générique", () => {
    expect(translateAuthError("Email not confirmed")).toBe(t.auth.errors.emailNotConfirmed);
    expect(translateAuthError("Something unexpected")).toBe(t.common.genericError);
    expect(translateAuthError("Email rate limit exceeded")).toBe(t.auth.errors.rateLimited);
  });
});

describe("e-mail repris d'un écran à l'autre (en mémoire seulement)", () => {
  it("sans espaces autour ; vide au départ, après « oubli » ou pour un champ vidé", () => {
    expect(rememberedEmail()).toBe("");
    rememberEmail("  camille@exemple.fr ");
    expect(rememberedEmail()).toBe("camille@exemple.fr");
    rememberEmail("   ");
    expect(rememberedEmail()).toBe("");
    rememberEmail("camille@exemple.fr");
    forgetEmail();
    expect(rememberedEmail()).toBe("");
  });
});
