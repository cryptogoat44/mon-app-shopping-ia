// Image d'une pièce en plein écran (retours du build 2, 24 novembre 2026 :
// « la qualité des images quand elles sont grossies est nulle et les gens ne
// peuvent pas voir correctement la pièce »). Calcul pur du zoom et du
// déplacement, testé ; l'écran est components/image-viewer.tsx.
//
// L'image entière tient dans le cadre (« contain ») au zoom 1. Zoomée, elle
// grandit autour du centre du cadre et se déplace au doigt, sans jamais
// laisser son cadre agrandi sortir de l'écran : le bord de l'image agrandie
// s'arrête au bord du cadre.

export const VIEWER_MIN_ZOOM = 1;
export const VIEWER_MAX_ZOOM = 4;
export const VIEWER_ZOOM_STEP = 1;
/** Zoom d'un double toucher depuis l'image entière. */
export const VIEWER_DOUBLE_TAP_ZOOM = 2.5;
/** Deux touchers plus rapprochés que ceci (ms) font un double toucher. */
export const DOUBLE_TAP_MS = 280;

export interface ViewerFrame {
  width: number;
  height: number;
}

export interface ViewerView {
  zoom: number;
  x: number;
  y: number;
}

export const VIEWER_START: ViewerView = { zoom: VIEWER_MIN_ZOOM, x: 0, y: 0 };

function clamp(value: number, min: number, max: number): number {
  // « + 0 » : jamais de -0 (même position, mais comparée différemment).
  return Math.min(max, Math.max(min, value)) + 0;
}

/** Déplacement permis : la moitié de ce qui dépasse du cadre, de chaque côté. */
export function clampViewerView(view: ViewerView, frame: ViewerFrame): ViewerView {
  const zoom = clamp(Number.isFinite(view.zoom) ? view.zoom : VIEWER_MIN_ZOOM, VIEWER_MIN_ZOOM, VIEWER_MAX_ZOOM);
  const maxX = Math.max(0, (frame.width * zoom - frame.width) / 2);
  const maxY = Math.max(0, (frame.height * zoom - frame.height) / 2);
  return { zoom, x: clamp(view.x || 0, -maxX, maxX), y: clamp(view.y || 0, -maxY, maxY) };
}

/** Nouveau zoom autour du centre du cadre : ce qui y est reste au centre. */
export function zoomViewerTo(view: ViewerView, zoom: number, frame: ViewerFrame): ViewerView {
  const next = clamp(zoom, VIEWER_MIN_ZOOM, VIEWER_MAX_ZOOM);
  const ratio = next / view.zoom;
  return clampViewerView({ zoom: next, x: view.x * ratio, y: view.y * ratio }, frame);
}

/** Déplacement au doigt depuis la vue du début du geste ; sans effet tant
 * que l'image n'est pas zoomée. */
export function panViewer(start: ViewerView, dx: number, dy: number, frame: ViewerFrame): ViewerView {
  return clampViewerView({ zoom: start.zoom, x: start.x + dx, y: start.y + dy }, frame);
}

/** Double toucher : zoome depuis l'image entière, revient à l'image entière sinon. */
export function doubleTapViewer(view: ViewerView, frame: ViewerFrame): ViewerView {
  return view.zoom > VIEWER_MIN_ZOOM ? VIEWER_START : zoomViewerTo(VIEWER_START, VIEWER_DOUBLE_TAP_ZOOM, frame);
}

/** Zoom pendant un pincement : celui du début, multiplié par l'écart des doigts. */
export function pinchViewerZoom(startZoom: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return startZoom;
  return clamp((startZoom * distance) / startDistance, VIEWER_MIN_ZOOM, VIEWER_MAX_ZOOM);
}

/** Un geste presque immobile est un toucher (et non un déplacement). */
export function isTap(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) < 8;
}

// Zoom à deux doigts SUR PLACE (retours du build 3, 25 novembre 2026 :
// « qu'avec deux doigts seulement on puisse zoomer dessus sans cliquer » ;
// « en relâchant simplement les deux doigts […] revenir au point de
// départ »). iPhone seulement : la tuile de la fiche grandit sous les
// doigts, autour du point entre eux, et revient à sa place au dernier doigt
// levé (components/image-viewer.tsx, EnlargeableImage). Les fonctions
// ci-dessus restent celles du plein écran (site et VoiceOver).

/** Zoom sur place (iPhone) : bornes du pincement. */
export const INPLACE_MIN_ZOOM = 1;
export const INPLACE_MAX_ZOOM = 4; // = VIEWER_MAX_ZOOM

/** Un point p de la tuile (mesuré depuis son centre) est affiché en scale·p + (x, y). */
export interface InPlaceView {
  scale: number;
  x: number;
  y: number;
}

export const INPLACE_START: InPlaceView = { scale: INPLACE_MIN_ZOOM, x: 0, y: 0 };

/**
 * Pincement autour du point entre les deux doigts (pas autour du centre).
 * focal = milieu des deux doigts au début du pincement, mesuré depuis le
 * CENTRE de la tuile (pt) ; moved = déplacement de ce milieu depuis ce
 * début (pt) ; ratio = écart actuel / écart du début. `from` : la vue au
 * début du pincement (INPLACE_START la plupart du temps ; la vue en cours
 * quand le deuxième doigt se repose). Le point de l'image qui était sous
 * les doigts reste sous les doigts. Ratio illisible (NaN, Infinity) : 1.
 */
export function pinchInPlace(
  focal: { x: number; y: number },
  moved: { dx: number; dy: number },
  ratio: number,
  from: InPlaceView = INPLACE_START
): InPlaceView {
  const safeRatio = Number.isFinite(ratio) ? ratio : 1;
  const scale = clamp(from.scale * safeRatio, INPLACE_MIN_ZOOM, INPLACE_MAX_ZOOM);
  // Le point de la tuile sous les doigts au début (depuis son centre).
  const pointX = (focal.x - from.x) / from.scale;
  const pointY = (focal.y - from.y) / from.scale;
  return { scale, x: focal.x + (moved.dx || 0) - scale * pointX + 0, y: focal.y + (moved.dy || 0) - scale * pointY + 0 };
}

/** Un doigt levé : le zoom reste, le doigt restant déplace l'image (sans borne : elle revient au relâché). */
export function panInPlace(from: InPlaceView, dx: number, dy: number): InPlaceView {
  return { scale: from.scale, x: from.x + (dx || 0), y: from.y + (dy || 0) };
}
