// BOUTIQUES MASQUÉES — liste que le fondateur peut modifier lui-même.
//
// À quoi elle sert : les offres de ces boutiques ne sont JAMAIS montrées aux
// membres, ni rangées avec leurs recherches (même si c'étaient les seules
// trouvées). À réserver aux fausses boutiques avérées : une boutique
// seulement douteuse est déjà rangée plus bas, ou retirée, par les règles de
// src/lib/shopTrust.ts.
//
// Comment ajouter ou retirer une boutique :
// 1. Une boutique par ligne : son adresse, sans « https:// » ni « www. »,
//    en minuscules, entre guillemets droits, suivie d'une virgule.
//    Exemple :   "fausse-boutique-exemple.top",
// 2. Les sous-domaines sont compris : "exemple.top" vaut aussi pour
//    shop.exemple.top.
// 3. Une ligne qui commence par // est une note : elle ne compte pas.
// Les tests (pnpm run test:hors-base, dans apps/backend) vérifient
// l'écriture de chaque adresse.
export const BOUTIQUES_MASQUEES: readonly string[] = [
  // Aucune pour l'instant.
];

// Mots qui suffisent à masquer une boutique quand ils figurent dans son
// adresse : des boutiques qui annoncent elles-mêmes vendre des copies
// (contrefaçons). Un mot par ligne, en minuscules, sans accent.
export const MOTS_MASQUES: readonly string[] = ["replica", "replique", "contrefacon", "counterfeit"];
