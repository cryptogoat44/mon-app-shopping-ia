// Ordre des images d'une proposition selon la taille de sa case (lot
// résultats lisibles). Une petite case (grilles des résultats, récentes,
// Envies, Vault) charge d'abord la vignette légère de Google : télécharger
// l'image d'origine du marchand pour une case de 100 points laissait les
// cases grises en 4G. La grande carte et les fiches chargent d'abord
// l'originale, nette en grand. L'autre image ne sert qu'en repli, en cas
// d'erreur. Logique pure, testée.

/** « small » : case d'une grille ; « large » : grande carte, fiche. */
export type PieceImageSize = "small" | "large";

/** Adresses à essayer, dans l'ordre, sans adresse vide ni doublon (une même
 * adresse en échec n'est jamais redemandée). */
export function imageSources(size: PieceImageSize, hdUri: string | null | undefined, thumbUri: string | null | undefined): string[] {
  const ordered = size === "small" ? [thumbUri, hdUri] : [hdUri, thumbUri];
  return ordered.filter((uri, position): uri is string => Boolean(uri) && ordered.indexOf(uri) === position);
}

/** L'image à afficher après `errors` échecs ; null quand toutes ont échoué :
 * le fond de la case reste, sans nouvel essai. */
export function imageAfterErrors(sources: readonly string[], errors: number): string | null {
  return sources[errors] ?? null;
}
