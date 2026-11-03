// E-mail tapé à l'inscription ou à la connexion, repris par l'écran suivant
// (connexion, « Mot de passe oublié ») pour ne pas le retaper (lot « premier
// essai »). En mémoire seulement, comme les cases cochées
// (signup-consents.ts) : jamais dans l'adresse de la page (historique du
// navigateur, rapports d'erreur), jamais écrit sur l'appareil.

let remembered: string | null = null;

export function rememberEmail(email: string): void {
  remembered = email.trim() || null;
}

/** E-mail à préremplir ; chaîne vide s'il n'y en a pas. */
export function rememberedEmail(): string {
  return remembered ?? "";
}

/** Une fois connecté : plus rien à préremplir. */
export function forgetEmail(): void {
  remembered = null;
}
