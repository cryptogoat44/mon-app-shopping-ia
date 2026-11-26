// « Entourez la pièce » en poudre de lumière (lot entourer en poudre, réponse
// du fondateur du 26 novembre : « un trait plus épais, mais presque
// transparent, en dégradé, comme une sorte de poudre qui disparaît
// derrière »). Logique pure, testée : la traînée est un ruban à largeur
// variable découpé en morceaux, regroupés en quelques chemins SVG, chacun avec
// sa couleur et son opacité ; la douceur vient de copies empilées, plus larges
// et moins opaques, à marches fines (aucun filtre de flou : non disponible sur
// iOS en SVG). Valeurs en points, réglées à l'œil sur des captures du site à
// côté de la maquette retenue (maquettes-ecrin/3-entourer-poudre) : vive
// seulement près du doigt, un souffle derrière ; après le lâcher, la lumière
// reste et la poudre retombe. Dessin seulement : rien de ce fichier ne part au
// serveur.
// Imports relatifs : fichier testé par vitest.
import type { Point } from "./piece-trace";

/** Réglages de la traînée, en points (une ligne chacun, à régler sur iPhone
 * à côté de la maquette). t = 0 : la queue (début du geste) ; t = 1 : la tête,
 * sous le doigt. */
export const POWDER = {
  /** Rééchantillonnage : un point tous les 3 pt… */
  spacing: 3,
  /** … et 160 points au plus. */
  maxPoints: 160,
  /** Éclat de la queue, en part de celui de la tête : un souffle de lumière, pas une bande. */
  tailShare: 0.12,
  /** Où commence la montée vers la tête (fraction du tracé) : la partie vive couvre le dernier tiers. */
  rampFrom: 0.45,
  /** Courbure de cette montée (plus grand : la lumière se resserre au bout du doigt). */
  rampPower: 1.5,
  /** La douceur sans flou : des copies empilées, de la plus large et pâle à la plus fine et vive. */
  soft: {
    /** Nombre de copies (plus : des marches plus fines sur la largeur, plus de chemins). */
    copies: 9,
    /** Largeur de la copie la plus large, à la queue et à la tête. */
    outer: { tail: 8, head: 52 },
    /** Largeur de la copie la plus fine, à la queue et à la tête. */
    inner: { tail: 2, head: 9 },
    /** Opacité à la tête de la copie la plus large. */
    outerAlpha: 0.045,
    /** Opacité à la tête de la copie la plus fine. */
    innerAlpha: 0.15,
    /** Tranches le long du tracé de la copie la plus large (peu : elle est pâle, sans dégradé fin). */
    outerBands: 4,
    /** Tranches le long du tracé de la copie la plus fine (plus : son dégradé se voit). */
    innerBands: 12,
  },
  /** Le cœur fin, par-dessus : seconde moitié du tracé seulement. */
  core: { tail: 1, head: 4.5, alpha: 0.26, bands: 16, from: 0.35 },
  /** Grains de poudre, au plus. */
  grains: 40,
  /** Les grains ne tombent que dans le dernier tiers, derrière la tête (aucun à l'autre bout). */
  grainsFrom: 0.62,
  /** Rayon de la lueur au bout du doigt. */
  headGlow: 22,
  /** Recouvrement des morceaux voisins d'une même tranche, pour ne pas voir de jointure. */
  overlap: 0.3,
  /** Après le lâcher, la poudre retombe à cette part de son éclat : il en reste un souvenir. */
  settledShare: 0.35,
  /** Plafond de chemins SVG redessinés à chaque mouvement du doigt (toutes les copies et les grains). */
  maxPaths: 100,
} as const;

export type PowderLayer = { tail: number; head: number; alpha: number; bands: number; from?: number };

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Les copies du ruban, dans l'ordre du dessin : POWDER.soft.copies copies
 * réparties de la plus large à la plus fine (largeurs à pas égal, opacités et
 * tranches croissantes), puis le cœur. */
export function powderLayers(): PowderLayer[] {
  const { copies, outer, inner, outerAlpha, innerAlpha, outerBands, innerBands } = POWDER.soft;
  const soft = Array.from({ length: copies }, (_, k) => {
    const u = copies > 1 ? k / (copies - 1) : 1;
    return {
      tail: lerp(outer.tail, inner.tail, u),
      head: lerp(outer.head, inner.head, u),
      alpha: lerp(outerAlpha, innerAlpha, u),
      bands: Math.round(lerp(outerBands, innerBands, u)),
    };
  });
  return [...soft, POWDER.core];
}

/** Couleurs posées sur une photo : les mêmes dans les deux thèmes (comme
 * `surImage`). Nacre froide dans la queue, ivoire, or pâle à la tête. */
export const POWDER_COLORS = { nacre: "#D6D6DC", ivoire: "#F4F2EE", or: "#F4DDAA" } as const;
/** Hors de la forme entourée : assombri doucement. */
export const OUTSIDE_VEIL = { color: "#0B0A09", opacity: 0.5 } as const;
/** Dans la forme : un voile ivoire, la lumière qui reste après le geste. */
export const INSIDE_VEIL = { color: "#F4F2EE", opacity: 0.1 } as const;
/** Masques du voile : blanc = voilé, noir = clair. Le bord est adouci par des
 * anneaux le long de la forme, du plus large et presque voilé au plus fin et
 * presque clair (level : part du voile, de 0 à 1). Le voile ivoire du dedans
 * suit les mêmes anneaux, inversés : la zone éclairée n'a pas de bord net. */
export const MASK = {
  veiled: "#FFFFFF",
  clear: "#000000",
  rings: [
    { width: 36, level: 0.96 },
    { width: 32, level: 0.91 },
    { width: 28, level: 0.85 },
    { width: 24, level: 0.78 },
    { width: 20, level: 0.7 },
    { width: 16, level: 0.61 },
    { width: 12, level: 0.51 },
    { width: 8, level: 0.41 },
    { width: 4, level: 0.3 },
  ],
} as const;
/** Bord lumineux de la forme, après le lâcher : quelques filets ivoire
 * empilés (du plus large et pâle au plus fin), une lueur douce, sans flou. */
export const SHAPE_EDGE = {
  color: "#F4F2EE",
  lines: [
    { width: 14, opacity: 0.02 },
    { width: 11, opacity: 0.025 },
    { width: 8, opacity: 0.035 },
    { width: 5.5, opacity: 0.045 },
    { width: 3.5, opacity: 0.06 },
    { width: 2, opacity: 0.08 },
    { width: 1, opacity: 0.12 },
  ],
} as const;
/** Lueur ronde au bout du doigt (dégradé radial : centre, 40 %, bord). */
export const HEAD_GLOW_STOPS = [
  { offset: 0, color: "#FFF3D9", opacity: 0.7 },
  { offset: 0.4, color: "#F6E2B8", opacity: 0.26 },
  { offset: 1, color: "#F4F2EE", opacity: 0 },
] as const;
/** Filet du cadre de l'IA (coins arrondis) et de « Utiliser toute l'image ». */
export const FRAME_LINE = { color: "#F4F2EE", frameWidth: 1.5, frameRadius: 6, wholeWidth: 1 } as const;
/** Pastille de consigne, posée sur la photo : la même dans les deux thèmes. */
export const MESSAGE_PILL = { background: "rgba(10,10,9,0.72)", border: "rgba(244,242,238,0.18)", text: "#F4F2EE" } as const;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const r1 = (value: number) => (Math.round(value * 10) / 10).toString();

/** Un gris de masque : 0 → noir (clair), 1 → blanc (voilé). */
export function maskGray(level: number): string {
  const v = Math.round(clamp01(level) * 255).toString(16).padStart(2, "0").toUpperCase();
  return `#${v}${v}${v}`;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const u = clamp01((x - edge0) / (edge1 - edge0));
  return u * u * (3 - 2 * u);
}

/** Largeur du ruban : fine dans la queue, large à la tête. */
export function powderWidth(t: number, tail: number, head: number): number {
  return tail + (head - tail) * Math.pow(clamp01(t), 1.35);
}

/** Opacité le long du tracé : nulle au départ (montée sur les premiers 12 %),
 * un souffle (POWDER.tailShare, 12 % de la tête) dans la queue, puis une
 * montée douce à partir de POWDER.rampFrom jusqu'à 100 % à la tête. C'est
 * elle qui fait « disparaître la poudre derrière » le doigt, sans minuterie.
 * Croissante : les tranches se découpent selon elle. */
export function powderAlpha(t: number): number {
  const x = clamp01(t);
  const ramp = Math.pow(smoothstep(POWDER.rampFrom, 1, x), POWDER.rampPower);
  return (POWDER.tailShare + (1 - POWDER.tailShare) * ramp) * smoothstep(0, 0.12, x);
}

const NACRE = [214, 214, 220];
const IVOIRE = [244, 242, 238];
const OR = [244, 221, 170];
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

/** Une copie du ruban sur le tracé rééchantillonné : des quadrilatères
 * jointifs (légèrement recouverts), regroupés en au plus `layer.bands`
 * chemins. Les tranches sont découpées à pas égal d'opacité (et non de
 * longueur) : la queue, d'éclat presque constant, tient en peu de tranches,
 * la montée vers la tête en a le plus ; d'une tranche à l'autre, l'opacité ne
 * saute jamais de plus de `layer.alpha / layer.bands`. Une couleur et une
 * opacité par tranche (moyennes de ses morceaux) ; les morceaux éteints ne
 * sont pas dessinés (une copie avec `from` ne s'allume qu'à partir de là). Le bout arrondi (un disque à la tête) est dans
 * le chemin de la dernière tranche.
 * Tranches d'opacité nulle : omises. */
export function powderBands(points: readonly Point[], layer: PowderLayer): PowderPath[] {
  const count = points.length - 1;
  if (count < 1) return [];
  const nrm = normals(points);
  const strength = (t: number) => powderAlpha(t) * (layer.from === undefined ? 1 : smoothstep(layer.from, 1, t));
  const bandOf = (i: number) => Math.min(layer.bands - 1, Math.floor(strength((i + 0.5) / count) * layer.bands));
  const groups = Array.from({ length: layer.bands }, () => ({ d: "", tSum: 0, sSum: 0, n: 0 }));
  for (let i = 0; i < count; i += 1) {
    const j = i + 1;
    const ti = i / count;
    const tj = j / count;
    // Éteint (le tout début, ou avant `from`) : rien à dessiner.
    if (strength((ti + tj) / 2) <= 0) continue;
    const band = bandOf(i);
    const wi = powderWidth(ti, layer.tail, layer.head) / 2;
    const wj = powderWidth(tj, layer.tail, layer.head) / 2;
    const a = points[i];
    const dx = points[j].x - a.x;
    const dy = points[j].y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    // Léger recouvrement vers l'avant, dans une même tranche seulement (un
    // chemin : la surface recouverte n'est peinte qu'une fois) ; entre deux
    // tranches, il se verrait en trait plus clair.
    const overlap = j < count && bandOf(j) === band ? POWDER.overlap : 0;
    const b = { x: points[j].x + (dx / length) * overlap, y: points[j].y + (dy / length) * overlap };
    const na = nrm[i];
    const nb = nrm[j];
    const group = groups[band];
    group.d +=
      `M${r1(a.x + na.x * wi)} ${r1(a.y + na.y * wi)}` +
      `L${r1(b.x + nb.x * wj)} ${r1(b.y + nb.y * wj)}` +
      `L${r1(b.x - nb.x * wj)} ${r1(b.y - nb.y * wj)}` +
      `L${r1(a.x - na.x * wi)} ${r1(a.y - na.y * wi)}Z`;
    group.tSum += (ti + tj) / 2;
    group.sSum += strength((ti + tj) / 2);
    group.n += 1;
  }
  // Le bout arrondi à la tête, dans le chemin de la dernière tranche : même
  // couleur, même opacité, aucune marge plus claire où il recouvre le ruban.
  groups[bandOf(count - 1)].d += disc(points[count], powderWidth(1, layer.tail, layer.head) / 2);
  const paths: PowderPath[] = [];
  for (const group of groups) {
    if (!group.n) continue;
    const t = group.tSum / group.n;
    const opacity = (group.sSum / group.n) * layer.alpha;
    if (opacity > 0.001) paths.push({ d: group.d, color: powderColor(t), opacity, t });
  }
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
const GRAIN_MAX_OPACITY = 0.6;
/** Graine fixe, et non le nombre de points : pendant le geste, ce nombre
 * change à presque chaque mouvement et redistribuerait tous les grains. */
const GRAIN_SEED = 1;

/** Les grains de poudre (POWDER.grains au plus, rayon 0,5 à 1 pt), dans le
 * dernier tiers seulement (à partir de POWDER.grainsFrom) : plus denses et
 * plus vifs vers la tête, plus épars, décalés vers l'extérieur et l'arrière
 * plus loin du doigt. Regroupés en 4 chemins par opacité. Graine fixe :
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
    const t = POWDER.grainsFrom + (1 - POWDER.grainsFrom) * Math.pow(rnd(), 0.75);
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
    const opacity = (0.2 + rnd() * 0.4) * powderAlpha(t) * (1 - Math.min(1, Math.abs(off) / (spread * 2.4)));
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
 * les copies empilées (dans l'ordre du dessin : de la plus large à la plus
 * fine), les grains, et la tête (lueur). `share` : part de l'éclat (1 pendant
 * le geste, POWDER.settledShare après le lâcher). */
export function powderTrail(points: readonly Point[], share = 1) {
  const trail = resample(points);
  const dim = (paths: PowderPath[]) => (share === 1 ? paths : paths.map((path) => ({ ...path, opacity: path.opacity * share })));
  return {
    layers: dim(powderLayers().flatMap((layer) => powderBands(trail, layer))),
    grains: dim(powderGrains(trail)),
    head: trail.length ? trail[trail.length - 1] : null,
  };
}
