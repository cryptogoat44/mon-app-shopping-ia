// Nom de travail — pas encore sécurisé juridiquement (marque, .com, App
// Store). Si le nom change, ce fichier est le seul endroit à modifier avec
// app.json.
export const APP_NAME = "spotto";
export const APP_NAME_DISPLAY = "Spotto";

// Discutée mais pas validée — tranche avec la retenue du reste de la
// direction artistique. Voir la page « Typographie » du projet Claude
// Design pour la remarque complète.
export const BASELINE = "L'identification discrète des pièces qui comptent.";

export const LEGAL_LINKS = {
  terms: null as string | null,
  privacy: null as string | null,
};

// Adresse publique du site : sert aux liens partagés vers une publication
// (Lot F). Sur le web, l'adresse du site en cours est utilisée à la place.
export const PUBLIC_WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? "https://mon-app-shopping-ia-web.onrender.com";
