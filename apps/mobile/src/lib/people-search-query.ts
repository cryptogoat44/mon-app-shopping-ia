/**
 * Texte envoyé à la recherche de profils. Le champ dit « Nom ou @pseudo » :
 * un pseudo ne contient jamais d'@ (lettres minuscules, chiffres, _), donc
 * l'@ tapé devant est retiré avant la recherche. Vide : aucune requête.
 */
export function profileSearchQuery(text: string): string {
  return text.trim().replace(/^@+/, "").trim();
}
