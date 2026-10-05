// Vidéo importée dans le Spotter (lot 4) : limites, repères de temps et
// contrat commun aux deux extracteurs d'images (iPhone : expo-video ; site :
// lecteur du navigateur). La vidéo ne quitte jamais l'appareil : seule
// l'image choisie part, comme une photo. Logique pure, testée.
import type { ImageProps } from "expo-image";

export const VIDEO_MAX_SECONDS = 60;
/** 100 Mo, au sens où l'iPhone affiche la taille des fichiers. */
export const VIDEO_MAX_BYTES = 100_000_000;
/** Une vidéo affichée « 1:00 » peut durer 60,4 s : elle est acceptée. */
const DURATION_TOLERANCE_MS = 999;
/** Ne jamais demander l'image de la toute fin : certains lecteurs n'en ont pas. */
const END_MARGIN_MS = 50;

export type VideoRejection = "too_long" | "too_large" | "unreadable";

/** Image d'un moment de la vidéo, affichable par expo-image (adresse locale
 * sur le site, image en mémoire sur iPhone). */
export type FramePreview = NonNullable<ImageProps["source"]>;

/** Image choisie, enregistrée en JPEG : elle suit le chemin d'une photo. */
export interface FrameFile {
  uri: string;
  width: number;
  height: number;
}

export interface OpenedVideo {
  durationMs: number;
  /** Vignettes de la frise, dans l'ordre des moments demandés. */
  filmstrip(timesMs: readonly number[], maxEdge: number): Promise<FramePreview[]>;
  /** Grande image du moment en cours. */
  preview(timeMs: number, maxEdge: number): Promise<FramePreview>;
  frameFile(timeMs: number, maxEdge: number): Promise<FrameFile>;
  /** Libère le lecteur et efface la copie de la vidéo (iPhone) ou son adresse (site). */
  release(): void;
}

/** Vidéo refusée, ou null si elle convient. La taille est contrôlée d'abord :
 * elle est connue avant d'ouvrir la vidéo. */
export function videoRejection(info: { durationMs: number | null; sizeBytes: number | null }): VideoRejection | null {
  if (info.sizeBytes !== null && info.sizeBytes > VIDEO_MAX_BYTES) return "too_large";
  const { durationMs } = info;
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0) return "unreadable";
  if (durationMs > VIDEO_MAX_SECONDS * 1000 + DURATION_TOLERANCE_MS) return "too_long";
  return null;
}

/** Moment demandable, entre le début et juste avant la fin. */
export function clampTime(timeMs: number, durationMs: number): number {
  const last = Math.max(0, durationMs - END_MARGIN_MS);
  return Math.min(Math.max(0, Math.round(timeMs)), last);
}

/** Moment correspondant à une position sur la frise (0 = début, 1 = fin). */
export function timeAtRatio(ratio: number, durationMs: number): number {
  return clampTime(Math.min(Math.max(ratio, 0), 1) * durationMs, durationMs);
}

/** Position du curseur sur la frise pour un moment donné. */
export function ratioOfTime(timeMs: number, durationMs: number): number {
  return durationMs > 0 ? Math.min(Math.max(timeMs / durationMs, 0), 1) : 0;
}

/** Moments des vignettes de la frise : le milieu de chaque tranche. */
export function filmstripTimes(durationMs: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => clampTime(((index + 0.5) / count) * durationMs, durationMs));
}

/** « 0:07 », « 1:00 » — affichage des moments et des durées. */
export function formatClock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Taille en mégaoctets entiers (« 142 »), pour les messages. */
export function megabytes(bytes: number): number {
  return Math.round(bytes / 1_000_000);
}

/** Durée en secondes entières, pour les statistiques. */
export function durationSeconds(durationMs: number): number {
  return Math.round(durationMs / 1000);
}
