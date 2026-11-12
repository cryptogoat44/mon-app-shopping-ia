// Recadrage de la photo de profil en carré (lot « profil et icône des
// réglages ») : la photo, déplacée et zoomée par la personne, couvre toujours
// tout le carré affiché ; la partie vue dans le carré est ce qui sera gardé.
// Logique pure, testée sans écran (tests/avatar-crop.test.ts) ; l'écran est
// components/avatar-crop.tsx.

export interface Size {
  width: number;
  height: number;
}

/** Réglage en cours : zoom (1 = la photo couvre juste le carré) et décalage
 * du centre de la photo par rapport au centre du carré, en points écran. */
export interface CropView {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

/** Zone gardée, en pixels de la photo (redressée) : toujours un carré. */
export interface PixelCrop {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** Pas des boutons « Zoomer » et « Dézoomer ». */
export const ZOOM_STEP = 0.5;
export const INITIAL_VIEW: CropView = { zoom: MIN_ZOOM, offsetX: 0, offsetY: 0 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Échelle (points par pixel) où le petit côté de la photo remplit le carré. */
export function coverScale(image: Size, viewport: number): number {
  return viewport / Math.min(image.width, image.height);
}

/** Taille de la photo affichée, en points, au zoom donné. */
export function shownSize(image: Size, viewport: number, zoom: number): Size {
  const scale = coverScale(image, viewport) * zoom;
  return { width: image.width * scale, height: image.height * scale };
}

/** Zoom ramené entre 1 et 4, et décalage limité pour que la photo couvre
 * toujours tout le carré (jamais de bande vide). */
export function clampView(view: CropView, image: Size, viewport: number): CropView {
  const zoom = clamp(view.zoom, MIN_ZOOM, MAX_ZOOM);
  const shown = shownSize(image, viewport, zoom);
  const maxX = Math.max(0, (shown.width - viewport) / 2);
  const maxY = Math.max(0, (shown.height - viewport) / 2);
  return { zoom, offsetX: clamp(view.offsetX, -maxX, maxX), offsetY: clamp(view.offsetY, -maxY, maxY) };
}

/** Photo déplacée du doigt (ou de la souris) de `dx`, `dy` points. */
export function panView(view: CropView, dx: number, dy: number, image: Size, viewport: number): CropView {
  return clampView({ ...view, offsetX: view.offsetX + dx, offsetY: view.offsetY + dy }, image, viewport);
}

/** Nouveau zoom, autour du centre du carré : ce qui y est reste au centre. */
export function zoomView(view: CropView, zoom: number, image: Size, viewport: number): CropView {
  const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const ratio = next / view.zoom;
  return clampView({ zoom: next, offsetX: view.offsetX * ratio, offsetY: view.offsetY * ratio }, image, viewport);
}

/** Zoom pendant un pincement : celui du début, multiplié par l'écart des doigts. */
export function pinchZoom(startZoom: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return startZoom;
  return clamp((startZoom * distance) / startDistance, MIN_ZOOM, MAX_ZOOM);
}

/** Écart entre deux doigts, en points. */
export function touchDistance(a: { pageX: number; pageY: number }, b: { pageX: number; pageY: number }): number {
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

/** Place de la photo dans un carré de `frame` points (le carré de recadrage,
 * ou l'aperçu rond, plus petit) : position et taille, en points. */
export function imageLayout(view: CropView, image: Size, viewport: number, frame = viewport) {
  const factor = frame / viewport;
  const shown = shownSize(image, viewport, view.zoom);
  return {
    left: ((viewport - shown.width) / 2 + view.offsetX) * factor,
    top: ((viewport - shown.height) / 2 + view.offsetY) * factor,
    width: shown.width * factor,
    height: shown.height * factor,
  };
}

/** La partie de la photo vue dans le carré, en pixels entiers : un carré,
 * toujours à l'intérieur de la photo. */
export function cropRect(view: CropView, image: Size, viewport: number): PixelCrop {
  const scale = coverScale(image, viewport) * view.zoom;
  const shown = shownSize(image, viewport, view.zoom);
  const side = Math.max(1, Math.min(Math.floor(viewport / scale), image.width, image.height));
  const originX = clamp(Math.round(((shown.width - viewport) / 2 - view.offsetX) / scale), 0, image.width - side);
  const originY = clamp(Math.round(((shown.height - viewport) / 2 - view.offsetY) / scale), 0, image.height - side);
  return { originX, originY, width: side, height: side };
}
