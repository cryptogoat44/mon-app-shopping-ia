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
//
// Retours du build 2 (24 novembre 2026, « la qualité est très mauvaise quand
// je reviens dans ma wishlist ») : la grande carte et les fiches (« large »)
// passent aussi en deux temps (plus de cadre vide pendant le chargement), et
// les grilles des Envies et du Vault aussi (« card », lot Envies et images ;
// la grille des résultats reste en « small », pour la 4G). Partout en deux
// temps, l'originale ne remplace la vignette que si elle n'est pas plus
// étroite qu'elle : certains marchands donnent une « originale » plus petite
// que la vignette de Google (lib/wishShare.ts du serveur) ; on garde alors la
// plus nette des deux, jamais la plus petite (keepHdImage, twoStepLayers).

/** « small » : case d'une grille ; « card » : carte des résultats (deux
 * temps) ; « large » : grande carte, fiche. */
export type PieceImageSize = "small" | "card" | "large";

/** Carte des résultats, grande carte, fiche : la vignette à montrer d'abord et l'originale qui la
 * remplacera, quand les deux existent et diffèrent ; sinon null (une seule
 * image, chargée comme dans une petite case). */
export function twoStepSources(size: PieceImageSize, hdUri: string | null | undefined, thumbUri: string | null | undefined): { thumb: string; hd: string } | null {
  if (size === "small" || !hdUri || !thumbUri || hdUri === thumbUri) return null;
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

/** L'originale arrivée remplace-t-elle la vignette ? Non seulement quand les
 * deux largeurs réelles sont connues et que l'originale est plus étroite ;
 * une largeur inconnue (0, absente) ne retire jamais l'originale. */
export function keepHdImage(hdWidth: number | null | undefined, thumbWidth: number | null | undefined): boolean {
  if (!hdWidth || !thumbWidth || hdWidth <= 0 || thumbWidth <= 0) return true;
  return hdWidth >= thumbWidth;
}

/** État du chargement en deux temps : l'originale (en cours, arrivée avec sa
 * largeur, en échec) et la vignette (arrivée avec sa largeur, en échec). */
export interface TwoStepState {
  hd: "loading" | "loaded" | "failed";
  hdWidth: number | null;
  thumbLoaded: boolean;
  thumbWidth: number | null;
  thumbFailed: boolean;
}

/** Ce qui est affiché. L'originale reste par-dessus sauf en échec ou plus
 * étroite que la vignette. La vignette est retirée seulement quand
 * l'originale arrivée est gardée ET que la vignette est réglée (arrivée ou en
 * échec) : avant, on ne pourrait plus comparer les deux largeurs. */
export function twoStepLayers(state: TwoStepState): { showThumb: boolean; showHd: boolean } {
  const showHd = state.hd !== "failed" && !(state.hd === "loaded" && !keepHdImage(state.hdWidth, state.thumbWidth));
  const thumbSettled = state.thumbLoaded || state.thumbFailed;
  const showThumb = !state.thumbFailed && !(showHd && state.hd === "loaded" && thumbSettled);
  return { showThumb, showHd };
}
