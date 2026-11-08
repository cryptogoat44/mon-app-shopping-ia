// Image du lecteur intégré, sur l'app iPhone (lot « lecteur intégré ») :
// module natif local « SpottoFrameCapture » (modules/spotto-frame-capture),
// ordre des méthodes, contrôle « image noire », méthode retenue par version
// d'iOS, accord préalable par plateforme. Version site : player-capture.web.ts
// (aucun lecteur sur le site).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { requireOptionalNativeModule } from "expo";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Platform } from "react-native";
import { base64ToBytes, decodePngSample } from "./png-pixels";
import { enabledPlayerPlatforms, playerAllowed, type PlayerPlatform } from "./player-link";
import {
  CAPTURE_MEMORY_KEY,
  PLAYER_CONSENT_KEY,
  PLAYER_TIMINGS,
  captureErrorKind,
  captureOrder,
  delay,
  isBlankFrame,
  parseCaptureMemory,
  parsePlayerConsent,
  rememberAttempts,
  reportBlack,
  runCaptureChain,
  type AttemptOutcome,
  type CaptureMemory,
  type CaptureMethod,
  type CapturedFrame,
  type ChainResult,
  type PlayerConsent,
} from "./player-state";
import { LINK_PLAYER_ENABLED, PLAYER_INSTAGRAM_ENABLED, PLAYER_TIKTOK_ENABLED } from "./spot-flags";
import { SCORING_EDGE } from "./video-stage1";
import { discardLocalFile } from "./video-frames";

/** Fonctions du module natif (modules/spotto-frame-capture/ios/SpottoFrameCaptureModule.swift). */
interface FrameCaptureModule {
  captureWebView(viewTag: number, method: "pdf" | "snapshot"): Promise<CapturedFrame>;
  captureScreen(viewTag: number): Promise<CapturedFrame>;
  cancelScreenCapture(): Promise<void>;
  screenCaptureAvailable(): Promise<boolean>;
  pauseMedia(viewTag: number): Promise<string>;
  mediaState(viewTag: number): Promise<string>;
}

// null : module absent (Expo Go, app installée plus ancienne que ce code) ;
// jamais d'erreur : le lecteur n'est simplement pas proposé.
const native = requireOptionalNativeModule<FrameCaptureModule>("SpottoFrameCapture");

/** Plateformes ouvertes dans le lecteur intégré : aucune sur le site, ni quand LINK_PLAYER_ENABLED est coupé. */
export function playerPlatforms(): PlayerPlatform[] {
  return enabledPlayerPlatforms(playerAllowed(Platform.OS, LINK_PLAYER_ENABLED, native !== null), {
    tiktok: PLAYER_TIKTOK_ENABLED,
    instagram: PLAYER_INSTAGRAM_ENABLED,
  });
}

/** Lecteur proposé (pour cette plateforme, ou pour au moins une). */
export function isPlayerAvailable(platform?: PlayerPlatform): boolean {
  const platforms = playerPlatforms();
  return platform ? platforms.includes(platform) : platforms.length > 0;
}

// L'encart « Encore une étape », avant l'alerte d'iOS : une fois par lancement de l'app.
let screenConsentShown = false;

export function screenConsentNeeded(): boolean {
  return !screenConsentShown;
}

export function markScreenConsentShown(): void {
  screenConsentShown = true;
}

/** Met en pause toute la vue web (WKWebView.pauseAllMediaPlayback) ; rend l'état lu ensuite. */
export async function pauseMedia(viewTag: number): Promise<string> {
  if (!native) return "unknown";
  try {
    return await native.pauseMedia(viewTag);
  } catch {
    return "unknown";
  }
}

/** État de lecture de la vue web (WKWebView.requestMediaPlaybackState) : « playing » quand une vidéo joue. */
export async function mediaState(viewTag: number): Promise<string> {
  if (!native) return "unknown";
  try {
    return await native.mediaState(viewTag);
  } catch {
    return "unknown";
  }
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** Abandon après `ms` ; une image arrivée trop tard est effacée : rien ne traîne dans le cache. */
function withTimeout(call: Promise<CapturedFrame>, ms: number, onLate?: () => void): Promise<CapturedFrame> {
  return new Promise((resolve, reject) => {
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      onLate?.();
      reject(Object.assign(new Error("capture_timeout"), { code: "ERR_TIMEOUT" }));
    }, ms);
    call.then(
      (frame) => {
        clearTimeout(timer);
        if (late) discardLocalFile(frame.uri);
        else resolve(frame);
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (!late) reject(error);
      }
    );
  });
}

/** Petite image PNG (96 px) décodée dans l'app, comme video-frames.ts l.77-85 : noire ou blanche ? */
async function looksBlank(uri: string): Promise<boolean> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: SCORING_EDGE });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.PNG, base64: true });
  discardLocalFile(saved.uri);
  if (!saved.base64) return true;
  return isBlankFrame(decodePngSample(base64ToBytes(saved.base64)));
}

async function attempt(viewTag: number, method: CaptureMethod, tryIndex: number): Promise<AttemptOutcome> {
  if (!native) return { kind: "error", error: "unavailable" };
  if (tryIndex > 0) await delay(PLAYER_TIMINGS.pdfRetryDelayMs);
  let frame: CapturedFrame;
  try {
    // Enregistrement de l'écran : délai global de 60 s, alerte d'iOS comprise ;
    // au-delà, la capture est arrêtée côté natif (contre-expertise n° 16).
    frame =
      method === "screen"
        ? await withTimeout(native.captureScreen(viewTag), PLAYER_TIMINGS.captureTimeoutMs.screen, () => void native.cancelScreenCapture().catch(() => {}))
        : await withTimeout(native.captureWebView(viewTag, method), PLAYER_TIMINGS.captureTimeoutMs[method]);
  } catch (error) {
    return { kind: "error", error: captureErrorKind(errorCode(error)) };
  }
  try {
    if (!(await looksBlank(frame.uri))) return { kind: "ok", frame };
  } catch {
    // Image illisible : traitée comme une image noire.
  }
  discardLocalFile(frame.uri);
  return { kind: "blank" };
}

async function readMemory(): Promise<CaptureMemory | null> {
  return parseCaptureMemory(await AsyncStorage.getItem(CAPTURE_MEMORY_KEY).catch(() => null));
}

async function writeMemory(memory: CaptureMemory): Promise<void> {
  await AsyncStorage.setItem(CAPTURE_MEMORY_KEY, JSON.stringify(memory)).catch(() => {});
}

export interface MomentCapture extends ChainResult {
  /** La méthode qui a marché était déjà la méthode retenue pour cette version d'iOS. */
  remembered: boolean;
}

/** « Spotter ce moment » : la vidéo est déjà en pause (écran Lecteur).
 * `stillWanted` : faux dès que l'écran est quitté ; la chaîne s'arrête. */
export async function captureMoment(options: {
  viewTag: number;
  confirmScreen: () => Promise<boolean>;
  onMethod?: (method: CaptureMethod) => void;
  stillWanted?: () => boolean;
}): Promise<MomentCapture> {
  const os = String(Platform.Version);
  const memory = await readMemory();
  const order = captureOrder(memory, os, Date.now());
  const result = await runCaptureChain(
    order,
    (method, tryIndex) => {
      options.onMethod?.(method);
      return attempt(options.viewTag, method, tryIndex);
    },
    async () => {
      const available = native ? await native.screenCaptureAvailable().catch(() => false) : false;
      if (!available) return "unavailable";
      return (await options.confirmScreen()) ? "go" : "cancelled";
    },
    options.stillWanted
  );
  await writeMemory(rememberAttempts(memory, os, result.attempts, Date.now()));
  return { ...result, remembered: result.method !== null && memory?.os === os && memory.winner === result.method && order[0] === result.method };
}

/** « L'image prise était noire ou vide ? » : signalement compté ; au deuxième, la méthode passe en fin de liste. */
export async function reportBlackImage(method: CaptureMethod): Promise<void> {
  await writeMemory(reportBlack(await readMemory(), String(Platform.Version), method, Date.now()));
}

/** Accord préalable au lecteur officiel, par plateforme (contre-expertise n° 5). */
export async function readPlayerConsent(): Promise<PlayerConsent> {
  return parsePlayerConsent(await AsyncStorage.getItem(PLAYER_CONSENT_KEY).catch(() => null));
}

export async function grantPlayerConsent(platform: PlayerPlatform): Promise<void> {
  const consent = await readPlayerConsent();
  await AsyncStorage.setItem(PLAYER_CONSENT_KEY, JSON.stringify({ ...consent, [platform]: true })).catch(() => {});
}

/** Réglages : accord retiré pour toutes les plateformes. */
export async function withdrawPlayerConsent(): Promise<void> {
  await AsyncStorage.removeItem(PLAYER_CONSENT_KEY).catch(() => {});
}
