import { t } from "@/i18n";

// Supabase (GoTrue) renvoie ses messages d'erreur en anglais, quel que soit
// le projet — il n'y a pas d'option de localisation côté service. On mappe
// ici les cas les plus courants vers un message dans la langue de l'app ;
// tout le reste tombe sur un message générique plutôt que d'afficher du
// texte technique brut à un utilisateur non-technique.
type AuthErrorKey = keyof typeof t.auth.errors;

const KNOWN_PATTERNS: Array<{ match: RegExp; key: AuthErrorKey }> = [
  { match: /invalid login credentials/i, key: "invalidCredentials" },
  { match: /email not confirmed/i, key: "emailNotConfirmed" },
  { match: /user already registered/i, key: "alreadyRegistered" },
  { match: /password should be at least/i, key: "passwordTooShort" },
  { match: /should be different from the old password/i, key: "samePassword" },
  { match: /auth session missing|session.*expired|jwt expired/i, key: "linkExpired" },
  { match: /unable to validate email address/i, key: "invalidEmail" },
  { match: /rate limit/i, key: "rateLimited" },
  { match: /network request failed/i, key: "network" },
  { match: /signups? not allowed/i, key: "signupsClosed" },
];

export function translateAuthError(message: string): string {
  const found = KNOWN_PATTERNS.find((p) => p.match.test(message));
  return found ? t.auth.errors[found.key] : t.common.genericError;
}
