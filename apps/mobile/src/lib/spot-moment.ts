// « Spotter ce moment » (retours du build 3, accord du fondateur du 26 novembre
// 2026) : quelle image part vers « Entourez la pièce » ? Logique pure, testée.
// Imports relatifs : fichier testé par vitest.
// - TikTok, serveur qui le permet (`frame: true`, lot 1) et temps du lecteur
//   connu : l'image du moment demandée à notre serveur, nette, sans les
//   pictogrammes de TikTok ;
// - sinon, ou si le serveur échoue : l'instantané de l'écran, s'il a passé le
//   contrôle (ni noir, ni blanc, ni flou : player-snapshot.ts) ;
// - sinon : aucune image, l'écran passe au secours (snapshot_failed ou
//   snapshot_blurry).
import type { VideoLinkFrameErrorCode, VideoLinkFrameResponse } from "@monapp/shared-types";
import type { PlayerPlatform } from "./player-link";

/** L'image du moment rendue par le serveur (api.ts fetchVideoLinkFrame, réponse vérifiée). */
export interface ServerFrame {
  image: string;
  width: number;
  height: number;
}

/** Instantané contrôlé (player-snapshot.ts). */
export interface SnapshotFrame {
  uri: string;
  width: number;
  height: number;
}

export type SnapshotError = "blank_frame" | "blurry_frame" | "other";

export type SpotImageChoice =
  | { source: "server"; image: string; width: number; height: number }
  | { source: "snapshot"; uri: string; width: number; height: number }
  | { source: "none"; reason: "snapshot_failed" | "snapshot_blurry" };

/** L'image du serveur d'abord ; sinon l'instantané net ; sinon le secours. Un
 * instantané présent alors que le serveur a répondu est à effacer par
 * l'appelant (discardLocalFile). */
export function chooseSpotImage(input: { server: ServerFrame | null; snapshot: SnapshotFrame | null; snapshotError: SnapshotError | null }): SpotImageChoice {
  if (input.server) return { source: "server", image: input.server.image, width: input.server.width, height: input.server.height };
  if (input.snapshot) return { source: "snapshot", uri: input.snapshot.uri, width: input.snapshot.width, height: input.snapshot.height };
  return { source: "none", reason: input.snapshotError === "blurry_frame" ? "snapshot_blurry" : "snapshot_failed" };
}

/** Demander l'image au serveur ? TikTok seulement (Instagram n'a ni commande
 * ni temps), serveur qui le permet, temps du lecteur connu. */
export function shouldAskServer(input: { platform: PlayerPlatform; frame: boolean; lastTime: number | null }): boolean {
  return input.platform === "tiktok" && input.frame && input.lastTime !== null && Number.isFinite(input.lastTime) && input.lastTime >= 0;
}

/** Moment envoyé au serveur : arrondi à la milliseconde, borné à [0, 90] (durée maximale admise par le serveur). */
export function frameSeconds(lastTime: number): number {
  const safe = Number.isFinite(lastTime) ? lastTime : 0;
  return Math.round(Math.min(90, Math.max(0, safe)) * 1000) / 1000;
}

/** Code d'erreur de l'instantané (message de l'erreur levée par snapshotPlayer). */
export function snapshotErrorCode(error: unknown): SnapshotError {
  const message = error instanceof Error ? error.message : "";
  return message === "blank_frame" || message === "blurry_frame" ? message : "other";
}

/** Pourquoi l'image du serveur n'est pas venue (statistique player_frame_failed) :
 * un code du service vidéo, du serveur, ou de l'app. Jamais l'adresse ni le temps. */
export const FRAME_FAILURES = [
  "video_unavailable",
  "video_private",
  "video_too_long",
  "video_busy",
  "video_timeout",
  "invalid_link",
  "invalid_moment",
  "rate_limited",
  "server",
  "timeout",
  "network",
  "disabled",
  "invalid",
] as const;
export type FrameFailure = (typeof FRAME_FAILURES)[number];

/** Chaque code d'erreur que le serveur peut répondre (contrat partagé du lot 1,
 * VideoLinkFrameErrorCode) → raison de la statistique. Un code ajouté au
 * contrat sans être traité ici ne compile pas. L'app ne montre jamais le
 * message du serveur : elle retombe sur l'instantané ou le secours. */
const FRAME_ERROR_REASONS: Readonly<Record<VideoLinkFrameErrorCode, FrameFailure>> = {
  video_frame_disabled: "disabled",
  invalid_moment: "invalid_moment",
  invalid_link: "invalid_link",
  video_unavailable: "video_unavailable",
  video_private: "video_private",
  video_too_long: "video_too_long",
  video_busy: "video_busy",
  video_timeout: "video_timeout",
  rate_limited: "rate_limited",
  internal_error: "server",
};

/** Erreur de fetchVideoLinkFrame (ApiError { status, body.error }, « frame_timeout », réseau) → raison. */
export function frameFailureReason(error: unknown): FrameFailure {
  if (error instanceof Error && error.message === "frame_timeout") return "timeout";
  const record = typeof error === "object" && error !== null ? (error as { status?: unknown; body?: unknown }) : null;
  if (record && typeof record.status === "number") {
    const code = typeof record.body === "object" && record.body !== null ? (record.body as { error?: unknown }).error : undefined;
    if (code === "invalid_frame") return "invalid";
    if (typeof code === "string" && Object.prototype.hasOwnProperty.call(FRAME_ERROR_REASONS, code)) return FRAME_ERROR_REASONS[code as VideoLinkFrameErrorCode];
    if (record.status === 429) return "rate_limited";
    return "server";
  }
  return "network";
}

const FRAME_IMAGE_PREFIX = "data:image/jpeg;base64,";
const isFrameSide = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 2_000;

/** Réponse de POST /api/video-links/frame (lot 1), vérifiée (jamais de confiance aveugle dans le réseau) :
 * une image JPEG en « data: », largeur et hauteur entières de 1 à 2 000. null : refusée. */
export function parseVideoLinkFrame(body: unknown): VideoLinkFrameResponse | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.image !== "string" || !record.image.startsWith(FRAME_IMAGE_PREFIX) || record.image.length <= FRAME_IMAGE_PREFIX.length) return null;
  if (!isFrameSide(record.width) || !isFrameSide(record.height)) return null;
  const timeSeconds = typeof record.timeSeconds === "number" && Number.isFinite(record.timeSeconds) ? record.timeSeconds : 0;
  return { image: record.image, width: record.width, height: record.height, timeSeconds };
}
