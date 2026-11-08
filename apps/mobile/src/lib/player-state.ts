// Lecteur intégré (lot « lecteur intégré ») : messages de la page hôte,
// commandes du lecteur TikTok, image noire ou blanche, ordre des méthodes de
// capture, accord préalable, taille du lecteur. Logique pure, testée. Imports
// relatifs : fichier testé par vitest.
import type { FrameSample } from "./frame-sample";
import { HOST_MESSAGE_SOURCE } from "./player-host-page";
import { PLAYER_PLATFORM_LIST, type PlayerPlatform, type TikTokCheckStatus, type UnavailableReason } from "./player-link";

export const PLAYER_TIMINGS = {
  /** Sans nouvelles du lecteur : message et « Ouvrir dans TikTok » (note R1 §4). */
  noAnswerMs: 12_000,
  /** Après la pause, l'image et les boutons du lecteur se figent (note R3 §6 : 150 à 300 ms). */
  settleAfterPauseMs: 250,
  /** Délais de départ, à calibrer (note R3 §6) : WebKit peut attendre 1 s une
   * image de la vidéo. « screen » : délai global de l'enregistrement de
   * l'écran, alerte d'iOS comprise (contre-expertise n° 16). */
  captureTimeoutMs: { pdf: 2_500, snapshot: 1_500, screen: 60_000 },
  /** La 1re demande « pdf » peut sortir vide : sortie vidéo créée à ce moment-là (note R3 §4.A). */
  pdfRetryDelayMs: 300,
  /** Codes d'intégration (Instagram, repli TikTok) : état de lecture de la vue web relu chaque seconde (contre-expertise n° 13). */
  mediaPollMs: 1_000,
} as const;

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

// ---- Messages de la page hôte : catalogue fermé ----

export type PlayerState = "init" | "ended" | "playing" | "paused" | "buffering";
const TIKTOK_STATES: Record<string, PlayerState> = { "-1": "init", "0": "ended", "1": "playing", "2": "paused", "3": "buffering" };

export type HostMessage =
  | { kind: "ready" }
  | { kind: "state"; state: PlayerState }
  | { kind: "time"; currentTime: number; duration: number }
  | { kind: "muted"; muted: boolean }
  | { kind: "error"; code: number }
  /** Code d'intégration chargé (Instagram, repli TikTok). */
  | { kind: "embedReady" }
  /** Hauteur du code d'intégration, en points. */
  | { kind: "size"; height: number }
  /** Événement non prévu (onVolumeChange, onImageChange…) : journalisé en développement. */
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
      return isRecord(value) && isFiniteNumber(value.currentTime) && isFiniteNumber(value.duration)
        ? { kind: "time", currentTime: value.currentTime, duration: value.duration }
        : null;
    case "onMute":
      return typeof value === "boolean" ? { kind: "muted", muted: value } : null;
    case "onPlayerError":
      return isRecord(value) && isFiniteNumber(value.errorCode) ? { kind: "error", code: value.errorCode } : null;
    case "onError":
      // Ancien événement, remplacé par onPlayerError (Video.js player-api.d.ts l.26-27).
      return { kind: "error", code: 0 };
    default:
      return { kind: "other", type: data.type.slice(0, 40), origin: typeof data.origin === "string" ? data.origin.slice(0, 80) : "" };
  }
}

/** Lecture constatée : seul signal qui rend « Spotter ce moment » actif
 * (contre-expertise n° 14 : un premier message quelconque ne suffit pas, il
 * peut venir de l'écran d'erreur du lecteur). */
export function isPlaybackSignal(message: HostMessage): boolean {
  return (message.kind === "state" && message.state === "playing") || message.kind === "time";
}

/** Vérification TikTok qui interdit le lecteur, même s'il a déjà démarré (contre-expertise n° 14). */
export function checkForbidsPlayer(status: TikTokCheckStatus): "not_public" | "not_a_video" | null {
  return status === "not_public" || status === "not_a_video" ? status : null;
}

// ---- Commandes au lecteur TikTok (relayées par la page hôte) ----

export type PlayerCommand = "play" | "pause" | "mute" | "unMute";

export function playerCommand(type: PlayerCommand): string {
  return JSON.stringify({ type });
}

export function seekCommand(seconds: number): string {
  return JSON.stringify({ type: "seekTo", value: Math.max(0, seconds) });
}

/** Erreur du lecteur TikTok (onPlayerError, note R1 §4) → ce que fait l'écran.
 * « fallback » : après un nouvel essai raté, le code d'intégration officiel
 * (contre-expertise n° 9), s'il n'a pas déjà été essayé. */
export function tiktokErrorAction(code: number, reloaded: boolean, fallbackTried = true): "tap_to_play" | "reload" | "fallback" | UnavailableReason {
  // 3002 : lecture automatique refusée par le navigateur ; la personne touche la vidéo.
  if (code === 3002) return "tap_to_play";
  // 1001 « Invalid Media ID, no video/photo found » (famille 1000-1099).
  if (code >= 1000 && code < 1100) return "not_public";
  // 2001 (serveurs TikTok), 3001 (lecture) : un seul nouvel essai ([tiers], note R1 §5).
  if (!reloaded) return "reload";
  if (!fallbackTried) return "fallback";
  return code >= 2000 && code < 2100 ? "no_answer" : "player_error";
}

/** Lecteur muet 12 s : la vérification TikTok (oEmbed) donne la raison. */
export function noAnswerReason(check: TikTokCheckStatus): UnavailableReason {
  if (check === "not_public" || check === "not_a_video" || check === "network") return check;
  return check === "ok" ? "player_error" : "no_answer";
}

// ---- Image noire ou blanche (contre-expertise n° 3) ----

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
/** Retiré de la zone : le bouton lecture central, dessiné en pause (Video.js, tiktok-video.md, « Controls »). */
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

// ---- Méthodes de capture : ordre, chaîne, mémoire ----

export type CaptureMethod = "pdf" | "snapshot" | "screen";
/** Ordre de départ (note R3 §6) : sans invite d'abord, l'enregistrement de l'écran en dernier. */
export const CAPTURE_METHODS: readonly CaptureMethod[] = ["pdf", "snapshot", "screen"];
export const CAPTURE_MEMORY_KEY = "spotto.lecteur-capture";
export const METHOD_TRIES: Record<CaptureMethod, number> = { pdf: 2, snapshot: 1, screen: 1 };
/** Mémoire oubliée après 30 jours (contre-expertise n° 15). */
export const CAPTURE_MEMORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** « L'image prise était noire ? » : deux signalements avant de reléguer la méthode (contre-expertise n° 15). */
export const BLACK_REPORTS_TO_RELEGATE = 2;

export interface CapturedFrame {
  uri: string;
  width: number;
  height: number;
}

export type CaptureErrorKind = "declined" | "disabled" | "phone_call" | "busy" | "unavailable" | "cancelled" | "timeout" | "not_ready" | "failed";
export type AttemptOutcome = { kind: "ok"; frame: CapturedFrame } | { kind: "blank" } | { kind: "error"; error: CaptureErrorKind };

export interface CaptureAttempt {
  method: CaptureMethod;
  outcome: "ok" | "blank" | CaptureErrorKind;
}

export interface ChainResult {
  frame: CapturedFrame | null;
  method: CaptureMethod | null;
  attempts: CaptureAttempt[];
}

/** Codes d'erreur du module natif (ios/SpottoFrameCaptureModule.swift) → genre d'échec. */
const ERROR_KINDS: Record<string, CaptureErrorKind> = {
  ERR_SCREEN_RECORDING_DECLINED: "declined",
  ERR_SCREEN_RECORDING_DISABLED: "disabled",
  ERR_SCREEN_RECORDING_PHONE_CALL: "phone_call",
  ERR_SCREEN_RECORDING_UNAVAILABLE: "unavailable",
  ERR_SCREEN_RECORDING_TIMEOUT: "timeout",
  ERR_SCREEN_RECORDING_CANCELLED: "timeout",
  ERR_CAPTURE_BUSY: "busy",
  ERR_WEB_VIEW_NOT_FOUND: "not_ready",
  ERR_EMPTY_AREA: "not_ready",
  ERR_TIMEOUT: "timeout",
};

export function captureErrorKind(code: string | null): CaptureErrorKind {
  return (code !== null ? ERROR_KINDS[code] : undefined) ?? "failed";
}

/** Erreurs qui arrêtent tout : refus de la personne, interdiction d'iPhone, appel en cours, capture manuelle choisie. */
const FINAL_ERRORS: readonly string[] = ["declined", "disabled", "phone_call", "cancelled"];

/** Essaie les méthodes dans l'ordre. Avant l'enregistrement de l'écran,
 * `beforeScreen` décide : « go », « cancelled » (la personne préfère sa
 * propre capture) ou « unavailable » (ReplayKit indisponible). Une image
 * noire se retente (pdf, note R3 §4.A) ; une erreur, non. `stillWanted` :
 * faux si l'écran a été quitté, la chaîne s'arrête (contre-expertise n° 2). */
export async function runCaptureChain(
  order: readonly CaptureMethod[],
  attempt: (method: CaptureMethod, tryIndex: number) => Promise<AttemptOutcome>,
  beforeScreen: () => Promise<"go" | "cancelled" | "unavailable">,
  stillWanted: () => boolean = () => true
): Promise<ChainResult> {
  const attempts: CaptureAttempt[] = [];
  for (const method of order) {
    if (!stillWanted()) break;
    if (method === "screen") {
      const answer = await beforeScreen();
      if (answer !== "go") {
        attempts.push({ method, outcome: answer });
        if (answer === "cancelled") break;
        continue;
      }
    }
    for (let tryIndex = 0; tryIndex < METHOD_TRIES[method]; tryIndex += 1) {
      if (!stillWanted()) break;
      const outcome = await attempt(method, tryIndex);
      if (outcome.kind === "ok") {
        attempts.push({ method, outcome: "ok" });
        return { frame: outcome.frame, method, attempts };
      }
      attempts.push({ method, outcome: outcome.kind === "blank" ? "blank" : outcome.error });
      if (outcome.kind === "error") break;
    }
    const last = attempts[attempts.length - 1];
    if (last && FINAL_ERRORS.includes(last.outcome)) break;
  }
  return { frame: null, method: null, attempts };
}

/** Méthode retenue et méthodes reléguées, pour une version d'iOS (note R3 §6 : « tout reprendre après une mise à jour d'iOS »). */
export interface CaptureMemory {
  os: string;
  /** Dernière mise à jour (ms) : oubliée après 30 jours. */
  savedAt: number;
  winner: CaptureMethod | null;
  /** Reléguées en fin de liste, jamais exclues (contre-expertise n° 15). */
  failed: CaptureMethod[];
  /** Signalements « L'image prise était noire ? », par méthode. */
  reports: Partial<Record<CaptureMethod, number>>;
}

const isMethod = (value: unknown): value is CaptureMethod => typeof value === "string" && (CAPTURE_METHODS as readonly string[]).includes(value);

export function parseCaptureMemory(raw: string | null): CaptureMemory | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || typeof data.os !== "string" || !Array.isArray(data.failed)) return null;
  const reports: Partial<Record<CaptureMethod, number>> = {};
  if (isRecord(data.reports)) {
    for (const method of CAPTURE_METHODS) {
      const value = data.reports[method];
      if (isFiniteNumber(value) && value > 0) reports[method] = Math.floor(value);
    }
  }
  return {
    os: data.os,
    savedAt: isFiniteNumber(data.savedAt) ? data.savedAt : 0,
    winner: isMethod(data.winner) ? data.winner : null,
    failed: data.failed.filter(isMethod),
    reports,
  };
}

/** Mémoire valable pour cette version d'iOS et de moins de 30 jours ; sinon rien. */
function currentMemory(memory: CaptureMemory | null, os: string, now: number): CaptureMemory | null {
  return memory && memory.os === os && now - memory.savedAt <= CAPTURE_MEMORY_MAX_AGE_MS ? memory : null;
}

const freshMemory = (os: string, now: number): CaptureMemory => ({ os, savedAt: now, winner: null, failed: [], reports: {} });

/** Méthode retenue d'abord, puis les autres ; les méthodes en échec passent en fin de liste, jamais retirées. */
export function captureOrder(memory: CaptureMemory | null, os: string, now: number): CaptureMethod[] {
  const base = currentMemory(memory, os, now);
  if (!base) return [...CAPTURE_METHODS];
  const fine = CAPTURE_METHODS.filter((method) => !base.failed.includes(method));
  const relegated = CAPTURE_METHODS.filter((method) => base.failed.includes(method));
  const head = base.winner && fine.includes(base.winner) ? [base.winner, ...fine.filter((method) => method !== base.winner)] : fine;
  return [...head, ...relegated];
}

/** Une méthode n'est reléguée que sur preuve : image noire alors qu'une
 * méthode suivante a réussi le même moment. Toutes noires : rien ne change
 * (la scène est peut-être sombre). */
export function rememberAttempts(memory: CaptureMemory | null, os: string, attempts: readonly CaptureAttempt[], now: number): CaptureMemory {
  const base = currentMemory(memory, os, now) ?? freshMemory(os, now);
  const success = attempts.find((attempt) => attempt.outcome === "ok")?.method ?? null;
  if (!success) return base;
  const blank = attempts.filter((attempt) => attempt.outcome === "blank" && attempt.method !== success).map((attempt) => attempt.method);
  return { ...base, savedAt: now, winner: success, failed: [...new Set([...base.failed.filter((method) => method !== success), ...blank])] };
}

/** « L'image prise était noire ou vide ? » : la méthode n'est reléguée qu'au deuxième signalement (un toucher par erreur ne suffit pas). */
export function reportBlack(memory: CaptureMemory | null, os: string, method: CaptureMethod, now: number): CaptureMemory {
  const base = currentMemory(memory, os, now) ?? freshMemory(os, now);
  const count = (base.reports[method] ?? 0) + 1;
  const reports = { ...base.reports, [method]: count };
  if (count < BLACK_REPORTS_TO_RELEGATE) return { ...base, savedAt: now, reports };
  return { ...base, savedAt: now, reports, winner: base.winner === method ? null : base.winner, failed: [...new Set([...base.failed, method])] };
}

/** Pour les statistiques. */
export function captureOutcome(result: ChainResult): "ok" | "blank" | "declined" | "failed" {
  if (result.frame) return "ok";
  if (result.attempts.some((attempt) => attempt.outcome === "declined" || attempt.outcome === "disabled")) return "declined";
  return result.attempts.length > 0 && result.attempts.every((attempt) => attempt.outcome === "blank") ? "blank" : "failed";
}

export type CaptureFailure = "declined" | "phone_call" | "cancelled" | "failed";

/** Pour le texte de l'encart de capture manuelle. */
export function captureFailure(attempts: readonly CaptureAttempt[]): CaptureFailure {
  const last = attempts[attempts.length - 1]?.outcome;
  if (last === "declined" || last === "disabled") return "declined";
  if (last === "phone_call" || last === "cancelled") return last;
  return "failed";
}

// ---- Accord préalable (contre-expertise n° 5) ----

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

/** En dessous, le lecteur TikTok ne dessine pas ses commandes (Video.js, tiktok-video.md, l.5). */
export const TIKTOK_MIN_SIZE = { width: 325, height: 578 } as const;
const SIDE_GUTTER = 24;
/** Barre « ‹ / Fermer » (47) + consigne (36) + bouton (52) + mention (36) + 4 espaces de 8 + marge basse (8). */
const REGULAR_CHROME = 211;
/** Une seule barre en bas (« ‹ », « Spotter ce moment », « Fermer » : 60) + espace (8). */
const COMPACT_CHROME = 68;

/** Lecteur 9:16 le plus grand possible ; disposition compacte quand la normale le ferait passer sous 578 pt de haut. */
export function playerLayout(safeWidth: number, safeHeight: number): { mode: "regular" | "compact"; width: number; height: number } {
  const fit = (availableHeight: number) => {
    const height = Math.floor(Math.max(0, Math.min(availableHeight, ((safeWidth - 2 * SIDE_GUTTER) * 16) / 9)));
    return { width: Math.floor((height * 9) / 16), height };
  };
  const regular = fit(safeHeight - REGULAR_CHROME);
  if (regular.height >= TIKTOK_MIN_SIZE.height) return { mode: "regular", ...regular };
  return { mode: "compact", ...fit(safeHeight - COMPACT_CHROME) };
}

/** Hauteur d'un code d'intégration : celle qu'il annonce, dans la place disponible. */
export function embedHeight(reported: number | null, maxHeight: number): { height: number; scroll: boolean } {
  if (reported === null) return { height: maxHeight, scroll: false };
  return { height: Math.min(maxHeight, Math.max(200, Math.ceil(reported))), scroll: reported > maxHeight };
}
