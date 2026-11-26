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
  /** false tant que l'originale arrivée apparaît en fondu (HD_FADE_MS) :
   * la vignette reste dessous, sinon le fond opaque de la tuile se verrait
   * un instant (lot « vitrine »). Absent : fondu terminé. */
  hdFaded?: boolean;
}

/** Durée du fondu de l'originale par-dessus la vignette (millisecondes). */
export const HD_FADE_MS = 180;

/** Ce qui est affiché. L'originale reste par-dessus sauf en échec ou plus
 * étroite que la vignette. La vignette est retirée seulement quand
 * l'originale arrivée est gardée ET que la vignette est réglée (arrivée ou en
 * échec) : avant, on ne pourrait plus comparer les deux largeurs. Et
 * seulement une fois le fondu de l'originale fini (hdFaded). */
export function twoStepLayers(state: TwoStepState): { showThumb: boolean; showHd: boolean } {
  const showHd = state.hd !== "failed" && !(state.hd === "loaded" && !keepHdImage(state.hdWidth, state.thumbWidth));
  const thumbSettled = state.thumbLoaded || state.thumbFailed;
  const showThumb = !state.thumbFailed && !(showHd && state.hd === "loaded" && thumbSettled && state.hdFaded !== false);
  return { showThumb, showHd };
}

// Tuile de pièce « Écrin » (retours du build 3, 26 novembre 2026,
// components/piece-tile.tsx) : la même tuile 4:5 partout. La photo entière
// est entourée des « bords prolongés » (ou de la couleur unie de ses
// bords, quand le serveur l'a mesurée) ; quand son ratio est proche de celui
// de la tuile, elle la remplit simplement (rognage léger accepté).
// Grilles : la pièce remplit toujours sa tuile (la plus grande possible).
// Grandes images : une petite image n'est jamais étirée au-delà d'un point
// d'écran par pixel de l'image (sinon elle devient floue en grand).

/** Ratio largeur / hauteur de toute tuile de pièce. */
export const TILE_RATIO = 4 / 5;
/** Écart de ratio en dessous duquel la photo remplit la tuile (12 %), dans les
 * deux sens : grandes images (jamais recadrées au-delà). */
export const FILL_TOLERANCE = 0.12;
/** Grilles, photo PLUS LARGE que la tuile : jusqu'à un carré (écart 25 %), elle
 * remplit la tuile, rognée de 10 % au plus de chaque côté (les pièces sont
 * centrées, les côtés sont du fond) — règle « recadrée » des maquettes Écrin
 * (lot « fidélité aux maquettes ») ; jamais pour une grande image. */
export const GRID_WIDE_FILL_TOLERANCE = 0.26;
/** Grilles, photo PLUS HAUTE que la tuile : 12 % seulement (une photo 3:4
 * remplit ; une photo en pied 2:3, écart 17 %, reste entière) : ni la tête
 * ni les pieds ne sont coupés. */
export const GRID_TALL_FILL_TOLERANCE = FILL_TOLERANCE;
/** Grandes images seulement : au plus ce nombre de points d'écran par pixel de l'image (1 = une vignette de 260 px ne dépasse pas 260 pt). */
export const HERO_MAX_POINTS_PER_PIXEL = 1;

export type PieceTileVariant = "hero" | "grid";

type Dimensions = { width: number; height: number };

function known(natural: Dimensions | null | undefined): natural is Dimensions {
  return Boolean(natural) && Number.isFinite(natural!.width) && Number.isFinite(natural!.height) && natural!.width > 0 && natural!.height > 0;
}

/** La photo remplit-elle la tuile ? L'écart se mesure au ratio du cadre réel
 * (4:5 tant que le cadre n'est pas mesuré ; carré pour la grande image du
 * Résultat). Grille : selon le ratio SEUL (jamais selon une couleur de fond
 * connue ou non, pour que le cadrage d'une tuile ne change pas après son
 * affichage) — GRID_WIDE_FILL_TOLERANCE (26 %) pour une photo plus large que
 * le cadre, GRID_TALL_FILL_TOLERANCE (12 %) pour une photo plus haute.
 * Grande image : FILL_TOLERANCE (12 %) dans les deux sens et, en plus,
 * seulement si remplir ne dépasse pas HERO_MAX_POINTS_PER_PIXEL. */
export function fillsTile(natural: Dimensions | null, frame: Dimensions, variant: PieceTileVariant): boolean {
  if (!known(natural)) return false;
  const frameRatio = frame.width > 0 && frame.height > 0 ? frame.width / frame.height : TILE_RATIO;
  const relative = natural.width / natural.height / frameRatio;
  const gap = Math.abs(relative - 1);
  if (variant === "grid") return gap <= (relative >= 1 ? GRID_WIDE_FILL_TOLERANCE : GRID_TALL_FILL_TOLERANCE);
  if (gap > FILL_TOLERANCE) return false;
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

// Lot « finitions de l'œil » : les « bords prolongés ». Une photo qui ne
// remplit pas sa tuile n'est plus posée sur une copie floue et agrandie
// d'elle-même (couture nette et halo autour de la photo) : chaque bande libre
// prolonge le bord même de la photo. Une copie de la photo, posée dans une
// vue de la taille de la bande qui coupe ce qui dépasse, est retournée et
// étirée dans un seul sens à partir du bord : seuls quelques points de la
// photo, pris tout près du bord, couvrent la bande. Sur un fond uni (blanc,
// gris, ivoire : la grande majorité des photos de boutique), la bande a
// exactement la couleur du fond ; un léger flou fond l'étirement sur une
// photo de mise en situation. Logique pure (les rectangles et l'étirement),
// la tuile ne fait que les dessiner.

/** Épaisseur (points) de la bande de photo étirée sur toute une bande libre. */
export const EDGE_STRIP = 3;
/** Flou (blurRadius d'expo-image) qui fond l'étirement : 3 % du petit côté de
 * la photo affichée, entre EDGE_BLUR_MIN et EDGE_BLUR_MAX (une grille floute
 * moins qu'une grande image, et prend sa bande plus près du bord). */
export const EDGE_BLUR_SHARE = 0.03;
export const EDGE_BLUR_MIN = 2;
export const EDGE_BLUR_MAX = 10;
/** Profondeur où la bande de photo est prise, en multiples du flou : sur le
 * site, le flou (filtre CSS) rend transparents les tout premiers points du
 * bord de la copie ; on les saute (3 écarts-types). */
export const EDGE_INSET_PER_BLUR = 3;

export type EdgeSide = "left" | "right" | "top" | "bottom";

export type EdgeBand = {
  side: EdgeSide;
  /** La vue qui coupe : un point de plus sous la photo (aucun fil de plinthe à la jointure, la photo opaque la recouvre). */
  box: { left: number; top: number; width: number; height: number };
  /** La copie de la photo, dans la vue, avant l'étirement. */
  copy: { left: number; top: number; width: number; height: number };
  /** blurRadius de la copie. */
  blur: number;
  /** Étirement retourné à partir du bord (transform de React Native : centre de la copie pour origine). */
  transform: [{ translateX: number }, { scaleX: number }] | [{ translateY: number }, { scaleY: number }];
};

/** Les bandes à dessiner autour d'une photo qui ne remplit pas sa tuile : une
 * par côté libre (photo plus haute que le cadre : gauche et droite ; plus large :
 * haut et bas ; petite image d'une grande tuile : les quatre). Aucune quand la
 * photo remplit la tuile, ou que sa taille ou le cadre ne sont pas connus (la
 * plinthe reste). */
export function edgeBands(natural: Dimensions | null, frame: Dimensions, variant: PieceTileVariant): EdgeBand[] {
  if (!known(natural) || !(frame.width > 0) || !(frame.height > 0) || fillsTile(natural, frame, variant)) return [];
  const shown = honestSize(natural, frame, variant);
  const photo = { left: (frame.width - shown.width) / 2, top: (frame.height - shown.height) / 2, width: shown.width, height: shown.height };
  const bands: EdgeBand[] = [];
  // u' = seam − s·(u − sample) : le point pris à `sample` (dans la photo) touche la jointure,
  // EDGE_STRIP points plus loin touchent le bord de la tuile. Avec l'origine au centre c de la
  // copie : translate(a) puis scale(−s), a = seam + s·sample − c·(1 + s).
  const shift = (seam: number, sample: number, center: number, stretch: number) => seam + stretch * sample - center * (1 + stretch);
  const blur = Math.round(Math.min(EDGE_BLUR_MAX, Math.max(EDGE_BLUR_MIN, Math.min(photo.width, photo.height) * EDGE_BLUR_SHARE)));
  const inset = blur * EDGE_INSET_PER_BLUR;
  const across = Math.min(inset, photo.width / 4);
  const down = Math.min(inset, photo.height / 4);
  const left = photo.left;
  const right = frame.width - photo.left - photo.width;
  // La copie dépasse la bande de `inset` le long du bord (étirée d'autant) : le bord transparent du
  // flou, sur le site, tombe hors de la vue qui coupe (sinon les coins de la bande s'assombrissent).
  const along = inset;
  const top = photo.top;
  const bottom = frame.height - photo.top - photo.height;
  if (left >= 0.5) {
    const stretch = left / EDGE_STRIP;
    const copy = { left: photo.left, top: -along, width: photo.width, height: photo.height + 2 * along };
    bands.push({ side: "left", box: { left: 0, top: photo.top, width: left + 1, height: photo.height }, copy, blur, transform: [{ translateX: shift(left, left + across, copy.left + copy.width / 2, stretch) }, { scaleX: -stretch }] });
  }
  if (right >= 0.5) {
    const stretch = right / EDGE_STRIP;
    const copy = { left: 1 - photo.width, top: -along, width: photo.width, height: photo.height + 2 * along };
    bands.push({ side: "right", box: { left: photo.left + photo.width - 1, top: photo.top, width: right + 1, height: photo.height }, copy, blur, transform: [{ translateX: shift(1, 1 - across, copy.left + copy.width / 2, stretch) }, { scaleX: -stretch }] });
  }
  // Haut et bas : toute la largeur de la tuile (la copie y est aussi étirée en largeur quand la photo ne touche pas les côtés).
  if (top >= 0.5) {
    const stretch = top / EDGE_STRIP;
    const copy = { left: -along, top: photo.top, width: frame.width + 2 * along, height: photo.height };
    bands.push({ side: "top", box: { left: 0, top: 0, width: frame.width, height: top + 1 }, copy, blur, transform: [{ translateY: shift(top, top + down, copy.top + copy.height / 2, stretch) }, { scaleY: -stretch }] });
  }
  if (bottom >= 0.5) {
    const stretch = bottom / EDGE_STRIP;
    const copy = { left: -along, top: 1 - photo.height, width: frame.width + 2 * along, height: photo.height };
    bands.push({ side: "bottom", box: { left: 0, top: photo.top + photo.height - 1, width: frame.width, height: bottom + 1 }, copy, blur, transform: [{ translateY: shift(1, 1 - down, copy.top + copy.height / 2, stretch) }, { scaleY: -stretch }] });
  }
  return bands;
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
 * une petite boîte centrée (bandes sur les quatre côtés : bords prolongés).
 * Taille ou cadre encore inconnus : oui. */
export function edgeColorApplies(natural: Dimensions | null, frame: Dimensions, variant: PieceTileVariant): boolean {
  if (variant === "grid" || !known(natural) || !(frame.width > 0) || !(frame.height > 0)) return true;
  const shown = honestSize(natural, frame, variant);
  return Math.abs(shown.width - frame.width) < 1 || Math.abs(shown.height - frame.height) < 1;
}
