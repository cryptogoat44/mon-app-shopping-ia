// Version servie (lot « filets de sécurité », point 24 de la feuille de route
// V1) : la sonde /health dit quel commit tourne en ligne, pour vérifier une
// mise en ligne ou un retour arrière sans ouvrir Render (MISE-EN-LIGNE.md).
//
// Render donne le commit construit dans la variable RENDER_GIT_COMMIT (nom à
// vérifier dans la documentation de Render : aucune trace dans le dépôt avant
// ce lot). Seule une empreinte de commit est acceptée, réduite à ses 7
// premiers caractères (comme sur GitHub et dans Render) ; toute autre valeur,
// ou son absence (serveur lancé sur un ordinateur), donne null. Jamais un
// arrêt du serveur, jamais une autre valeur recopiée.

const COMMIT = /^[0-9a-f]{7,40}$/i;

/** Les 7 premiers caractères du commit, ou null. */
export function parseServedCommit(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return COMMIT.test(trimmed) ? trimmed.slice(0, 7).toLowerCase() : null;
}
