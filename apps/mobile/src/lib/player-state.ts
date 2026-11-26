// Lecteur intégré (mission « liens vidéo ») : messages de la page hôte,
// commandes du lecteur TikTok, accord préalable, taille du lecteur. Logique
// pure, testée. Imports relatifs : fichier testé par vitest.
import type { FrameSample } from "./frame-sample";
import { HOST_MESSAGE_SOURCE } from "./player-host-page";
import { PLAYER_PLATFORM_LIST, type PlayerPlatform } from "./player-link";

export const PLAYER_TIMINGS = {
  /** Sans nouvelles du lecteur : écran de secours. */
  noAnswerMs: 12_000,
  /** Après la commande « pause » : le temps que l'image s'arrête avant l'instantané. */
  pauseSettleMs: 250,
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

// ---- Messages de la page hôte : catalogue fermé ----

/** États du lecteur TikTok (onStateChange) : -1 init, 0 fin, 1 lecture, 2 pause, 3 chargement. */
export type PlayerState = "init" | "ended" | "playing" | "paused" | "buffering";
const TIKTOK_STATES: Record<string, PlayerState> = { "-1": "init", "0": "ended", "1": "playing", "2": "paused", "3": "buffering" };

export type HostMessage =
  | { kind: "ready" }
  | { kind: "state"; state: PlayerState }
  | { kind: "time"; currentTime: number; duration: number }
  | { kind: "muted"; muted: boolean }
  /** onPlayerError : 1001 vidéo invalide, 2001 serveurs TikTok, 3001 lecture, 3002 lecture automatique refusée. */
  | { kind: "error"; code: number; errorType: string | null }
  /** Code d'intégration Instagram chargé. */
  | { kind: "embedReady" }
  /** Hauteur du code d'intégration, en points. */
  | { kind: "size"; height: number }
  /** Événement non prévu (onVolumeChange…) : journalisé en développement. */
  | { kind: "other"; type: string; origin: string };

export function parseHostMessage(raw: string): HostMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.source !== HOST_MESSAGE_SOURCE) return null;
  if (data.kind === "embed") {
    if (data.type === "embedReady") return { kind: "embedReady" };
    return data.type === "size" && isFiniteNumber(data.value) && data.value > 0 ? { kind: "size", height: Math.min(data.value, 5_000) } : null;
  }
  if (data.kind !== "tiktok" || typeof data.type !== "string") return null;
  const value = data.value;
  switch (data.type) {
    case "onPlayerReady":
      return { kind: "ready" };
    case "onStateChange": {
      const state = isFiniteNumber(value) ? TIKTOK_STATES[String(value)] : undefined;
      return state ? { kind: "state", state } : null;
    }
    case "onCurrentTime":
      return isRecord(value) && isFiniteNumber(value.currentTime) && isFiniteNumber(value.duration) && value.currentTime >= 0
        ? { kind: "time", currentTime: value.currentTime, duration: value.duration }
        : null;
    case "onMute":
      return typeof value === "boolean" ? { kind: "muted", muted: value } : null;
    case "onPlayerError":
      return isRecord(value) && isFiniteNumber(value.errorCode)
        ? { kind: "error", code: value.errorCode, errorType: typeof value.errorType === "string" ? value.errorType.slice(0, 60) : null }
        : null;
    default:
      return { kind: "other", type: data.type.slice(0, 40), origin: typeof data.origin === "string" ? data.origin.slice(0, 80) : "" };
  }
}

/** Lecture constatée : le seul signal qui dit que la vidéo joue vraiment (un
 * premier message quelconque ne suffit pas, il peut venir de l'écran
 * d'erreur du lecteur). */
export function isPlaybackSignal(message: HostMessage): boolean {
  return (message.kind === "state" && message.state === "playing") || message.kind === "time";
}

/** Le lecteur a répondu (retours du build 2) : prêt, état, temps, son, code
 * Instagram chargé, ou lecture automatique refusée (3002 : il attend un
 * toucher). Il n'est alors plus remplacé au bout de 12 s. Toute autre erreur,
 * un message non prévu, ou la taille Instagram (envoyée par la page d'accueil
 * avant même que le code d'Instagram soit chargé) : non. */
export function isPlayerAnswer(message: HostMessage): boolean {
  if (message.kind === "error") return tiktokErrorAction(message.code) === "tap_to_play";
  return message.kind !== "other" && message.kind !== "size";
}

/** Moment de la vidéo envoyé avec un spot : secondes entières, arrondies vers le bas ; null s'il n'est pas connu. */
export function momentSeconds(currentTime: number | null): number | null {
  return currentTime !== null && Number.isFinite(currentTime) && currentTime >= 0 ? Math.floor(currentTime) : null;
}

// ---- Image noire ou blanche (retours du build 2) ----
// Un CONTRÔLE de l'instantané de « Spotter ce moment », pas une autre méthode
// de capture : une image vide est refusée (snapshot_failed) au lieu d'être
// envoyée. Repris tel quel du contrôle retiré au commit 93ba4d1 (il a déjà
// tourné dans l'app), sur une petite copie de 96 px lue dans l'app.

export interface FrameRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Zone examinée (fractions de l'image) : presque toute l'image, sans le
 * bord droit (colonne de boutons de TikTok) ni le haut et le bas (en-tête de
 * l'auteur, commandes). */
export const BLANK_ZONE: FrameRect = { left: 0.06, top: 0.15, right: 0.8, bottom: 0.85 };
/** Retiré de la zone : le bouton lecture central, dessiné en pause. */
export const BLANK_HOLE: FrameRect = { left: 0.4, top: 0.42, right: 0.6, bottom: 0.58 };

/** Seules les deux signatures d'échec connues : image noire (99ᵉ centile
 * ≤ 24/255) et rectangle blanc (1ᵉʳ centile ≥ 245, WebKit 161450). Un mur uni
 * ou un fond de studio sombre avec une personne restent des images. */
export const BLANK_LIMITS = { blackP99Max: 24, whiteP1Min: 245 } as const;

const inside = (x: number, y: number, rect: FrameRect) => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;

export function isBlankFrame(sample: FrameSample): boolean {
  if (sample.width < 3 || sample.height < 3) return true;
  const histogram = new Array<number>(256).fill(0);
  let count = 0;
  for (let y = 0; y < sample.height; y += 1) {
    const fy = (y + 0.5) / sample.height;
    for (let x = 0; x < sample.width; x += 1) {
      const fx = (x + 0.5) / sample.width;
      if (!inside(fx, fy, BLANK_ZONE) || inside(fx, fy, BLANK_HOLE)) continue;
      histogram[sample.gray[y * sample.width + x] ?? 0]! += 1;
      count += 1;
    }
  }
  if (count === 0) return true;
  const percentile = (fraction: number) => {
    const target = Math.max(1, Math.ceil(fraction * count));
    let seen = 0;
    for (let value = 0; value < 256; value += 1) {
      seen += histogram[value]!;
      if (seen >= target) return value;
    }
    return 255;
  };
  return percentile(0.99) <= BLANK_LIMITS.blackP99Max || percentile(0.01) >= BLANK_LIMITS.whiteP1Min;
}

// ---- Image floue (retours du build 3) ----
// Second CONTRÔLE de l'instantané, sur la même petite copie de 96 px : une
// image floue (capture 06 du fondateur : la vidéo floue, les pictogrammes de
// TikTok nets) est refusée au lieu d'être envoyée. Mesurée dans la zone de
// isBlankFrame seulement : sans la colonne de boutons de TikTok, l'en-tête et
// le bas (nets même quand la vidéo est floue), ni le bouton central.
// Netteté des BORDS : sur les 5 % de pixels au plus fort gradient de la zone,
// moyenne du carré du laplacien divisée par la moyenne du carré du gradient.
// Un bord franc est étroit (laplacien fort pour son gradient) ; un bord flou
// est large (laplacien faible). La mesure ne dépend ni de la luminosité (les
// deux termes croissent comme le carré du contraste) ni de la QUANTITÉ de
// bords : un gros plan net d'un manteau uni, qui n'a que quelques bords,
// mesure autant qu'une rue chargée. (L'ancienne mesure, variance du laplacien
// sur variance des gris, refusait ces gros plans nets : ≈ 0,07.)
// Mesure faite par tuile (3 × 3) et sans les bandes noires du haut et du
// bas (le bord franc d'une bande noire ne fait plus passer une vidéo floue :
// 06 entre bandes noires ≈ 0,3). L'image est jugée sur sa tuile la PLUS
// NETTE : un sujet net sur un fond flou (silhouette en pied au milieu, mode
// portrait) n'occupe souvent qu'une colonne de tuiles, et la tuile médiane le
// refusait. Le doute profite au membre : un refus à tort (plus de spot depuis
// une image nette) est pire qu'une acceptation à tort (ce que donnait le
// build 3). Limite assumée : 06 avec une ligne de sous-titre nette passe.
// Aucune tuile avec un vrai bord (gros plan d'un tissu uni ou très fin, que
// la copie de 96 px rend lisse) : rien à juger, l'image n'est PAS refusée.

/** Seuil de départ, À CALIBRER sur l'iPhone (journal « [player] netteté » en
 * développement) ; repères mesurés sur des copies de 96 px : capture 06 floue
 * ≈ 0,37 ; 05 nette ≈ 3,2, et autant assombrie ; sujets nets (manteau
 * uni, silhouette étroite sur fond flou, logo) ≥ 2 ; les mêmes floutés ≤ 0,3
 * (un léger flou d'un pixel ≈ 0,7, encore utilisable). */
export const BLUR_LIMITS = { minSharpness: 0.5 } as const;

/** Part des pixels au plus fort gradient sur laquelle on juge les bords. */
const SHARPNESS_TOP_FRACTION = 0.05;
/** Gradient minimal (niveaux de gris par pixel) des bords jugés ; repères :
 * capture 05 assombrie à 15 % ≈ 10, 06 floue assombrie à 15 % ≈ 4,6. */
const SHARPNESS_MIN_EDGE = 3;

/** Bandes noires retirées des bords de la zone (vidéo en paysage dans la
 * boîte 9:16, fond noir de la page TikTok) : lignes du haut et du bas dont
 * tous les gris sont ≤ BLANK_LIMITS.blackP99Max, plus cette marge (px), pour
 * que le bord franc de la bande ne soit pas jugé comme un bord de la vidéo.
 * Les lignes seulement, pas les colonnes : un vêtement sombre sur le côté
 * d'un plan sombre (net) n'est pas une bande. */
const SHARPNESS_BAND_MARGIN = 2;
/** La zone (sans les bandes noires) est coupée en 3 × 3 tuiles : l'image est
 * jugée sur la tuile la PLUS NETTE parmi celles qui ont des bords (un sujet
 * net sur une seule colonne de tuiles, fond flou, suffit). */
const SHARPNESS_TILES = 3;

/** Netteté des bords de la zone examinée (rectangle BLANK_ZONE sans
 * BLANK_HOLE, sans les bandes noires du bord) : score de la tuile la plus
 * nette parmi celles qui ont des bords. Seuls comptent les pixels dont le pixel et ses quatre voisins
 * sont dans la zone et hors du trou (aucun bord inventé au bord du trou ni
 * lu dans la colonne de TikTok). Aucune tuile avec un vrai bord : null (rien
 * à juger). Image trop petite : 0. Exportée pour le journal de
 * développement (calibrage). */
export function frameSharpness(sample: FrameSample): number | null {
  const { width, height, gray } = sample;
  if (width < 3 || height < 3) return 0;
  let left = Math.floor(BLANK_ZONE.left * width);
  let right = Math.ceil(BLANK_ZONE.right * width);
  let top = Math.floor(BLANK_ZONE.top * height);
  let bottom = Math.ceil(BLANK_ZONE.bottom * height);
  const value = (x: number, y: number) => gray[y * width + x] ?? 0;
  const black = BLANK_LIMITS.blackP99Max;
  const rowBlack = (y: number) => {
    for (let x = left; x < right; x += 1) if (value(x, y) > black) return false;
    return true;
  };
  const zoneTop = top;
  const zoneBottom = bottom;
  while (top < bottom && rowBlack(top)) top += 1;
  while (top < bottom && rowBlack(bottom - 1)) bottom -= 1;
  if (top > zoneTop) top += SHARPNESS_BAND_MARGIN;
  if (bottom < zoneBottom) bottom -= SHARPNESS_BAND_MARGIN;
  if (right - left < 3 || bottom - top < 3) return 0;
  const isHole = (x: number, y: number) => inside((x + 0.5) / width, (y + 0.5) / height, BLANK_HOLE);
  const tileScores: number[] = [];
  for (let ty = 0; ty < SHARPNESS_TILES; ty += 1) {
    for (let tx = 0; tx < SHARPNESS_TILES; tx += 1) {
      const tileLeft = left + Math.floor(((right - left) * tx) / SHARPNESS_TILES);
      const tileRight = left + Math.floor(((right - left) * (tx + 1)) / SHARPNESS_TILES);
      const tileTop = top + Math.floor(((bottom - top) * ty) / SHARPNESS_TILES);
      const tileBottom = top + Math.floor(((bottom - top) * (ty + 1)) / SHARPNESS_TILES);
      const score = edgeScore(tileLeft, tileRight, tileTop, tileBottom);
      if (score !== null) tileScores.push(score);
    }
  }
  if (tileScores.length === 0) return null;
  tileScores.sort((a, b) => a - b);
  return tileScores[tileScores.length - 1]!;

  /** Score des bords d'une tuile, ou null si la tuile n'a aucun vrai bord. Les
   * voisins restent dans la zone (sans bandes) : x de left+1 à right-2. */
  function edgeScore(x0: number, x1: number, y0: number, y1: number): number | null {
    const gradients: number[] = [];
    const laplacians: number[] = [];
    for (let y = Math.max(y0, top + 1); y < Math.min(y1, bottom - 1); y += 1) {
      for (let x = Math.max(x0, left + 1); x < Math.min(x1, right - 1); x += 1) {
        if (isHole(x, y) || isHole(x - 1, y) || isHole(x + 1, y) || isHole(x, y - 1) || isHole(x, y + 1)) continue;
        const center = value(x, y);
        const west = value(x - 1, y);
        const east = value(x + 1, y);
        const north = value(x, y - 1);
        const south = value(x, y + 1);
        const gx = (east - west) / 2;
        const gy = (south - north) / 2;
        const laplacian = 4 * center - west - east - north - south;
        gradients.push(gx * gx + gy * gy);
        laplacians.push(laplacian * laplacian);
      }
    }
    if (gradients.length === 0) return null;
    const sorted = Float64Array.from(gradients).sort();
    const threshold = Math.max(sorted[Math.min(sorted.length - 1, Math.floor((1 - SHARPNESS_TOP_FRACTION) * sorted.length))]!, Number.MIN_VALUE);
    let gradientSum = 0;
    let laplacianSum = 0;
    let count = 0;
    for (let k = 0; k < gradients.length; k += 1) {
      if (gradients[k]! < threshold) continue;
      gradientSum += gradients[k]!;
      laplacianSum += laplacians[k]!;
      count += 1;
    }
    // Bords les plus forts sous 3 niveaux de gris par pixel : aucun vrai bord,
    // seulement les marches d'arrondi d'un dégradé (tuile floue ou unie).
    if (count === 0 || gradientSum / count < SHARPNESS_MIN_EDGE ** 2) return null;
    return laplacianSum / gradientSum;
  }
}

/** Image floue : netteté des bords de la zone sous BLUR_LIMITS.minSharpness.
 * Rien à juger (null) : pas floue, le doute profite au membre. */
export function isBlurryFrame(sample: FrameSample): boolean {
  const score = frameSharpness(sample);
  return score !== null && score < BLUR_LIMITS.minSharpness;
}

// ---- Commandes au lecteur TikTok (relayées par la page hôte) ----

export type PlayerCommand = "play" | "pause" | "mute" | "unMute";

export function playerCommand(type: PlayerCommand): string {
  return JSON.stringify({ type });
}

export function seekCommand(seconds: number): string {
  return JSON.stringify({ type: "seekTo", value: Math.max(0, seconds) });
}

/** Erreur du lecteur TikTok → ce que fait l'écran. 3002 : lecture
 * automatique refusée, la personne touche la vidéo ; toute autre erreur
 * (vidéo invalide ou privée, serveurs TikTok, lecture) : écran de secours. */
export function tiktokErrorAction(code: number): "tap_to_play" | "fallback" {
  return code === 3002 ? "tap_to_play" : "fallback";
}

// ---- Accord préalable (CNIL : traceurs des lecteurs officiels) ----

export const PLAYER_CONSENT_KEY = "spotto.lecteur-accord";
export type PlayerConsent = Record<PlayerPlatform, boolean>;

export function parsePlayerConsent(raw: string | null): PlayerConsent {
  const consent: PlayerConsent = { tiktok: false, instagram: false };
  if (!raw) return consent;
  try {
    const data: unknown = JSON.parse(raw);
    if (isRecord(data)) for (const platform of PLAYER_PLATFORM_LIST) consent[platform] = data[platform] === true;
  } catch {
    // Illisible : aucun accord.
  }
  return consent;
}

// ---- Taille du lecteur (retours du build 3) ----
// La vidéo prend la place qui reste après la zone d'actions MESURÉE (barre de
// lecture, ligne « Vidéo … de @… », « Spotter ce moment », « Trouver la pièce
// automatiquement ») : les deux actions sont visibles sans défiler, grand
// texte compris. Les commandes de TikTok étant cachées, son ancien minimum
// (325 × 578, sans lequel il ne les dessinait pas) n'a plus lieu d'être.

/** Plancher de lisibilité : en dessous seulement, l'écran défile. */
export const PLAYER_MIN_HEIGHT = 240;
const SIDE_GUTTER = 16;
/** Barre « ‹ Retour / Fermer ». */
const NAV_HEIGHT = 47;
const GAP = 8;

/** Avant la première mesure de la zone d'actions : barre 44 + ligne @pseudo 44 + Spotter 52 + 3 × 8 (+ Trouver 48 + 8 si l'analyse est allumée ; + phrase d'accord 44 + 8 la première fois). */
export function estimatedActionsHeight(input: { analysis: boolean; firstPlay: boolean; controls: boolean }): number {
  let height = 44 + 52 + 2 * GAP;
  if (input.controls) height += 44 + GAP;
  if (input.analysis) height += 48 + GAP;
  if (input.firstPlay) height += 44 + GAP;
  return height;
}

/** Lecteur 9:16 le plus grand possible au-dessus de la zone d'actions
 * (`actionsHeight`, mesurée) ; jamais sous 240 de haut quand la largeur le
 * permet (l'écran défile alors). Arrondis vers le bas. */
export function playerLayout(safeWidth: number, safeHeight: number, actionsHeight: number): { width: number; height: number } {
  const maxByWidth = Math.max(0, ((safeWidth - 2 * SIDE_GUTTER) * 16) / 9);
  const wanted = Math.min(Math.max(0, safeHeight - NAV_HEIGHT - Math.max(0, actionsHeight) - 2 * GAP), maxByWidth);
  const height = Math.floor(Math.max(Math.min(PLAYER_MIN_HEIGHT, maxByWidth), wanted, 0));
  return { width: Math.floor((height * 9) / 16), height };
}

// ---- Barre de lecture (retours du build 3, TikTok seulement) ----

/** Part lue, de 0 à 1 ; null tant que la durée est inconnue ou nulle (la barre reste éteinte). */
export function progressFraction(currentTime: number | null, duration: number | null): number | null {
  if (duration === null || !Number.isFinite(duration) || duration <= 0) return null;
  if (currentTime === null || !Number.isFinite(currentTime)) return 0;
  return Math.min(1, Math.max(0, currentTime / duration));
}

/** Position demandée (fraction de la barre) → secondes, bornées à [0, durée − 0,1]. */
export function seekSeconds(fraction: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const safe = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return Math.min(Math.max(0, duration - 0.1), Math.max(0, safe * duration));
}

/** Largeur minimale de notre barre : lecture 44 + son 44 + le temps (≈ 80) + 3 écarts de 4 ≈ 180 pt
 * fixes, et au moins ≈ 120 pt de trait pour le prendre au doigt. */
export const CONTROLS_MIN_WIDTH = 300;

/** Largeur de notre barre : celle de la vidéo, jamais moins de CONTROLS_MIN_WIDTH (la rangée est en
 * plus bornée à la largeur de la colonne : maxWidth 100 %). Petit iPhone ou grand texte : la vidéo
 * rétrécit, pas le trait. */
export function controlsRowWidth(videoWidth: number): number {
  return Math.max(Number.isFinite(videoWidth) ? Math.floor(videoWidth) : 0, CONTROLS_MIN_WIDTH);
}

/** « 0:05 », « 1:02 » : minutes et secondes entières, jamais négatif. */
export function formatPlayerTime(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

/** Hauteur d'un code d'intégration : celle qu'il annonce, dans la place disponible. */
export function embedHeight(reported: number | null, maxHeight: number): { height: number; scroll: boolean } {
  if (reported === null) return { height: maxHeight, scroll: false };
  return { height: Math.min(maxHeight, Math.max(200, Math.ceil(reported))), scroll: reported > maxHeight };
}
