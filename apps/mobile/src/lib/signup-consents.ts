// Cases cochées à l'inscription (déclaration d'âge, conditions, politique),
// gardées en mémoire pour la seule session en cours (Lot Q, bloc 5 — décision
// du fondateur, 2026-09-25).
//
// La « Dernière étape » n'enregistre ces consentements sans redemander que
// si la personne vient de les donner à l'inscription, dans cette même
// session et pour ce même e-mail. Sinon — compte créé ailleurs (tableau de
// bord Supabase), inscription sur un autre appareil, page rechargée, ancien
// compte — les cases sont affichées et obligatoires : jamais de déclaration
// enregistrée sans avoir été faite. Volontairement en mémoire seulement :
// rien n'est écrit sur l'appareil.

let givenFor: string | null = null;

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/** À appeler quand l'inscription a été acceptée avec les cases cochées. */
export function rememberSignupConsents(email: string): void {
  givenFor = normalize(email);
}

/** Vrai si les cases viennent d'être cochées à l'inscription pour cet e-mail. */
export function hasSignupConsents(email: string | null | undefined): boolean {
  return !!email && givenFor !== null && givenFor === normalize(email);
}

/** Après enregistrement (ou déconnexion) : la mémoire ne sert qu'une fois. */
export function forgetSignupConsents(): void {
  givenFor = null;
}
