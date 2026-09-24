// Adresse complète au tout premier chargement de la page (web), capturée
// AVANT que la navigation ne réécrive l'adresse : le lien de
// réinitialisation du mot de passe transporte ses jetons dans la partie
// « # », que le routeur ne conserve pas. Importé par le layout racine.
export const INITIAL_WEB_URL: string | null = typeof window !== "undefined" && window.location ? window.location.href : null;
