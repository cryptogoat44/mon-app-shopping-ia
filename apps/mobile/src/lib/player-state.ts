// Lecteur intégré (mission « liens vidéo ») : messages de la page hôte,
// commandes du lecteur TikTok, accord préalable, taille du lecteur. Logique
// pure, testée. Imports relatifs : fichier testé par vitest.
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

/** Moment de la vidéo envoyé avec un spot : secondes entières, arrondies vers le bas ; null s'il n'est pas connu. */
export function momentSeconds(currentTime: number | null): number | null {
  return currentTime !== null && Number.isFinite(currentTime) && currentTime >= 0 ? Math.floor(currentTime) : null;
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

// ---- Taille du lecteur ----

/** En dessous, le lecteur TikTok ne dessine pas ses commandes. */
export const TIKTOK_MIN_SIZE = { width: 325, height: 578 } as const;
const SIDE_GUTTER = 16;
/** Barre « ‹ / Fermer » (47) + ligne « Vidéo … de @pseudo » (44) + « Spotter ce moment » (52) + 3 espaces de 8 + marge (8). */
const CHROME = 183;

/** Lecteur 9:16 le plus grand possible, « Spotter ce moment » visible sous
 * lui ; jamais sous 325 × 578 quand la largeur le permet (l'écran défile). */
export function playerLayout(safeWidth: number, safeHeight: number): { width: number; height: number } {
  const maxByWidth = ((safeWidth - 2 * SIDE_GUTTER) * 16) / 9;
  const wanted = Math.min(Math.max(0, safeHeight - CHROME), maxByWidth);
  const height = Math.floor(Math.max(Math.min(TIKTOK_MIN_SIZE.height, maxByWidth), wanted, 0));
  return { width: Math.floor((height * 9) / 16), height };
}

/** Hauteur d'un code d'intégration : celle qu'il annonce, dans la place disponible. */
export function embedHeight(reported: number | null, maxHeight: number): { height: number; scroll: boolean } {
  if (reported === null) return { height: maxHeight, scroll: false };
  return { height: Math.min(maxHeight, Math.max(200, Math.ceil(reported))), scroll: reported > maxHeight };
}
