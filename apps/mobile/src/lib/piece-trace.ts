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
/** Surface entourée minimale, en points² (un carré de 24 points de côté) :
 * en dessous, c'est un toucher, un trait ou un griffonnage, pas une pièce
 * entourée. */
export const MIN_TRACE_AREA = 24 * 24;
/** Marge autour du tracé, en points écran (la même en largeur et en hauteur) :
 * le doigt mord parfois sur le bord de la pièce. Petite : une capture
 * verticale ne fait que 130 à 170 points de large à l'écran. */
export const TRACE_MARGIN = 6;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const round = (value: number) => Math.round(value * 10) / 10;

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

/** Surface entourée par le tracé refermé, en points² (formule du lacet) :
 * presque nulle pour un toucher ou un trait, même long. */
function enclosedArea(trace: readonly TracePoint[], display: Size): number {
  let twice = 0;
  trace.forEach((point, index) => {
    const next = trace[(index + 1) % trace.length];
    twice += point.x * next.y - next.x * point.y;
  });
  return (Math.abs(twice) / 2) * display.width * display.height;
}

/** Un côté de la zone : borné à l'image, élargi autour de son milieu jusqu'à MIN_CROP. */
function side(start: number, end: number): [number, number] {
  const from = Math.max(start, 0);
  const to = Math.min(end, 1);
  if (to - from >= MIN_CROP) return [from, to - from];
  return [clamp((from + to) / 2 - MIN_CROP / 2, 0, 1 - MIN_CROP), MIN_CROP];
}

/** La zone à chercher d'après le tracé : le rectangle qui l'englobe, avec la
 * marge, borné à l'image, à la taille minimale. Null si le tracé n'entoure
 * presque rien : il n'est pas retenu. */
export function zoneFromTrace(trace: readonly TracePoint[], display: Size): CropRect | null {
  if (trace.length < 3 || !display.width || !display.height || enclosedArea(trace, display) < MIN_TRACE_AREA) return null;
  const xs = trace.map((point) => point.x);
  const ys = trace.map((point) => point.y);
  const marginX = TRACE_MARGIN / display.width;
  const marginY = TRACE_MARGIN / display.height;
  const [x, width] = side(Math.min(...xs) - marginX, Math.max(...xs) + marginX);
  const [y, height] = side(Math.min(...ys) - marginY, Math.max(...ys) + marginY);
  return { x, y, width, height };
}

/** « Lancer » attend une zone choisie (entourée, ou l'image entière) : le
 * résultat en dépend. */
export function zoneReady(zone: PieceZone | null): zone is PieceZone {
  return zone !== null;
}

/** Le tracé en chemin SVG, en points du cadre de l'image ; refermé une fois retenu. */
export function tracePath(trace: readonly TracePoint[], image: Box, closed: boolean): string {
  const path = trace
    .map((point, index) => `${index === 0 ? "M" : "L"}${round(image.left + point.x * image.width)} ${round(image.top + point.y * image.height)}`)
    .join("");
  return closed && trace.length > 2 ? `${path}Z` : path;
}

const rectPath = (box: Box) => `M${round(box.left)} ${round(box.top)}h${round(box.width)}v${round(box.height)}h${round(-box.width)}Z`;

/** Ce qui est assombri : tout le cadre moins la zone (à remplir avec la règle
 * « evenodd » : la zone reste claire). Le cadre entier, pas seulement l'image :
 * un voile arrêté au bord de l'image y laissait un liseré clair. */
export function outsidePath(crop: CropRect, image: Box, frame: Size): string {
  return `${rectPath({ left: 0, top: 0, ...frame })}${rectPath(cropToBox(crop, image))}`;
}
