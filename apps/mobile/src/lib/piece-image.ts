// Ordre des images d'une proposition selon la taille de sa case (lot
// résultats lisibles). Une petite case (grilles des résultats, récentes,
// Envies, Vault) charge d'abord la vignette légère de Google : télécharger
// l'image d'origine du marchand pour une case de 100 points laissait les
// cases grises en 4G. La grande carte et les fiches chargent d'abord
// l'originale, nette en grand. L'autre image ne sert qu'en repli, en cas
// d'erreur. Logique pure, testée.
//
// Carte des résultats (« card », grille « Autres propositions » et
// compléments) : chargement en deux temps (demande du fondateur, 17 novembre
// 2026 — la vignette de Google, agrandie dans ces cartes plus grandes, était
// floue) : la vignette s'affiche tout de suite, puis l'originale la remplace
// dès qu'elle est arrivée ; si le marchand la bloque, la vignette reste.

/** « small » : case d'une grille ; « card » : carte des résultats (deux
 * temps) ; « large » : grande carte, fiche. */
export type PieceImageSize = "small" | "card" | "large";

/** Carte des résultats : la vignette à montrer d'abord et l'originale qui la
 * remplacera, quand les deux existent et diffèrent ; sinon null (une seule
 * image, chargée comme dans une petite case). */
export function twoStepSources(size: PieceImageSize, hdUri: string | null | undefined, thumbUri: string | null | undefined): { thumb: string; hd: string } | null {
  if (size !== "card" || !hdUri || !thumbUri || hdUri === thumbUri) return null;
  return { thumb: thumbUri, hd: hdUri };
}

/** Adresses à essayer, dans l'ordre, sans adresse vide ni doublon (une même
 * adresse en échec n'est jamais redemandée). */
export function imageSources(size: PieceImageSize, hdUri: string | null | undefined, thumbUri: string | null | undefined): string[] {
  const ordered = size === "large" ? [hdUri, thumbUri] : [thumbUri, hdUri];
  return ordered.filter((uri, position): uri is string => Boolean(uri) && ordered.indexOf(uri) === position);
}

/** L'image à afficher après `errors` échecs ; null quand toutes ont échoué :
 * le fond de la case reste, sans nouvel essai. */
export function imageAfterErrors(sources: readonly string[], errors: number): string | null {
  return sources[errors] ?? null;
}
