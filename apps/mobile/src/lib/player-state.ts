// Lecteur intégré (mission « liens vidéo ») : messages de la page hôte,
// commandes du lecteur TikTok, accord préalable, taille du lecteur. Logique
// pure, testée. Imports relatifs : fichier testé par vitest.
import type { FrameSample } from "./frame-sample";
import { HOST_MESSAGE_SOURCE } from "./player-host-page";
import { PLAYER_PLATFORM_LIST, type PlayerPlatform } from "./player-link";
import { sharpness } from "./video-stage1";

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
// Netteté RELATIVE : variance du laplacien (sharpness de video-stage1.ts,
// inchangée) divisée par la variance des gris de la même zone. La variance du
// laplacien seule croît comme le carré du contraste : un plan net mais sombre
// (soirée, intérieur) mesurait moins que la capture floue 06 et était refusé.
// Le rapport ne dépend pas de la luminosité.

/** Seuil de départ, À CALIBRER sur l'iPhone (journal « [player] netteté » en
 * développement) ; repères mesurés sur des copies de 96 px des captures du
 * fondateur : 06 floue ≈ 0,04 (0,06 assombrie) ; 05 nette ≈ 0,35 à 0,62, et
 * autant assombrie à 25 % ou 15 %. */
export const BLUR_LIMITS = { minSharpness: 0.1 } as const;

/** Netteté relative de la zone examinée : les pixels du rectangle BLANK_ZONE
 * recopiés dans un nouvel échantillon, ceux de BLANK_HOLE remplacés par la
 * moyenne de la zone (pour ne pas créer de bords) ; variance du laplacien
 * divisée par la variance des gris. Zone unie : 0. Exportée pour le journal
 * de développement (calibrage). */
export function frameSharpness(sample: FrameSample): number {
  if (sample.width < 3 || sample.height < 3) return 0;
  const left = Math.floor(BLANK_ZONE.left * sample.width);
  const right = Math.ceil(BLANK_ZONE.right * sample.width);
  const top = Math.floor(BLANK_ZONE.top * sample.height);
  const bottom = Math.ceil(BLANK_ZONE.bottom * sample.height);
  const width = right - left;
  const height = bottom - top;
  if (width < 3 || height < 3) return 0;
  const isHole = (x: number, y: number) => inside((x + 0.5) / sample.width, (y + 0.5) / sample.height, BLANK_HOLE);
  let sum = 0;
  let count = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (isHole(x, y)) continue;
      sum += sample.gray[y * sample.width + x] ?? 0;
      count += 1;
    }
  }
  const mean = count > 0 ? Math.round(sum / count) : 0;
  const gray = new Uint8Array(width * height);
  let graySum = 0;
  let graySquares = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const value = isHole(x, y) ? mean : (sample.gray[y * sample.width + x] ?? 0);
      gray[(y - top) * width + (x - left)] = value;
      graySum += value;
      graySquares += value * value;
    }
  }
  const grayMean = graySum / gray.length;
  const grayVariance = graySquares / gray.length - grayMean * grayMean;
  if (grayVariance < 1) return 0;
  return sharpness({ gray, width, height, colors: [] }) / grayVariance;
}

/** Image floue : netteté relative de la zone sous BLUR_LIMITS.minSharpness. */
export function isBlurryFrame(sample: FrameSample): boolean {
  return frameSharpness(sample) < BLUR_LIMITS.minSharpness;
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
