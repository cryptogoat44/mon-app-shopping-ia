// « Entourez la pièce » au doigt (lot entourer la pièce, décision du
// fondateur : entourer seulement). La personne fait le tour de la pièce ; la
// zone envoyée au serveur reste un rectangle : celui qui englobe le tracé,
// avec une petite marge, borné à l'image, jamais plus petit que MIN_CROP.
// Logique pure, testée. Imports relatifs : fichier testé par vitest.
import type { CropRect } from "@monapp/shared-types";
import { MIN_CROP, WHOLE_IMAGE, cropToBox, type Box, type Size } from "./crop-geometry";

/** Un point du tracé, en proportions de l'image (0 à 1), comme la zone : le
 * tracé reste juste si l'affichage change de taille. */
export interface TracePoint {
  x: number;
  y: number;
}

/** La zone choisie : le rectangle envoyé, et le tracé qui l'a donné (null :
 * « Utiliser toute l'image », sans tracé). */
export interface PieceZone {
  crop: CropRect;
  trace: readonly TracePoint[] | null;
}

export const WHOLE_IMAGE_ZONE: PieceZone = { crop: WHOLE_IMAGE, trace: null };

/** Écart minimal entre deux points gardés, en points écran : un doigt qui
 * glisse en envoie des dizaines par seconde, inutiles au dessin. */
export const TRACE_STEP = 4;
/** Au-delà, un point sur deux est oublié : jamais des milliers de points. */
export const MAX_TRACE_POINTS = 300;
/** Taille minimale du tracé, en points écran (décision : refusé sous 24 × 24
 * points) : refusé s'il tient dans ce carré, en largeur ET en hauteur. Une
 * boucle fine autour d'une petite pièce (lunettes, ceinture) reste retenue. */
export const MIN_TRACE_SIDE = 24;
/** Surface entourée minimale, en points² : écarte un trait ou un aller-retour
 * serré (surface presque nulle), pas une petite pièce (un rond de 24 points en
 * fait environ 450). */
export const MIN_TRACE_AREA = 300;
/** Épaisseur minimale d'un tour, en points écran : 2 × surface ÷ longueur du
 * tour (le rayon d'un rond, la largeur moyenne d'une boucle allongée). Le
 * pouce qui pousse la page puis revient sans se lever, à quelques points de
 * son aller, dessine une boucle très fine (moins de 5 pour 5 points
 * d'écart) : elle n'est pas retenue. Une petite pièce entourée reste
 * au-dessus : environ 12 pour un rond de 24 points, 10 pour des lunettes
 * (40 × 14), 15 pour une ceinture (160 × 20). */
export const MIN_TRACE_THICKNESS = 6;
/** Tour fermé : après s'être éloigné de son départ, le tracé y revient, à
 * moins de cette part de sa plus grande distance au départ. Un « C » de 300°
 * passe ; un balayage pour faire défiler la page, même courbe, s'éloigne sans
 * revenir : il n'est pas retenu. */
export const CLOSE_RATIO = 0.8;
/** Pièce coupée par le bord de l'image : les deux bouts du tracé à moins de
 * ces points du bord, sur le même côté ou deux côtés voisins ; le bord
 * referme le tour. Au moins TRACE_STEP : le dernier point, posé sur le bord,
 * n'est pas toujours gardé. */
export const EDGE_TOLERANCE = 12;
/** Tour refermé par le bord : le tracé s'en écarte d'au moins ces points (des
 * deux bords, dans un coin)… */
export const EDGE_DEPTH = 16;
/** … et bombe vers l'intérieur de l'image d'au moins cette part de l'écart
 * entre ses deux bouts. Un balayage qui longe le bord, ou coupe un coin
 * presque en ligne droite, n'est pas retenu. */
export const EDGE_BULGE = 0.1;
/** Marge autour du tracé, en points écran (la même en largeur et en hauteur) :
 * le doigt mord parfois sur le bord de la pièce. Petite : une capture
 * verticale ne fait que 130 à 170 points de large à l'écran. */
export const TRACE_MARGIN = 6;
/** Ce qui prend le doigt : l'image et cette marge autour, en points écran,
 * sans sortir du cadre. Plus loin (les bandes vides à côté d'une capture
 * verticale), le doigt fait défiler la page, comme avant le lot. */
export const TRACE_START_MARGIN = 16;

type Point = { x: number; y: number };
type Side = "left" | "right" | "top" | "bottom";
const SIDES: readonly Side[] = ["left", "right", "top", "bottom"];
const OPPOSITE: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };
/** Vers l'intérieur de l'image, depuis chaque côté. */
const INWARD: Record<Side, Point> = { left: { x: 1, y: 0 }, right: { x: -1, y: 0 }, top: { x: 0, y: 1 }, bottom: { x: 0, y: -1 } };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const round = (value: number) => Math.round(value * 10) / 10;
const cross = (u: Point, v: Point) => u.x * v.y - u.y * v.x;

/** Point touché (en points, dans le cadre de l'image) converti en proportions
 * de l'image ; ramené au bord quand le doigt sort de l'image. */
export function toTracePoint(x: number, y: number, image: Box): TracePoint {
  return { x: clamp((x - image.left) / image.width, 0, 1), y: clamp((y - image.top) / image.height, 0, 1) };
}

/** Ajoute un point au tracé (`display` : taille de l'image à l'écran). Trop
 * près du précédent, il est ignoré et le tracé reste le même objet. */
export function extendTrace(trace: readonly TracePoint[], point: TracePoint, display: Size): readonly TracePoint[] {
  const last = trace[trace.length - 1];
  if (last && Math.hypot((point.x - last.x) * display.width, (point.y - last.y) * display.height) < TRACE_STEP) return trace;
  const next = [...trace, point];
  if (next.length <= MAX_TRACE_POINTS) return next;
  // Un point sur deux est oublié, le dernier toujours gardé : le dessin garde sa forme.
  return next.filter((_, index) => index % 2 === 0 || index === next.length - 1);
}

/** Surface du polygone refermé (formule du lacet), en points², avec un signe
 * selon le sens du tour : presque nulle pour un trait ou un aller-retour. */
function signedArea(points: readonly Point[]): number {
  let twice = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    twice += point.x * next.y - next.x * point.y;
  });
  return twice / 2;
}

/** Épaisseur du polygone refermé, en points : 2 × surface ÷ périmètre. */
function thickness(points: readonly Point[], area: number): number {
  let perimeter = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    perimeter += Math.hypot(next.x - point.x, next.y - point.y);
  });
  return (2 * area) / perimeter;
}

/** Le retour vers le départ : le point le plus proche du départ après le
 * premier point « loin » (90 % de la plus grande distance au départ, pour
 * qu'un tour qui dépasse son départ, jusqu'à un tour et demi, compte aussi).
 * -1 si le tracé ne revient pas à moins de CLOSE_RATIO de cette distance. */
function returnIndex(points: readonly Point[]): number {
  const start = points[0];
  const distances = points.map((point) => Math.hypot(point.x - start.x, point.y - start.y));
  const farthest = Math.max(...distances);
  const far = distances.findIndex((distance) => distance >= 0.9 * farthest);
  let back = -1;
  for (let index = far + 1; index < points.length; index += 1) {
    if (distances[index] <= CLOSE_RATIO * farthest && (back < 0 || distances[index] < distances[back])) back = index;
  }
  return back;
}

/** Pièce coupée par le bord de l'image : les deux bouts du tracé sont au bord
 * (même côté, ou deux côtés voisins) et le bord referme le tour, à condition
 * que le tracé s'en écarte et bombe vers l'intérieur. Renvoie la surface
 * ainsi entourée (avec le coin), ou null. */
function edgeClosedArea(points: readonly Point[], display: Size): number | null {
  const first = points[0];
  const last = points[points.length - 1];
  const chord = { x: last.x - first.x, y: last.y - first.y };
  const length = Math.hypot(chord.x, chord.y);
  const gap = (point: Point, side: Side) =>
    side === "left" ? point.x : side === "right" ? display.width - point.x : side === "top" ? point.y : display.height - point.y;
  for (const start of SIDES) {
    if (!length || gap(first, start) > EDGE_TOLERANCE) continue;
    for (const end of SIDES) {
      if (end === OPPOSITE[start] || gap(last, end) > EDGE_TOLERANCE) continue;
      // Vers l'intérieur : depuis le côté, ou depuis le coin commun.
      const inward = start === end ? INWARD[start] : { x: INWARD[start].x + INWARD[end].x, y: INWARD[start].y + INWARD[end].y };
      const toInside = Math.sign(cross(chord, inward));
      const bulge = Math.max(...points.map((point) => toInside * cross(chord, { x: point.x - first.x, y: point.y - first.y })));
      const depth = Math.max(...points.map((point) => Math.min(gap(point, start), gap(point, end))));
      if (bulge < EDGE_BULGE * length * length || depth < EDGE_DEPTH) continue;
      if (start === end) return Math.abs(signedArea(points));
      const corner = { x: start === "right" || end === "right" ? display.width : 0, y: start === "bottom" || end === "bottom" ? display.height : 0 };
      return Math.abs(signedArea([...points, corner]));
    }
  }
  return null;
}

/** Un côté de la zone : borné à l'image, élargi autour de son milieu jusqu'à MIN_CROP. */
function side(start: number, end: number): [number, number] {
  const from = Math.max(start, 0);
  const to = Math.min(end, 1);
  if (to - from >= MIN_CROP) return [from, to - from];
  return [clamp((from + to) / 2 - MIN_CROP / 2, 0, 1 - MIN_CROP), MIN_CROP];
}

/** La zone à chercher d'après le tracé : le rectangle qui l'englobe, avec la
 * marge, borné à l'image, à la taille minimale. Retenu : un tour (le tracé
 * revient vers son départ) assez grand et assez épais, ou une pièce coupée
 * par le bord (le bord referme le tour) assez grande. Null si le tracé
 * n'entoure rien (toucher, trait, balayage pour faire défiler la page,
 * aller-retour, boucle trop petite ou trop fine) : il n'est pas retenu. */
export function zoneFromTrace(trace: readonly TracePoint[], display: Size): CropRect | null {
  if (trace.length < 3 || !display.width || !display.height) return null;
  const points = trace.map((point) => ({ x: point.x * display.width, y: point.y * display.height }));
  const xs = trace.map((point) => point.x);
  const ys = trace.map((point) => point.y);
  // Le tracé gardé (un point tous les TRACE_STEP points) rogne un peu le tour :
  // un rond de 24 points n'en mesure plus que 23 environ.
  const slack = TRACE_STEP / 2;
  const width = (Math.max(...xs) - Math.min(...xs)) * display.width + slack;
  const height = (Math.max(...ys) - Math.min(...ys)) * display.height + slack;
  if (width < MIN_TRACE_SIDE && height < MIN_TRACE_SIDE) return null;
  const closed = returnIndex(points) >= 0;
  const area = closed ? Math.abs(signedArea(points)) : edgeClosedArea(points, display);
  if (area === null || area < MIN_TRACE_AREA) return null;
  // Un aller-retour du pouce revient lui aussi vers son départ : seul un tour
  // assez épais est retenu.
  if (closed && thickness(points, area) < MIN_TRACE_THICKNESS) return null;
  const marginX = TRACE_MARGIN / display.width;
  const marginY = TRACE_MARGIN / display.height;
  const [x, cropWidth] = side(Math.min(...xs) - marginX, Math.max(...xs) + marginX);
  const [y, cropHeight] = side(Math.min(...ys) - marginY, Math.max(...ys) + marginY);
  return { x, y, width: cropWidth, height: cropHeight };
}

/** « Lancer » attend une zone choisie (entourée, ou l'image entière) : le
 * résultat en dépend. */
export function zoneReady(zone: PieceZone | null): zone is PieceZone {
  return zone !== null;
}

/** Ce qui prend le doigt : l'image et TRACE_START_MARGIN autour, sans sortir
 * du cadre (`frame` : taille du cadre, en points). */
export function traceSurface(image: Box, frame: Size): Box {
  const left = Math.max(image.left - TRACE_START_MARGIN, 0);
  const top = Math.max(image.top - TRACE_START_MARGIN, 0);
  const right = Math.min(image.left + image.width + TRACE_START_MARGIN, frame.width);
  const bottom = Math.min(image.top + image.height + TRACE_START_MARGIN, frame.height);
  return { left, top, width: right - left, height: bottom - top };
}

/** Le tracé en chemin SVG, en points du cadre de l'image. Une fois retenu, il
 * se referme s'il s'arrête en revenant vers son départ (un « C », un tour
 * presque fini) ; un tour qui a dépassé son départ, ou une pièce au bord (le
 * bord le referme), reste ouvert : pas de trait en travers de la pièce. */
export function tracePath(trace: readonly TracePoint[], image: Box, closed: boolean): string {
  const points = trace.map((point) => ({ x: image.left + point.x * image.width, y: image.top + point.y * image.height }));
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x)} ${round(point.y)}`).join("");
  return closed && points.length > 2 && returnIndex(points) === points.length - 1 ? `${path}Z` : path;
}

const rectPath = (box: Box) => `M${round(box.left)} ${round(box.top)}h${round(box.width)}v${round(box.height)}h${round(-box.width)}Z`;

/** Ce qui est assombri : tout le cadre moins la zone (à remplir avec la règle
 * « evenodd » : la zone reste claire). Le cadre entier, pas seulement l'image :
 * un voile arrêté au bord de l'image y laissait un liseré clair. */
export function outsidePath(crop: CropRect, image: Box, frame: Size): string {
  return `${rectPath({ left: 0, top: 0, ...frame })}${rectPath(cropToBox(crop, image))}`;
}
