// « Entourez la pièce » en poudre de lumière (lot entourer en poudre, réponse
// du fondateur du 26 novembre : « un trait plus épais, mais presque
// transparent, en dégradé, comme une sorte de poudre qui disparaît
// derrière »). Logique pure, testée : la traînée est un ruban à largeur
// variable découpé en morceaux, regroupés en quelques chemins SVG, chacun avec
// sa couleur et son opacité ; la douceur vient de copies empilées, plus larges
// et moins opaques (aucun filtre de flou : non disponible sur iOS en SVG).
// Valeurs de la maquette retenue (maquettes-ecrin/3-entourer-poudre, en
// points). Dessin seulement : rien de ce fichier ne part au serveur.
// Imports relatifs : fichier testé par vitest.
import type { Point } from "./piece-trace";

/** Réglages de la traînée, en points (une ligne chacun, à régler sur iPhone
 * à côté de la maquette). t = 0 : la queue (début du geste) ; t = 1 : la tête,
 * sous le doigt. */
export const POWDER = {
  /** Rééchantillonnage : un point tous les 3 pt, 160 points au plus. */
  spacing: 3,
  maxPoints: 160,
  halo: { tail: 6, head: 32, alpha: 0.2 },
  body: { tail: 3.5, head: 19, alpha: 0.36 },
  /** Le cœur fin : seconde moitié du tracé seulement. */
  core: { tail: 1, head: 6, alpha: 0.34, from: 0.35 },
  /** Morceaux regroupés par tranches de t : au plus 12 chemins par couche. */
  bands: 12,
  grains: 60,
  /** Rayon de la lueur au bout du doigt. */
  headGlow: 15,
  /** Recouvrement des morceaux voisins d'une même tranche, pour ne pas voir de jointure. */
  overlap: 0.3,
} as const;

export type PowderLayer = { tail: number; head: number; alpha: number; from?: number };

/** Couleurs posées sur une photo : les mêmes dans les deux thèmes (comme
 * `surImage`). Nacre froide dans la queue, ivoire, or pâle à la tête. */
export const POWDER_COLORS = { nacre: "#D6D6DC", ivoire: "#F4F2EE", or: "#F6E4BA" } as const;
/** Hors de la forme entourée : assombri doucement. */
export const OUTSIDE_VEIL = { color: "#0B0A09", opacity: 0.5 } as const;
/** Dans la forme : un voile ivoire à peine visible. */
export const INSIDE_VEIL = { color: "#F4F2EE", opacity: 0.045 } as const;
/** Masque du voile : blanc = voilé, noir = clair ; deux anneaux gris
 * adoucissent le bord vers l'extérieur. */
export const MASK = { veiled: "#FFFFFF", clear: "#000000", softOuter: "#B3B3B3", softInner: "#666666", softOuterWidth: 14, softInnerWidth: 7 } as const;
/** Lueur ronde au bout du doigt (dégradé radial : centre, 40 %, bord). */
export const HEAD_GLOW_STOPS = [
  { offset: 0, color: "#FFF6E2", opacity: 0.5 },
  { offset: 0.4, color: "#F6E7C4", opacity: 0.18 },
  { offset: 1, color: "#F4F2EE", opacity: 0 },
] as const;
/** Filet du cadre de l'IA (coins arrondis) et de « Utiliser toute l'image ». */
export const FRAME_LINE = { color: "#F4F2EE", frameWidth: 1.5, frameRadius: 6, wholeWidth: 1 } as const;
/** Pastille de consigne, posée sur la photo : la même dans les deux thèmes. */
export const MESSAGE_PILL = { background: "rgba(10,10,9,0.72)", border: "rgba(244,242,238,0.18)", text: "#F4F2EE" } as const;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const r1 = (value: number) => (Math.round(value * 10) / 10).toString();

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const u = clamp01((x - edge0) / (edge1 - edge0));
  return u * u * (3 - 2 * u);
}

/** Largeur du ruban : fine dans la queue, large à la tête. */
export function powderWidth(t: number, tail: number, head: number): number {
  return tail + (head - tail) * Math.pow(clamp01(t), 1.35);
}

/** Opacité le long du tracé : nulle sur les premiers 12 %, environ 30 % dans
 * la queue, 100 % à la tête. C'est elle qui fait « disparaître la poudre
 * derrière » le doigt, sans minuterie. */
export function powderAlpha(t: number): number {
  const x = clamp01(t);
  return (0.3 + 0.7 * Math.pow(x, 1.6)) * smoothstep(0, 0.12, x);
}

const NACRE = [214, 214, 220];
const IVOIRE = [244, 242, 238];
const OR = [246, 228, 186];
const mix = (a: number[], b: number[], u: number) => a.map((value, index) => Math.round(value + (b[index] - value) * u));

/** Couleur le long du tracé : nacre → ivoire jusqu'à t = 0,7, puis ivoire → or pâle. */
export function powderColor(t: number): string {
  const x = clamp01(t);
  const c = x < 0.7 ? mix(NACRE, IVOIRE, x / 0.7) : mix(IVOIRE, OR, (x - 0.7) / 0.3);
  return `rgb(${c.join(",")})`;
}

/** Le tracé à pas régulier (au plus POWDER.maxPoints points ; le pas
 * s'allonge au-delà), pour que t = fraction de la longueur : premier point =
 * la queue, dernier = la tête. */
export function resample(points: readonly Point[], spacing: number = POWDER.spacing): Point[] {
  if (points.length < 2) return points.map((point) => ({ ...point }));
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(lengths[index - 1] + Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y));
  }
  const total = lengths[lengths.length - 1];
  if (total === 0) return [{ ...points[0] }];
  const steps = Math.min(POWDER.maxPoints - 1, Math.max(1, Math.round(total / spacing)));
  const out: Point[] = [];
  let j = 0;
  for (let k = 0; k <= steps; k += 1) {
    const d = (k / steps) * total;
    while (j < lengths.length - 2 && lengths[j + 1] < d) j += 1;
    const u = (d - lengths[j]) / (lengths[j + 1] - lengths[j] || 1);
    out.push({ x: points[j].x + (points[j + 1].x - points[j].x) * u, y: points[j].y + (points[j + 1].y - points[j].y) * u });
  }
  return out;
}

/** Normales (unitaires) en chaque point, d'après ses voisins. */
function normals(points: readonly Point[]): Point[] {
  const last = points.length - 1;
  return points.map((_, index) => {
    const a = points[Math.max(0, index - 1)];
    const b = points[Math.min(last, index + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: -dy / length, y: dx / length };
  });
}

/** Un disque en chemin SVG (deux demi-arcs). */
function disc(center: Point, radius: number): string {
  const r = r1(radius);
  return `M${r1(center.x - radius)} ${r1(center.y)}a${r} ${r} 0 1 0 ${r1(2 * radius)} 0a${r} ${r} 0 1 0 ${r1(-2 * radius)} 0Z`;
}

export interface PowderPath {
  d: string;
  color: string;
  opacity: number;
  /** Milieu de la tranche (0 queue, 1 tête). */
  t: number;
}

/** Une couche du ruban (halo, corps ou cœur) sur le tracé rééchantillonné :
 * des quadrilatères jointifs (légèrement recouverts), regroupés en au plus
 * POWDER.bands chemins par tranche de t, une couleur et une opacité par
 * tranche (prises au milieu) ; la couche « cœur » ne s'allume que dans la
 * seconde moitié. Le bout arrondi (un disque à la tête) est dans le chemin de
 * la dernière tranche. `widthScale` : les
 * copies empilées, plus larges. Tranches d'opacité nulle : omises. */
export function powderBands(points: readonly Point[], layer: PowderLayer, widthScale = 1): PowderPath[] {
  const count = points.length - 1;
  if (count < 1) return [];
  const nrm = normals(points);
  const gate = (t: number) => (layer.from === undefined ? 1 : smoothstep(layer.from, 1, t));
  const groups: string[] = Array.from({ length: POWDER.bands }, () => "");
  for (let i = 0; i < count; i += 1) {
    const j = i + 1;
    const ti = i / count;
    const tj = j / count;
    const band = Math.min(POWDER.bands - 1, Math.floor(((ti + tj) / 2) * POWDER.bands));
    const wi = (powderWidth(ti, layer.tail, layer.head) * widthScale) / 2;
    const wj = (powderWidth(tj, layer.tail, layer.head) * widthScale) / 2;
    const a = points[i];
    const dx = points[j].x - a.x;
    const dy = points[j].y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    // Léger recouvrement vers l'avant, dans une même tranche seulement (un
    // chemin : la surface recouverte n'est peinte qu'une fois) ; entre deux
    // tranches, il se verrait en trait plus clair.
    const nextBand = j < count ? Math.min(POWDER.bands - 1, Math.floor(((tj + (j + 1) / count) / 2) * POWDER.bands)) : -1;
    const overlap = nextBand === band ? POWDER.overlap : 0;
    const b = { x: points[j].x + (dx / length) * overlap, y: points[j].y + (dy / length) * overlap };
    const na = nrm[i];
    const nb = nrm[j];
    groups[band] +=
      `M${r1(a.x + na.x * wi)} ${r1(a.y + na.y * wi)}` +
      `L${r1(b.x + nb.x * wj)} ${r1(b.y + nb.y * wj)}` +
      `L${r1(b.x - nb.x * wj)} ${r1(b.y - nb.y * wj)}` +
      `L${r1(a.x - na.x * wi)} ${r1(a.y - na.y * wi)}Z`;
  }
  // Le bout arrondi à la tête, dans le chemin de la dernière tranche : même
  // couleur, même opacité, aucune marge plus claire où il recouvre le ruban.
  const lastBand = Math.min(POWDER.bands - 1, Math.floor(((count - 0.5) / count) * POWDER.bands));
  groups[lastBand] += disc(points[count], (powderWidth(1, layer.tail, layer.head) * widthScale) / 2);
  const paths: PowderPath[] = [];
  groups.forEach((d, band) => {
    if (!d) return;
    const t = (band + 0.5) / POWDER.bands;
    const opacity = powderAlpha(t) * layer.alpha * gate(t);
    if (opacity > 0.001) paths.push({ d, color: powderColor(t), opacity, t });
  });
  return paths;
}

/** Pseudo-aléatoire déterministe (Park-Miller) : la même graine donne les
 * mêmes tirages, le dessin ne « grésille » pas d'un rendu à l'autre. */
function random(seed: number): () => number {
  let state = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

const GRAIN_GROUPS = 4;
const GRAIN_MAX_OPACITY = 0.53;
/** Graine fixe, et non le nombre de points : pendant le geste, ce nombre
 * change à presque chaque mouvement et redistribuerait tous les grains. */
const GRAIN_SEED = 1;

/** Les grains de poudre (POWDER.grains au plus, rayon 0,5 à 1 pt) : plus
 * denses et plus vifs vers la tête, plus épars, décalés vers l'extérieur et
 * l'arrière dans la queue. Regroupés en 4 chemins par opacité. Graine fixe :
 * chaque grain garde sa place (t, écart, rayon) d'un rendu à l'autre et ne
 * glisse que doucement quand la traînée s'allonge. */
export function powderGrains(points: readonly Point[], seed: number = GRAIN_SEED): PowderPath[] {
  const count = points.length - 1;
  if (count < 1) return [];
  const nrm = normals(points);
  const rnd = random(seed);
  const gauss = () => {
    let sum = 0;
    for (let k = 0; k < 4; k += 1) sum += rnd();
    return (sum - 2) / 1.15;
  };
  const groups = Array.from({ length: GRAIN_GROUPS }, () => ({ d: "", tSum: 0, n: 0 }));
  for (let k = 0; k < POWDER.grains; k += 1) {
    const t = Math.pow(rnd(), 0.75);
    const index = Math.round(t * count);
    const p = points[index];
    const n = nrm[index];
    const spread = powderWidth(t, 4, 20) * 0.42 * (1 + (1 - t) * 1.6);
    const off = gauss() * spread;
    // La poudre « reste derrière » : vers l'arrière du geste, dans la queue.
    const back = -rnd() * 7 * (1 - t);
    const forward = { x: n.y, y: -n.x };
    const x = p.x + n.x * off + forward.x * back;
    const y = p.y + n.y * off + forward.y * back;
    const radius = 0.5 + rnd() * 0.5;
    const opacity = (0.18 + rnd() * 0.35) * powderAlpha(t) * (1 - Math.min(1, Math.abs(off) / (spread * 2.4)));
    if (opacity < 0.02) continue;
    const group = groups[Math.min(GRAIN_GROUPS - 1, Math.floor((opacity / GRAIN_MAX_OPACITY) * GRAIN_GROUPS))];
    group.d += disc({ x, y }, radius);
    group.tSum += t;
    group.n += 1;
  }
  return groups.flatMap((group, index) =>
    group.n ? [{ d: group.d, color: powderColor(group.tSum / group.n), opacity: ((index + 0.5) / GRAIN_GROUPS) * GRAIN_MAX_OPACITY, t: group.tSum / group.n }] : []
  );
}

/** Tout le dessin de la traînée, à calculer une fois par tracé (useMemo) :
 * halo (2 copies), corps (2 copies), cœur, grains, et la tête (lueur). */
export function powderTrail(points: readonly Point[]) {
  const trail = resample(points);
  return {
    halo: [...powderBands(trail, POWDER.halo, 1.5).map((p) => ({ ...p, opacity: p.opacity * 0.35 })), ...powderBands(trail, POWDER.halo)],
    body: [...powderBands(trail, POWDER.body, 1.3).map((p) => ({ ...p, opacity: p.opacity * 0.4 })), ...powderBands(trail, POWDER.body)],
    core: powderBands(trail, POWDER.core),
    grains: powderGrains(trail),
    head: trail.length ? trail[trail.length - 1] : null,
  };
}
