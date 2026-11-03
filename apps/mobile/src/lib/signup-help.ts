// Inscription (lot « premier essai ») : ce qui manque avant « Créer mon
// compte », l'attente entre deux envois de l'e-mail de confirmation, et la
// lecture de la réponse de Supabase à l'inscription. Logique pure, testée.
// Imports relatifs : fichier testé par vitest.
import { t } from "../i18n";

export type SignUpField = "email" | "password" | "confirmPassword" | "age" | "consent";

export interface SignUpForm {
  email: string;
  password: string;
  confirmPassword: string;
  ageChecked: boolean;
  consentChecked: boolean;
}

/** Ce qui manque encore, dans l'ordre de l'écran : « Créer mon compte » reste
 * grisé tant que la liste n'est pas vide. La longueur du mot de passe et la
 * confirmation identique sont vérifiées à l'appui, avec leur propre message. */
export function missingSignUpFields(form: SignUpForm): SignUpField[] {
  const missing: SignUpField[] = [];
  if (!form.email.trim()) missing.push("email");
  if (!form.password) missing.push("password");
  if (!form.confirmPassword) missing.push("confirmPassword");
  if (!form.ageChecked) missing.push("age");
  if (!form.consentChecked) missing.push("consent");
  return missing;
}

/** « Pour continuer, il reste à … », lu dans la langue active ; null quand rien ne manque. */
export function missingFieldsText(missing: readonly SignUpField[]): string | null {
  if (missing.length === 0) return null;
  const items = missing.map((field) => t.firstTry.signUp.missingItem[field]);
  const last = items.pop()!;
  return t.firstTry.signUp.missing(items.length > 0 ? t.firstTry.signUp.lastItem(items.join(", "), last) : last);
}

/** Une minute entre deux envois de l'e-mail de confirmation, comme le délai
 * que Supabase impose par adresse. */
export const RESEND_COOLDOWN_MS = 60_000;

/** Secondes à attendre avant un nouvel envoi (0 : tout de suite). */
export function secondsUntil(availableAt: number | null, now: number): number {
  return availableAt === null ? 0 : Math.max(0, Math.ceil((availableAt - now) / 1000));
}

/** Refus « trop tôt » de Supabase (« For security purposes, you can only
 * request this after 42 seconds. ») : l'attente qu'il impose, en secondes ;
 * null pour tout autre refus. */
export function serverWaitSeconds(message: string): number | null {
  const match = /after (\d+) seconds?/i.exec(message);
  return match ? Number(match[1]) : null;
}

export type SignUpOutcome = "signed_in" | "confirmation_sent" | "already_registered";

/** Issue d'une inscription acceptée sans erreur par supabase.auth.signUp.
 *
 * Hypothèse, d'après @supabase/auth-js 2.114 (GoTrueClient.signUp, et le code
 * du serveur d'authentification qu'il décrit) : quand la confirmation par
 * e-mail est activée et que l'adresse a déjà un compte confirmé, Supabase ne
 * renvoie aucune erreur (pour ne pas révéler qui est inscrit) mais un compte
 * factice, sans session et SANS identité (`user.identities` vide), et
 * n'envoie aucun e-mail. Une adresse inscrite mais pas encore confirmée
 * renvoie son vrai compte, avec son identité, et l'e-mail repart : c'est une
 * vraie attente de confirmation. Sans la confirmation par e-mail, un compte
 * existant donne l'erreur « User already registered » (auth-errors.ts). */
export function signUpOutcome(data: { session: object | null; user: { identities?: readonly unknown[] | null } | null }): SignUpOutcome {
  if (data.session) return "signed_in";
  const identities = data.user?.identities;
  return Array.isArray(identities) && identities.length === 0 ? "already_registered" : "confirmation_sent";
}
