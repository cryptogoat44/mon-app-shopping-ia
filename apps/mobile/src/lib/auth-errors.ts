// Supabase (GoTrue) renvoie ses messages d'erreur en anglais, quel que soit
// le projet — il n'y a pas d'option de localisation côté service. On mappe
// ici les cas les plus courants vers un message français ; tout le reste
// tombe sur un message générique plutôt que d'afficher du texte anglais brut
// à un utilisateur non-technique.
const KNOWN_PATTERNS: Array<{ match: RegExp; message: string }> = [
  { match: /invalid login credentials/i, message: "Email ou mot de passe incorrect." },
  { match: /email not confirmed/i, message: "Confirmez votre email avant de vous connecter (vérifiez votre boîte de réception, y compris les spams)." },
  { match: /user already registered/i, message: "Un compte existe déjà avec cet email." },
  { match: /password should be at least/i, message: "Le mot de passe est trop court." },
  { match: /unable to validate email address/i, message: "Adresse email invalide." },
  { match: /rate limit/i, message: "Trop de tentatives, réessayez dans quelques minutes." },
  { match: /network request failed/i, message: "Connexion impossible, vérifiez votre réseau." },
  { match: /signups? not allowed/i, message: "Les inscriptions ne sont pas ouvertes pour le moment." },
];

export function translateAuthError(message: string): string {
  const found = KNOWN_PATTERNS.find((p) => p.match.test(message));
  return found?.message ?? "Une erreur est survenue, réessayez.";
}
