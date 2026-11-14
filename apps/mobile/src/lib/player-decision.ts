// Écran « vidéo partagée » (mission « liens vidéo ») : lecteur officiel, ou
// écran de secours « Spottez cette vidéo » ? Une seule décision, pure et
// testée. Imports relatifs : fichier testé par vitest.
//
// Quatre interrupteurs indépendants :
// - les options du build, une par plateforme (lib/features.ts) ;
// - les interrupteurs du serveur, une par plateforme (`players` de
//   /api/video-links/lookup). Ils ne peuvent que COUPER un lecteur présent
//   dans le build : jamais en allumer un absent.
// Puis l'accord préalable (CNIL), demandé une fois avant le premier lecteur.
import type { VideoPlayersStatus } from "@monapp/shared-types";
import type { BuildFeatures } from "./features";
import type { PlayerPlatform } from "./player-link";

export type FallbackReason =
  /** Lecteur de cette plateforme absent du build. */
  | "build_off"
  /** Coupé par le serveur. */
  | "server_off"
  /** Interrupteurs du serveur inconnus (réponse perdue) : par prudence, pas de lecteur. */
  | "server_unknown"
  /** Pas sur l'app iPhone (Android) : aucun lecteur. */
  | "not_ios"
  /** Module de l'instantané absent de l'app installée : « Spotter ce moment » ne marcherait pas. */
  | "no_snapshot"
  /** La personne a refusé de lire la vidéo ici. */
  | "consent_refused"
  /** Ensuite, pendant la lecture : code Instagram indisponible (404 / 503) ou refusé, erreur du
   * lecteur TikTok, compte privé, vue web en erreur, lecteur muet, instantané impossible. */
  | "embed_unavailable"
  | "player_error"
  | "no_answer"
  | "webview_error"
  | "snapshot_failed";

export type PlayerDecision =
  /** Lecteur officiel. */
  | { kind: "player" }
  /** Accord préalable à demander (une fois). */
  | { kind: "consent" }
  /** Écran de secours « Spottez cette vidéo ». */
  | { kind: "fallback"; reason: FallbackReason }
  /** Site : jamais de lecteur, la mémoire et la consigne « capture, puis glisser-déposer ou coller ». */
  | { kind: "web" };

export interface PlayerDecisionInput {
  platform: PlayerPlatform;
  /** Platform.OS */
  os: string;
  build: BuildFeatures;
  /** null : réponse du serveur inconnue. */
  server: VideoPlayersStatus | null;
  /** Le module natif de l'instantané est relié à l'app installée. */
  snapshotReady: boolean;
  /** Accord donné pour cette plateforme ; « refused » : refusé à l'instant. */
  consent: boolean | "refused";
}

const buildFlag = (build: BuildFeatures, platform: PlayerPlatform) => (platform === "tiktok" ? build.tiktokPlayer : build.instagramPlayer);

export function decidePlayer(input: PlayerDecisionInput): PlayerDecision {
  if (input.os === "web") return { kind: "web" };
  if (input.os !== "ios") return { kind: "fallback", reason: "not_ios" };
  // Le build d'abord : le serveur ne peut rien rallumer de ce qui n'y est pas.
  if (!buildFlag(input.build, input.platform)) return { kind: "fallback", reason: "build_off" };
  if (!input.server) return { kind: "fallback", reason: "server_unknown" };
  if (!input.server[input.platform]) return { kind: "fallback", reason: "server_off" };
  if (!input.snapshotReady) return { kind: "fallback", reason: "no_snapshot" };
  if (input.consent === "refused") return { kind: "fallback", reason: "consent_refused" };
  return input.consent ? { kind: "player" } : { kind: "consent" };
}

/** Le lecteur de cette plateforme peut-il exister dans ce build, sur cet appareil (sans le serveur ni l'accord) ? */
export function playerPossible(os: string, build: BuildFeatures, platform?: PlayerPlatform): boolean {
  if (os !== "ios") return false;
  return platform ? buildFlag(build, platform) : build.tiktokPlayer || build.instagramPlayer;
}
