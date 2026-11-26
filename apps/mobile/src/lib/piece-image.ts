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

// Tuile de pièce « Écrin » (retours du build 3, 26 novembre 2026,
// components/piece-tile.tsx) : la même tuile 4:5 partout. La photo entière
// est posée sur une copie floue d'elle-même ; quand son ratio est proche de
// celui de la tuile, elle la remplit simplement (rognage léger accepté).
// Grilles : la pièce remplit toujours sa tuile (la plus grande possible).
// Grandes images : une petite image n'est jamais étirée au-delà d'un point
// d'écran par pixel de l'image (sinon elle devient floue en grand).

/** Ratio largeur / hauteur de toute tuile de pièce. */
export const TILE_RATIO = 4 / 5;
/** Écart de ratio en dessous duquel la photo remplit la tuile (12 %). */
export const FILL_TOLERANCE = 0.12;
/** Grandes images seulement : au plus ce nombre de points d'écran par pixel de l'image (1 = une vignette de 260 px ne dépasse pas 260 pt). */
export const HERO_MAX_POINTS_PER_PIXEL = 1;

export type PieceTileVariant = "hero" | "grid";

type Dimensions = { width: number; height: number };

function known(natural: Dimensions | null | undefined): natural is Dimensions {
  return Boolean(natural) && Number.isFinite(natural!.width) && Number.isFinite(natural!.height) && natural!.width > 0 && natural!.height > 0;
}

/** La photo remplit-elle la tuile ? Grille : dès que le ratio est à 12 % près. Grande image : en plus, seulement si remplir ne dépasse pas HERO_MAX_POINTS_PER_PIXEL. */
export function fillsTile(natural: Dimensions | null, frame: Dimensions, variant: PieceTileVariant): boolean {
  if (!known(natural)) return false;
  const gap = Math.abs(natural.width / natural.height / TILE_RATIO - 1);
  if (gap > FILL_TOLERANCE) return false;
  if (variant === "grid") return true;
  // Remplir (comme cover) agrandit l'image du plus grand des deux rapports.
  const scale = Math.max(frame.width / natural.width, frame.height / natural.height);
  return scale <= HERO_MAX_POINTS_PER_PIXEL;
}

/** Taille d'affichage, en points : tient dans le cadre (comme contain). Grille : toujours le plus grand possible dans le cadre. Grande image : jamais plus de HERO_MAX_POINTS_PER_PIXEL point par pixel de l'image. Dimensions inconnues ou nulles : le cadre. */
export function honestSize(natural: Dimensions | null, frame: Dimensions, variant: PieceTileVariant): Dimensions {
  if (!known(natural)) return { width: frame.width, height: frame.height };
  const contain = Math.min(frame.width / natural.width, frame.height / natural.height);
  const scale = variant === "hero" ? Math.min(contain, HERO_MAX_POINTS_PER_PIXEL) : contain;
  return { width: natural.width * scale, height: natural.height * scale };
}

/** Couleur de fond donnée par le serveur (lot 9) : "#RRGGBB" seulement, sinon null. */
export function edgeBackground(value: string | null | undefined): string | null {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : null;
}

/** Lot « couleur des bords » : le serveur ne mesure que les deux bords où une
 * photo contenue dans la tuile 4:5 laisse des bandes ; il suppose qu'elle
 * touche les deux autres côtés. Le fond uni ne vaut donc que si la photo
 * affichée touche le cadre sur un axe : toujours en grille, et en grande
 * image seulement quand la règle d'un point par pixel ne la réduit pas en
 * une petite boîte centrée (bandes sur les quatre côtés : copie floue).
 * Taille ou cadre encore inconnus : oui. */
export function edgeColorApplies(natural: Dimensions | null, frame: Dimensions, variant: PieceTileVariant): boolean {
  if (variant === "grid" || !known(natural) || !(frame.width > 0) || !(frame.height > 0)) return true;
  const shown = honestSize(natural, frame, variant);
  return Math.abs(shown.width - frame.width) < 1 || Math.abs(shown.height - frame.height) < 1;
}
